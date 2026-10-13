"""Per-requirement settings on a training program's requirement links.

Three columns on ``program_requirements`` were written by clone and import and
read by nothing (CLAUDE.md pitfall #19). Owner decisions, 2026-10-12:

``custom_deadline_days``
    The requirement is due that many days after the member's cycle began. The
    due date is **derived on every read** from the link's current value —
    nothing per member is stored — so an officer's edit moves every enrolled
    member's date at once, including members enrolled before this shipped.
    A satisfied requirement (completed, verified or waived) is never due.

``program_specific_description``
    Shown to the member on their progress page in place of the requirement's
    own, department-wide description.

``notification_message``
    Emailed to the member, once, when they complete the requirement.

**The cycle start, not the original enrollment.** ``cycle_started_at`` equals
``enrolled_at`` for every enrollment until it is reset (manually, or by a
recertification cycle); a reset blanks every requirement, and measuring from
the original enrollment would make each one overdue the moment the new cycle
began. The model falls back to ``enrolled_at`` for rows that predate the
column, exactly as the pace heuristics do.

**Reminders** follow the program's own ramp (``warning_days_before`` +
``reminder_conditions``, :mod:`app.utils.reminder_conditions`), then exactly
one overdue notice per due date. The sweep is daily and must not repeat
itself, so ``requirement_progress`` records *which due date* each notice was
sent for (``due_warning_sent_for`` with the ramp step in
``due_warning_days_before``, and ``overdue_notice_sent_for``). Because the
marker names a date rather than a fact, moving the deadline makes it stop
matching and the reminders resume for the new date; a member already overdue
when this shipped gets one overdue notice, not a replay of the ramp.

Email first (pitfall #18): every notice is an email, governed by the member's
``EmailKind.TRAINING_REMINDERS`` choice, with the in-app bell entry the rest of
the training module already writes. Never SMS. A notice that fails to send is
logged and dropped; it never fails the sweep or the progress write behind it.
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.core.config import settings
from app.models.notification import NotificationCategory, NotificationChannel
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    ProgramRequirement,
    RequirementProgress,
    RequirementProgressStatus,
    TrainingProgram,
    TrainingRequirement,
)
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_theme import ACCENT_AMBER, ACCENT_GREEN, ACCENT_RED, action
from app.utils.org_timezone import local_date, scheduling_timezone, today_in
from app.utils.reminder_conditions import (
    due_warning_offset,
    normalize_reminder_conditions,
)

# Satisfied states: none of them is ever "due".
SATISFIED_STATUSES = frozenset(
    {
        RequirementProgressStatus.COMPLETED,
        RequirementProgressStatus.VERIFIED,
        RequirementProgressStatus.WAIVED,
    }
)
# Completion is announced; a waiver is an officer excusing the member from the
# requirement, not the member finishing it, so it carries no message.
COMPLETED_STATUSES = frozenset(
    {RequirementProgressStatus.COMPLETED, RequirementProgressStatus.VERIFIED}
)


def _status(value: Any) -> Optional[RequirementProgressStatus]:
    try:
        return RequirementProgressStatus(getattr(value, "value", value))
    except ValueError:
        return None


@dataclass
class LinkSettings:
    """A program's settings for one requirement, merged across its links.

    The same requirement may be linked into more than one phase. A member has
    one progress row for it, so the links collapse to one answer: the
    earliest deadline, and the first description and message in program order.
    """

    deadline_days: Optional[int] = None
    description: Optional[str] = None
    message: Optional[str] = None


async def program_link_settings(
    db: AsyncSession, program_id: Any
) -> Dict[str, LinkSettings]:
    """Requirement id -> the program's settings for it.

    ``program_id`` must come from an org-scoped read (an enrollment or program
    already resolved in the caller's department): ``program_requirements`` has
    no organization column, so it is constrained through its parent (#14).
    """
    result = await db.execute(
        select(ProgramRequirement)
        .where(ProgramRequirement.program_id == str(program_id))
        .order_by(ProgramRequirement.sort_order, ProgramRequirement.created_at)
    )
    settings_by_requirement: Dict[str, LinkSettings] = {}
    for link in result.scalars().all():
        entry = settings_by_requirement.setdefault(
            str(link.requirement_id), LinkSettings()
        )
        days = link.custom_deadline_days
        # Clone and import write this from JSON without the request bounds; a
        # zero or negative value is treated as no deadline rather than as one
        # that fell due the day the member enrolled.
        if isinstance(days, int) and days > 0:
            if entry.deadline_days is None or days < entry.deadline_days:
                entry.deadline_days = days
        if entry.description is None and link.program_specific_description:
            entry.description = link.program_specific_description
        if entry.message is None and link.notification_message:
            entry.message = link.notification_message
    return settings_by_requirement


def cycle_start_date(enrollment: Any, tz: ZoneInfo) -> Optional[date]:
    """The department-calendar day the member's current cycle began."""
    start = getattr(enrollment, "cycle_started_at", None) or getattr(
        enrollment, "enrolled_at", None
    )
    return local_date(start, tz) if start is not None else None


def requirement_due_date(
    enrollment: Any, deadline_days: Optional[int], tz: ZoneInfo
) -> Optional[date]:
    """Cycle start + ``deadline_days``, or ``None`` when there is no deadline."""
    if not deadline_days or deadline_days <= 0:
        return None
    start = cycle_start_date(enrollment, tz)
    return start + timedelta(days=deadline_days) if start else None


def is_overdue(due: Optional[date], status: Any, today: date) -> bool:
    """Past its due date and not satisfied. The due date itself is not late."""
    return due is not None and _status(status) not in SATISFIED_STATUSES and today > due


async def annotate_progress_rows(
    db: AsyncSession,
    enrollment: Any,
    rows: Iterable[Any],
    tz: ZoneInfo,
    today: date,
) -> None:
    """Set ``due_date``, ``is_overdue`` and ``program_specific_description``.

    Plain instance attributes for the response, never persisted — the same
    shape as ``reads_compliance``. The page shows the server's verdict on the
    department's calendar rather than re-deriving it from the viewer's clock
    (pitfall #29).
    """
    rows = list(rows)
    if not rows:
        return
    links = await program_link_settings(db, enrollment.program_id)
    for row in rows:
        link = links.get(str(row.requirement_id))
        due = requirement_due_date(enrollment, link.deadline_days if link else None, tz)
        row.due_date = due
        row.is_overdue = is_overdue(due, row.status, today)
        row.program_specific_description = link.description if link else None


# ============================================
# Email
# ============================================


def long_date(value: date) -> str:
    """A calendar day as a member reads it: "October 15, 2026"."""
    return f"{value:%B} {value.day}, {value.year}"


def _when(days_left: int) -> str:
    if days_left <= 0:
        return "today"
    if days_left == 1:
        return "tomorrow"
    return f"in {days_left} days"


def _progress_link(enrollment_id: Any) -> str:
    return f"/training/my-progress/{enrollment_id}"


def _absolute(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def _subject_safe(text: str) -> str:
    # A subject is a header: a line break in a requirement name would end it.
    return " ".join((text or "").split())


async def _deliver(
    db: AsyncSession,
    org: Optional[Organization],
    user: User,
    *,
    subject: str,
    title: str,
    body_html: str,
    text_body: str,
    bell_message: str,
    action_path: str,
    accent: str,
    chip: str,
    template_type: str,
) -> bool:
    """Email the member (if they receive training reminders) and ring the bell.

    Returns whether the email was accepted. Never raises: a notice that
    cannot go out must not fail the sweep or the progress write behind it.
    """
    from app.services.email_service import EmailService, wrap_email_body
    from app.services.notifications_service import NotificationsService

    emailed = False
    try:
        if user.email and member_receives_email(
            getattr(user, "notification_preferences", None),
            EmailKind.TRAINING_REMINDERS,
            department_required_kinds(org),
        ):
            html_body = wrap_email_body(
                org,
                title,
                body_html + _action_html(action_path),
                header_color=accent,
                chip=chip,
            )
            sent, _failed = await EmailService(organization=org).send_email(
                to_emails=[user.email],
                subject=_subject_safe(subject),
                html_body=html_body,
                text_body=f"{text_body}\n\nView your progress: {_absolute(action_path)}\n",
                db=db,
                template_type=template_type,
            )
            emailed = sent > 0
    except Exception as exc:
        logger.warning("Program requirement email failed: {}", exc)

    try:
        await NotificationsService(db).log_notification(
            organization_id=str(user.organization_id),
            log_data={
                "recipient_id": str(user.id),
                "channel": NotificationChannel.IN_APP,
                "subject": _subject_safe(subject)[:500],
                "message": bell_message,
                "category": NotificationCategory.TRAINING,
                "action_url": action_path,
                "delivered": True,
                "sent_at": datetime.now(timezone.utc),
            },
        )
    except Exception as exc:
        logger.warning("Program requirement bell entry failed: {}", exc)
    return emailed


def _action_html(path: str) -> str:
    return action(html.escape(_absolute(path)), "View your progress")


async def _keep_updated_at(db: AsyncSession, rows: List[Any], **values: Any):
    """Write bookkeeping without touching ``updated_at``.

    The struggling-member sweep reads ``updated_at`` as "last progress", so a
    reminder marker bumping it would make a stalled requirement look active.
    Naming the column in the UPDATE suppresses the ORM's ``onupdate``. The
    loaded rows are then given the same values as already-committed state:
    sessions here do not expire on commit, so a second rollup in the same
    request would otherwise read the stale marker and send again.
    """
    if not rows:
        return
    await db.execute(
        update(RequirementProgress)
        .where(RequirementProgress.id.in_([str(row.id) for row in rows]))
        .values(updated_at=RequirementProgress.updated_at, **values)
        .execution_options(synchronize_session=False)
    )
    for row in rows:
        for key, value in values.items():
            set_committed_value(row, key, value)


# ============================================
# Completion message
# ============================================


async def notify_completed_requirements(
    db: AsyncSession, enrollment: Any, *, send: bool
) -> int:
    """Email each newly completed requirement's ``notification_message``.

    Called from the enrollment rollup, which every progress write ends in, so
    one place sees every path that can complete a requirement. "Newly" is
    ``completion_notice_sent_at`` still empty on a completed row; the stamp is
    set on every completed row (message or not, sent or not) so a message
    added later never announces an old completion, and it is cleared when a
    row leaves the completed state so a re-completion after a reset is
    announced again. ``send`` False stamps without sending — for an enrollment
    that is no longer running. Returns the number of messages sent.
    """
    result = await db.execute(
        select(RequirementProgress).where(
            RequirementProgress.enrollment_id == str(enrollment.id)
        )
    )
    rows = list(result.scalars().all())
    pending = [
        row
        for row in rows
        if _status(row.status) in COMPLETED_STATUSES
        and row.completion_notice_sent_at is None
    ]
    reopened = [
        row
        for row in rows
        if _status(row.status) not in COMPLETED_STATUSES
        and row.completion_notice_sent_at is not None
    ]
    if not pending and not reopened:
        return 0

    sent = 0
    if pending and send:
        links = await program_link_settings(db, enrollment.program_id)
        to_announce: List[tuple] = []
        for row in pending:
            link = links.get(str(row.requirement_id))
            if link is not None and link.message:
                to_announce.append((row, link.message))
        if to_announce:
            org = await db.get(Organization, str(enrollment.organization_id))
            user = await _member(db, enrollment)
            program = await db.get(TrainingProgram, str(enrollment.program_id))
            names = await _requirement_names(
                db, [str(row.requirement_id) for row, _ in to_announce]
            )
            program_name = program.name if program else "your training program"
            for row, text in to_announce:
                message: str = text
                if user is None:
                    break
                name = names.get(str(row.requirement_id), "A requirement")
                await _deliver(
                    db,
                    org,
                    user,
                    subject=f"Requirement complete: {name}",
                    title="Requirement complete",
                    body_html=(
                        f"<p>You completed <strong>{html.escape(name)}</strong> "
                        f"in {html.escape(program_name)}.</p>"
                        f'<p style="white-space:pre-line;">{html.escape(message)}</p>'
                    ),
                    text_body=(f"You completed {name} in {program_name}.\n\n{message}"),
                    bell_message=message,
                    action_path=_progress_link(enrollment.id),
                    accent=ACCENT_GREEN,
                    chip="Training",
                    template_type="program_requirement_completed",
                )
                sent += 1

    await _keep_updated_at(
        db, pending, completion_notice_sent_at=datetime.now(timezone.utc)
    )
    await _keep_updated_at(db, reopened, completion_notice_sent_at=None)
    await db.commit()
    return sent


async def _member(db: AsyncSession, enrollment: Any) -> Optional[User]:
    result = await db.execute(
        select(User).where(
            User.id == str(enrollment.user_id),
            User.organization_id == str(enrollment.organization_id),
            User.status.in_(ACTIVE_ACCOUNT_STATUSES),
            User.deleted_at.is_(None),
        )
    )
    user: Optional[User] = result.scalar_one_or_none()
    return user


async def _requirement_names(db: AsyncSession, ids: List[str]) -> Dict[str, str]:
    if not ids:
        return {}
    result = await db.execute(
        select(TrainingRequirement.id, TrainingRequirement.name).where(
            TrainingRequirement.id.in_(ids)
        )
    )
    return {str(row[0]): row[1] for row in result.all()}


# ============================================
# Due-date reminders (daily sweep)
# ============================================


@dataclass
class _Notice:
    row: Any
    requirement_id: str
    due: date
    days_left: int
    offset: Optional[int]  # None for the overdue notice

    @property
    def overdue(self) -> bool:
        return self.offset is None


async def send_requirement_deadline_notices(
    db: AsyncSession, organization_id: Any
) -> Dict[str, int]:
    """Send the due-date warnings and overdue notices owed today.

    One email per enrollment per run, listing each requirement that is owed a
    notice, so a member with five overdue items hears about them once.
    Returns ``{"warnings_sent", "overdue_sent"}`` counted per requirement.
    """
    org_id = str(organization_id)
    org = await db.get(Organization, org_id)
    tz = scheduling_timezone(org)
    today = today_in(tz)

    links_result = await db.execute(
        select(ProgramRequirement.program_id)
        .join(TrainingProgram, TrainingProgram.id == ProgramRequirement.program_id)
        .where(
            TrainingProgram.organization_id == org_id,
            ProgramRequirement.custom_deadline_days > 0,
        )
        .distinct()
    )
    program_ids = [str(pid) for pid in links_result.scalars().all()]
    if not program_ids:
        return {"warnings_sent": 0, "overdue_sent": 0}

    rows_result = await db.execute(
        select(RequirementProgress, ProgramEnrollment)
        .join(
            ProgramEnrollment,
            RequirementProgress.enrollment_id == ProgramEnrollment.id,
        )
        .where(
            ProgramEnrollment.organization_id == org_id,
            ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
            ProgramEnrollment.program_id.in_(program_ids),
            or_(
                RequirementProgress.status.is_(None),
                RequirementProgress.status.notin_(list(SATISFIED_STATUSES)),
            ),
        )
    )
    by_enrollment: Dict[str, tuple] = {}
    for row, enrollment in rows_result.all():
        by_enrollment.setdefault(str(enrollment.id), (enrollment, []))[1].append(row)

    programs = {
        str(p.id): p
        for p in (
            await db.execute(
                select(TrainingProgram).where(
                    TrainingProgram.id.in_(program_ids),
                    TrainingProgram.organization_id == org_id,
                )
            )
        )
        .scalars()
        .all()
    }
    link_cache: Dict[str, Dict[str, LinkSettings]] = {}

    owed: Dict[str, List[_Notice]] = {}
    for enrollment_id, (enrollment, rows) in by_enrollment.items():
        program_id = str(enrollment.program_id)
        if program_id not in link_cache:
            link_cache[program_id] = await program_link_settings(db, program_id)
        links = link_cache[program_id]
        program = programs.get(program_id)
        conditions = normalize_reminder_conditions(
            getattr(program, "reminder_conditions", None),
            getattr(program, "warning_days_before", None),
        )
        for row in rows:
            link = links.get(str(row.requirement_id))
            due = requirement_due_date(
                enrollment, link.deadline_days if link else None, tz
            )
            if due is None:
                continue
            days_left = (due - today).days
            if days_left < 0:
                if row.overdue_notice_sent_for != due:
                    owed.setdefault(enrollment_id, []).append(
                        _Notice(row, str(row.requirement_id), due, days_left, None)
                    )
                continue
            offset = due_warning_offset(days_left, row.progress_percentage, conditions)
            if offset is None:
                continue
            already = (
                row.due_warning_sent_for == due
                and row.due_warning_days_before is not None
                and row.due_warning_days_before <= offset
            )
            if not already:
                owed.setdefault(enrollment_id, []).append(
                    _Notice(row, str(row.requirement_id), due, days_left, offset)
                )

    if not owed:
        return {"warnings_sent": 0, "overdue_sent": 0}

    names = await _requirement_names(
        db, sorted({n.requirement_id for notices in owed.values() for n in notices})
    )
    warnings_sent = 0
    overdue_sent = 0
    for enrollment_id, notices in owed.items():
        enrollment = by_enrollment[enrollment_id][0]
        user = await _member(db, enrollment)
        if user is not None:
            program = programs.get(str(enrollment.program_id))
            await _send_deadline_email(
                db, org, user, enrollment, program, notices, names
            )
        # Recorded whether or not a member was found or the mailer accepted
        # it: the bell entry is the record, and a mailer that is down (or a
        # member who left) must not turn a daily sweep into a daily repeat.
        for notice in notices:
            if notice.overdue:
                await _keep_updated_at(
                    db, [notice.row], overdue_notice_sent_for=notice.due
                )
                overdue_sent += 1
            else:
                await _keep_updated_at(
                    db,
                    [notice.row],
                    due_warning_sent_for=notice.due,
                    due_warning_days_before=notice.offset,
                )
                warnings_sent += 1
        await db.commit()

    logger.info(
        f"Program requirement deadlines | org={org_id} "
        f"warnings={warnings_sent} overdue={overdue_sent}"
    )
    return {"warnings_sent": warnings_sent, "overdue_sent": overdue_sent}


async def _send_deadline_email(
    db: AsyncSession,
    org: Optional[Organization],
    user: User,
    enrollment: Any,
    program: Optional[TrainingProgram],
    notices: List[_Notice],
    names: Dict[str, str],
) -> None:
    program_name = program.name if program else "your training program"
    notices = sorted(notices, key=lambda n: n.due)
    overdue = [n for n in notices if n.overdue]

    def line(notice: _Notice) -> str:
        name = names.get(notice.requirement_id, "A requirement")
        if notice.overdue:
            return f"{name} — was due {long_date(notice.due)}"
        return f"{name} — due {long_date(notice.due)} ({_when(notice.days_left)})"

    lines = [line(n) for n in notices]
    if len(notices) == 1:
        name = names.get(notices[0].requirement_id, "A requirement")
        subject = (
            f"Training requirement overdue: {name}"
            if overdue
            else f"Training requirement due {_when(notices[0].days_left)}: {name}"
        )
    else:
        subject = f"{len(notices)} training requirements need attention: {program_name}"
    title = "Training requirement overdue" if overdue else "Training requirement due"
    lead = (
        f"These requirements in {program_name} have a due date set by your "
        "training officer:"
        if len(notices) > 1
        else f"This requirement in {program_name} has a due date set by your "
        "training officer:"
    )
    body = (
        f"<p>{html.escape(lead)}</p><ul>"
        + "".join(f"<li>{html.escape(text)}</li>" for text in lines)
        + "</ul><p>Log the outstanding training, or talk to a training officer "
        "if you need more time.</p>"
    )
    text = lead + "\n\n" + "\n".join(f"- {text}" for text in lines)
    await _deliver(
        db,
        org,
        user,
        subject=subject,
        title=title,
        body_html=body,
        text_body=text,
        bell_message="; ".join(lines),
        action_path=_progress_link(enrollment.id),
        accent=ACCENT_RED if overdue else ACCENT_AMBER,
        chip="Action required" if overdue else "Reminder",
        template_type="program_requirement_deadline",
    )
