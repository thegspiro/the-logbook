"""Tell a member an officer voided or edited one of their training records.

A void — a completion entered in error, or one the member cheated on — used to
append a note only officers read, and an edit said nothing at all. The member
saw credit disappear or change with no explanation and no way to question it.

Each notice is a bell entry and an email, the email under
``EmailKind.TRAINING_RECORD_CHANGES``, which is required: it is the member's
official record, so a member cannot switch it off (CLAUDE.md pitfall #18 —
email is the channel of record). Never SMS. An officer acting on their own
record is not told about it, as with self-reported submissions.
"""

import html
from datetime import date
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.email_template import EmailTemplateType
from app.models.notification import NotificationChannel, NotificationLog
from app.models.training import TrainingRecord
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_theme import fact, facts

VOIDED = "voided"
CHANGED = "changed"

NOTICE_CATEGORY = "training_record_update"
MY_TRAINING_PATH = "/training/my-training"

# The fields a member sees on their own record, with the label a notice uses.
# An edit to anything else (an internal note, a category) is not news to them.
MEMBER_VISIBLE_FIELDS: Tuple[Tuple[str, str], ...] = (
    ("course_name", "Course"),
    ("training_type", "Training type"),
    ("completion_date", "Completed"),
    ("hours_completed", "Hours"),
    ("credit_hours", "Credit hours"),
    ("expiration_date", "Expires"),
    ("certification_number", "Certification number"),
    ("status", "Status"),
)

Change = Tuple[str, str, str]


def _show(value: Any) -> str:
    value = getattr(value, "value", value)
    if value is None or value == "":
        return "none"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        return f"{value:g}"
    if isinstance(value, date):
        # The format every other email date uses.
        return value.strftime("%B %d, %Y")
    if isinstance(value, str):
        return value.replace("_", " ").capitalize()
    return str(value)


def _raw(value: Any) -> Any:
    return getattr(value, "value", value)


def snapshot(record: TrainingRecord) -> Dict[str, Any]:
    """The member-visible values of *record*, to compare after an edit."""
    return {field: _raw(getattr(record, field)) for field, _ in MEMBER_VISIBLE_FIELDS}


def describe_changes(
    before: Mapping[str, Any], after: Mapping[str, Any]
) -> List[Change]:
    """``(label, before, after)`` for each member-visible value that changed."""
    changes = []
    for field, label in MEMBER_VISIBLE_FIELDS:
        old, new = before.get(field), after.get(field)
        if old != new:
            changes.append((label, _show(old), _show(new)))
    return changes


def _subject_safe(text: str) -> str:
    # A subject is a header; a line break in a course name would end it early.
    return " ".join((text or "").split())


def _detail_rows(record: TrainingRecord) -> List[Tuple[str, str]]:
    rows = []
    if record.completion_date:
        rows.append(("Completed", _show(record.completion_date)))
    if record.hours_completed is not None:
        rows.append(("Hours", _show(float(record.hours_completed))))
    return rows


def build_notice(
    record: TrainingRecord,
    kind: str,
    officer_name: str,
    *,
    reason: Optional[str] = None,
    changes: Sequence[Change] = (),
) -> Dict[str, Any]:
    """Everything the bell and the email say, as plain values.

    ``email_context`` holds the template variables apart from the member's
    name, which the sender adds. Every value placed in an HTML variable that
    is inserted raw (``details_html``, ``notes_html``) is escaped here.
    """
    course = record.course_name or "a training course"
    note = (reason or "").strip()
    training_url = f"{settings.FRONTEND_URL.rstrip('/')}{MY_TRAINING_PATH}"

    if kind == VOIDED:
        rows = _detail_rows(record)
        message = (
            f"{officer_name} voided your training record for {course}. It no "
            f"longer counts toward your hours or requirements."
        )
        if note:
            message += f"\n\nReason: {note}"
        return {
            "subject": f"Training record voided — {_subject_safe(course)}",
            "message": message,
            "email_context": {
                "course_name": _subject_safe(course),
                "officer_name": officer_name,
                "void_reason": note,
                "details_html": (
                    facts([[fact(html.escape(k), html.escape(v)) for k, v in rows]])
                    if rows
                    else ""
                ),
                "details_text": "\n".join(f"{k}: {v}" for k, v in rows),
                "training_url": training_url,
            },
        }

    if kind != CHANGED:
        raise ValueError(f"Unknown training record notice: {kind}")
    lines = [f"{officer_name} updated your training record for {course}:"]
    lines += [f"• {label}: {old} → {new}" for label, old, new in changes]
    message = "\n".join(lines)
    if note:
        message += f"\n\nOfficer's notes: {note}"
    return {
        "subject": f"Training record updated — {_subject_safe(course)}",
        "message": message,
        "email_context": {
            "course_name": _subject_safe(course),
            "officer_name": officer_name,
            "details_html": (
                facts(
                    [
                        [
                            fact(
                                html.escape(label),
                                f"{html.escape(old)} &rarr; {html.escape(new)}",
                            )
                        ]
                        for label, old, new in changes
                    ]
                )
                if changes
                else ""
            ),
            "details_text": "\n".join(
                f"{label}: {old} -> {new}" for label, old, new in changes
            ),
            "notes_html": (
                '<p style="white-space:pre-line;"><strong>From the training '
                f"officer:</strong> {html.escape(note)}</p>"
                if note
                else ""
            ),
            "change_note": f"From the training officer: {note}" if note else "",
            "training_url": training_url,
        },
    }


def _display_name(user: Optional[User], fallback: str) -> str:
    if user is None:
        return fallback
    return user.display_name or user.username or fallback


async def send_training_record_notice(
    organization_id: str,
    record_id: str,
    officer_id: str,
    kind: str,
    reason: Optional[str] = None,
    changes: Sequence[Change] = (),
) -> None:
    """Background task: tell the record's member what an officer did to it.

    Runs on its own session after the response has gone, so nothing here can
    fail or slow the officer's action; it never raises. The record is re-read
    so the notice reflects what was committed.
    """
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            await deliver_training_record_notice(
                session,
                str(organization_id),
                str(record_id),
                str(officer_id),
                kind,
                reason=reason,
                changes=changes,
            )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Training record notice failed: {}", exc)


async def deliver_training_record_notice(
    session: AsyncSession,
    organization_id: str,
    record_id: str,
    officer_id: str,
    kind: str,
    *,
    reason: Optional[str] = None,
    changes: Sequence[Change] = (),
) -> bool:
    """Write the bell entry and send the email. Returns whether a notice went
    out at all (``False`` for an officer's own record, a departed member, or
    an edit that changed nothing the member sees)."""
    if kind == CHANGED and not changes:
        return False
    record = (
        await session.execute(
            select(TrainingRecord).where(
                TrainingRecord.id == record_id,
                TrainingRecord.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if record is None or str(record.user_id) == str(officer_id):
        return False
    member = (
        await session.execute(
            select(User).where(
                User.id == str(record.user_id),
                User.organization_id == organization_id,
                User.is_active,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        return False
    officer = (
        await session.execute(
            select(User).where(
                User.id == str(officer_id), User.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()

    notice = build_notice(
        record,
        kind,
        _display_name(officer, "A training officer"),
        reason=reason,
        changes=changes,
    )
    await _record_in_app(session, organization_id, record_id, member, kind, notice)
    org = await session.get(Organization, organization_id)
    await _email(session, org, member, kind, notice)
    return True


async def _record_in_app(
    session: AsyncSession,
    organization_id: str,
    record_id: str,
    member: User,
    kind: str,
    notice: Dict[str, Any],
) -> None:
    session.add(
        NotificationLog(
            organization_id=organization_id,
            recipient_id=str(member.id),
            channel=NotificationChannel.IN_APP,
            category=NOTICE_CATEGORY,
            subject=notice["subject"],
            message=notice["message"],
            action_url=MY_TRAINING_PATH,
            notification_metadata={"record_id": record_id, "change": kind},
            delivered=True,
        )
    )
    try:
        await session.commit()
    except Exception as exc:
        # The email still carries the notice; a failed bell insert must not
        # take it down too.
        await session.rollback()
        logger.warning("Training record in-app notice failed: {}", exc)


async def _email(
    session: AsyncSession,
    org: Optional[Organization],
    member: User,
    kind: str,
    notice: Dict[str, Any],
) -> None:
    if not member.email:
        return
    if not member_receives_email(
        member.notification_preferences,
        EmailKind.TRAINING_RECORD_CHANGES,
        department_required_kinds(org),
    ):
        return
    template_type = (
        EmailTemplateType.TRAINING_RECORD_VOIDED
        if kind == VOIDED
        else EmailTemplateType.TRAINING_RECORD_CHANGED
    )
    try:
        from app.services.email_service import EmailService

        await EmailService(organization=org).send_training_record_notice_email(
            template_type=template_type,
            to_email=member.email,
            context={
                **notice["email_context"],
                "member_name": _display_name(member, ""),
            },
            db=session,
            organization_id=str(org.id) if org else None,
        )
    except Exception as exc:
        logger.warning("Training record notice email failed: {}", exc)
