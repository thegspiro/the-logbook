"""Training-compliance emails to members (CMP2-1).

Owner decision: a daily task makes the two Notifications settings on the
Compliance configuration screen do what they say, email-first.

=========================================  =====================================
Setting                                    What the member receives
=========================================  =====================================
``notify_days_before_deadline`` (a list    A reminder when an unmet requirement's
of day counts, e.g. 30, 14, 7)             deadline is that many days away
``notify_non_compliant_members``           A notice when they fall out of
                                           compliance, listing what is unmet
=========================================  =====================================

Each setting stands on its own: an empty day list sends no reminders, the
switch off sends no notices. A department with no compliance configuration
gets neither, as before this existed.

**What counts is the shared evaluator's answer** (CLAUDE.md pitfall #29):
``training_compliance.grade_org_members`` grades members exactly as the
dashboard and the compliance matrix do -- profiles, thresholds, waivers,
grandfathering and catch-up periods included. A requirement's *deadline* is
the end of its current compliance window, or the member's catch-up deadline
while one protects them; a completed or already-lapsed requirement has none.
"Non-compliant" is the ``non_compliant`` standing those screens show; an
at-risk member is not sent the notice.

**Email only.** These are not urgent alerts and none is in ``SmsAlert``
(pitfall #18). They are ``EmailKind.TRAINING_REMINDERS`` mail, so a member who
turned training reminders off is not sent them unless the department made the
kind required.

**Idempotency.** The task runs once a day and again whenever the scheduler
restarts, so each email sent is recorded as an email-channel
``NotificationLog`` row and read back before sending:

- a reminder is keyed by (requirement, deadline, offset). The most urgent
  offset whose window has begun is the one due, so a run missed while the
  scheduler was down still sends on the next one, and a member is never sent
  two reminders for the same deadline on one day;
- a non-compliance notice is keyed by the unmet (requirement, window) pairs it
  listed. A member still non-compliant tomorrow is not told again; one who
  falls short of a further requirement, or of the same one in a new period,
  is.
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable, Optional, Sequence

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.compliance_config import ComplianceConfig
from app.models.notification import NotificationChannel, NotificationLog
from app.models.training import TrainingRequirement, TrainingStatus
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_theme import ACCENT_AMBER, ACCENT_RED, action, fact, facts
from app.services.training_compliance import (
    CATCH_UP_STATUS,
    MemberCompliance,
    RequirementEvaluation,
    grade_org_members,
)
from app.utils.org_timezone import org_today

REMINDER_LOG_CATEGORY = "compliance_deadline_reminder"
NONCOMPLIANT_LOG_CATEGORY = "compliance_noncompliant_notice"
MY_TRAINING_PATH = "/training/my-training"

# A reminder further out than a year is not a reminder; a value outside this
# range in the stored JSON is ignored rather than trusted.
MAX_OFFSET_DAYS = 365

# Unmet statuses a deadline can still be ahead of.
_OPEN_STATUSES = frozenset({"not_started", "in_progress"})


def reminder_offsets(raw: Any) -> list[int]:
    """The configured day counts, cleaned.

    ``notify_days_before_deadline`` is free-form JSON (pitfall #19): anything
    that is not a whole number of days from 0 to a year is dropped rather than
    allowed to fail the department's run.
    """
    if not isinstance(raw, (list, tuple)):
        return []
    offsets = set()
    for value in raw:
        if isinstance(value, bool):
            continue
        try:
            days = int(value)
        except (TypeError, ValueError):
            continue
        if 0 <= days <= MAX_OFFSET_DAYS and days == value:
            offsets.add(days)
    return sorted(offsets)


def due_offset(deadline: date, today: date, offsets: Sequence[int]) -> Optional[int]:
    """The reminder whose window has begun, the most urgent first.

    The 14-day reminder is due from fourteen days before the deadline until
    the 7-day one takes over. ``None`` before the first window and after the
    deadline.
    """
    days_left = (deadline - today).days
    if days_left < 0:
        return None
    due = [offset for offset in offsets if days_left <= offset]
    return min(due) if due else None


def requirement_deadline(ev: RequirementEvaluation, today: date) -> Optional[date]:
    """When an unmet requirement falls due for this member, if it still can."""
    if ev.status == TrainingStatus.COMPLETED.value:
        return None
    if ev.status == CATCH_UP_STATUS and ev.catch_up_deadline:
        return date.fromisoformat(ev.catch_up_deadline)
    if ev.status in _OPEN_STATUSES and ev.window_end:
        deadline = date.fromisoformat(ev.window_end)
        return deadline if deadline >= today else None
    return None


def _unmet_key(req: TrainingRequirement, ev: RequirementEvaluation) -> str:
    return f"{req.id}|{ev.window_end or ''}"


def _progress(ev: RequirementEvaluation) -> str:
    if ev.progress_required is None or ev.progress_current is None:
        return ""
    current = f"{ev.progress_current:g}"
    required = f"{ev.progress_required:g}"
    return f"{current} of {required} {ev.progress_unit or ''}".strip()


def long_date(value: date) -> str:
    return f"{value:%B} {value.day}, {value.year}"


def _link(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def _subject_safe(text: str) -> str:
    return " ".join((text or "").split())


@dataclass(frozen=True)
class _DueReminder:
    requirement: TrainingRequirement
    evaluation: RequirementEvaluation
    deadline: date
    offset: int


async def _load_config(db: AsyncSession, org_id: str) -> Optional[ComplianceConfig]:
    result = await db.execute(
        select(ComplianceConfig)
        .options(selectinload(ComplianceConfig.profiles))
        .where(ComplianceConfig.organization_id == org_id)
    )
    config: Optional[ComplianceConfig] = result.scalars().first()
    return config


async def _sent_logs(
    db: AsyncSession, org_id: str, member_ids: Iterable[str]
) -> dict[str, list[NotificationLog]]:
    ids = list(member_ids)
    if not ids:
        return {}
    result = await db.execute(
        select(NotificationLog).where(
            NotificationLog.organization_id == org_id,
            NotificationLog.channel == NotificationChannel.EMAIL,
            NotificationLog.category.in_(
                [REMINDER_LOG_CATEGORY, NONCOMPLIANT_LOG_CATEGORY]
            ),
            NotificationLog.recipient_id.in_(ids),
        )
    )
    by_member: dict[str, list[NotificationLog]] = {}
    for log in result.scalars().all():
        by_member.setdefault(str(log.recipient_id), []).append(log)
    return by_member


def _reminded(logs: Iterable[NotificationLog]) -> set[tuple[str, str, Any]]:
    told = set()
    for log in logs:
        meta = log.notification_metadata
        if log.category != REMINDER_LOG_CATEGORY or not isinstance(meta, dict):
            continue
        for item in meta.get("items") or []:
            if isinstance(item, dict):
                told.add(
                    (
                        str(item.get("requirement_id")),
                        str(item.get("deadline")),
                        item.get("offset_days"),
                    )
                )
    return told


def _noticed(logs: Iterable[NotificationLog]) -> set[str]:
    told: set[str] = set()
    for log in logs:
        meta = log.notification_metadata
        if log.category != NONCOMPLIANT_LOG_CATEGORY or not isinstance(meta, dict):
            continue
        told.update(str(k) for k in meta.get("unmet") or [])
    return told


async def _send(
    db: AsyncSession,
    org: Organization,
    member: User,
    *,
    subject: str,
    title: str,
    body_html: str,
    text_body: str,
    chip: str,
    accent: str,
    template_type: str,
) -> bool:
    from app.services.email_service import EmailService, wrap_email_body

    html_body = wrap_email_body(org, title, body_html, header_color=accent, chip=chip)
    sent, _failed = await EmailService(organization=org).send_email(
        to_emails=[member.email],
        subject=_subject_safe(subject),
        html_body=html_body,
        text_body=text_body,
        db=db,
        template_type=template_type,
    )
    return bool(sent)


def _record(
    db: AsyncSession,
    org_id: str,
    member: User,
    *,
    category: str,
    subject: str,
    metadata: dict,
) -> None:
    db.add(
        NotificationLog(
            organization_id=org_id,
            recipient_id=str(member.id),
            recipient_email=member.email,
            channel=NotificationChannel.EMAIL,
            category=category,
            subject=_subject_safe(subject)[:500],
            action_url=MY_TRAINING_PATH,
            delivered=True,
            notification_metadata=dict(metadata),
        )
    )


def _requirement_rows(items: Sequence[tuple[str, str]]) -> str:
    return facts(
        [[fact(html.escape(name), html.escape(detail))] for name, detail in items]
    )


async def _remind(
    db: AsyncSession,
    org: Organization,
    member: User,
    due: list[_DueReminder],
    today: date,
) -> bool:
    soonest = min(r.deadline for r in due)
    days_left = (soonest - today).days
    when = {0: "today", 1: "tomorrow"}.get(days_left, f"in {days_left} days")
    subject = (
        f"Reminder: {due[0].requirement.name} is due {long_date(soonest)}"
        if len(due) == 1
        else f"Reminder: {len(due)} training requirements are due soon"
    )
    lead = (
        f"A training requirement you have not yet met is due {when}."
        if len(due) == 1
        else "These training requirements are not yet met and are due soon."
    )
    rows = []
    for r in sorted(due, key=lambda r: (r.deadline, r.requirement.name)):
        progress = _progress(r.evaluation)
        detail = f"Due {long_date(r.deadline)}" + (
            f" ({progress} so far)" if progress else ""
        )
        rows.append((r.requirement.name, detail))
    link = _link(MY_TRAINING_PATH)
    body = (
        f"<p>{html.escape(lead)}</p>"
        + _requirement_rows(rows)
        + action(html.escape(link), "Open my training")
    )
    text = (
        f"{lead}\n\n"
        + "\n".join(f"- {name}: {detail}" for name, detail in rows)
        + f"\n\nOpen my training: {link}\n"
    )
    if not await _send(
        db,
        org,
        member,
        subject=subject,
        title="Training requirement due soon",
        body_html=body,
        text_body=text,
        chip="Training",
        accent=ACCENT_AMBER,
        template_type="compliance_deadline_reminder",
    ):
        return False
    _record(
        db,
        str(org.id),
        member,
        category=REMINDER_LOG_CATEGORY,
        subject=subject,
        metadata={
            "org_date": today.isoformat(),
            "items": [
                {
                    "requirement_id": str(r.requirement.id),
                    "deadline": r.deadline.isoformat(),
                    "offset_days": r.offset,
                }
                for r in due
            ],
        },
    )
    return True


async def _notify_non_compliant(
    db: AsyncSession,
    org: Organization,
    graded: MemberCompliance,
    unmet: list[tuple[TrainingRequirement, RequirementEvaluation]],
    today: date,
) -> bool:
    member = graded.member
    subject = "You are not currently meeting your training requirements"
    lead = (
        "Your department's training records show you are not currently "
        "meeting your training requirements. These are not yet met:"
    )
    rows = []
    for req, ev in sorted(unmet, key=lambda pair: pair[0].name):
        progress = _progress(ev)
        due = requirement_deadline(ev, today)
        parts = [p for p in (progress, f"due {long_date(due)}" if due else "") if p]
        rows.append((req.name, "; ".join(parts) or "Not yet met"))
    link = _link(MY_TRAINING_PATH)
    body = (
        f"<p>{html.escape(lead)}</p>"
        + _requirement_rows(rows)
        + action(html.escape(link), "Open my training")
    )
    text = (
        f"{lead}\n\n"
        + "\n".join(f"- {name}: {detail}" for name, detail in rows)
        + f"\n\nOpen my training: {link}\n"
    )
    if not await _send(
        db,
        org,
        member,
        subject=subject,
        title="Training requirements not met",
        body_html=body,
        text_body=text,
        chip="Training",
        accent=ACCENT_RED,
        template_type="compliance_noncompliant_notice",
    ):
        return False
    _record(
        db,
        str(org.id),
        member,
        category=NONCOMPLIANT_LOG_CATEGORY,
        subject=subject,
        metadata={
            "org_date": today.isoformat(),
            "unmet": sorted(_unmet_key(req, ev) for req, ev in unmet),
        },
    )
    return True


async def send_member_compliance_notices(db: AsyncSession, org: Organization) -> int:
    """One department's reminders and notices for today. Returns emails sent.

    Commits once, after the department is done, so the sent-log and the sends
    agree; the scheduler's per-org guard rolls back a failure.
    """
    org_id = str(org.id)
    config = await _load_config(db, org_id)
    if config is None:
        return 0
    offsets = reminder_offsets(config.notify_days_before_deadline)
    notify_non_compliant = bool(config.notify_non_compliant_members)
    if not offsets and not notify_non_compliant:
        return 0

    today = org_today(org)
    graded_members = await grade_org_members(db, org_id, today, config)
    if not graded_members:
        return 0
    required_kinds = department_required_kinds(org)
    recipients = [
        g
        for g in graded_members
        if g.member.email
        and member_receives_email(
            g.member.notification_preferences,
            EmailKind.TRAINING_REMINDERS,
            required_kinds,
        )
    ]
    logs = await _sent_logs(db, org_id, (str(g.member.id) for g in recipients))

    sent = 0
    for graded in recipients:
        member_logs = logs.get(str(graded.member.id), [])
        if offsets:
            reminded = _reminded(member_logs)
            due: list[_DueReminder] = []
            for req, ev in graded.evaluations:
                deadline = requirement_deadline(ev, today)
                if deadline is None:
                    continue
                offset = due_offset(deadline, today, offsets)
                if offset is None:
                    continue
                if (str(req.id), deadline.isoformat(), offset) in reminded:
                    continue
                due.append(_DueReminder(req, ev, deadline, offset))
            if due and await _remind(db, org, graded.member, due, today):
                sent += 1

        if notify_non_compliant and graded.standing == "non_compliant":
            # Catch-up requirements count neither way (tally_standing), so
            # they are not listed as unmet either.
            unmet = [
                (req, ev)
                for req, ev in graded.evaluations
                if ev.status not in (TrainingStatus.COMPLETED.value, CATCH_UP_STATUS)
            ]
            new_keys = {_unmet_key(req, ev) for req, ev in unmet} - _noticed(
                member_logs
            )
            if new_keys and await _notify_non_compliant(db, org, graded, unmet, today):
                sent += 1

    await db.commit()
    if sent:
        logger.info(f"Compliance member notices: {sent} sent for org {org_id}")
    return sent
