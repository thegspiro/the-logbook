"""Remind the training officers of a sign-off left waiting.

Owner decision 2026-11-23 ("A sign-off session waiting for approval: remind
the approvers after 7 days"). A training session that needs an officer's
confirmation credits nobody from finalize until an officer approves or rejects
it, and that stays as it is. What is added: the daily
``training_approval_reminders`` task emails the training officers once an
approval has waited 7 days, and once more at 14 days, then stops. Email only
(pitfall #18); no SMS.

**Which approval.** The newest approval of its session, still PENDING, with a
live link. A re-finalize leaves the earlier approval PENDING with its link
killed (``TrainingSessionService._supersede``), so the link test is what keeps
a superseded roster from being chased; the newest-only test matches
``load_held_sessions``, which decides what a pending sign-off withholds.

**Who.** The members a sign-off request goes to: current members holding the
training-officer role who take training-duty email
(``TrainingSessionService._notify_training_officers``).

**Safe to run twice (pitfall #36).** The approval's id is the key and
``training_approvals.reminder_sent_at`` the stamp: the first reminder is due
while it is empty, the second while it predates the approval's fourteenth day.
Each reminder is claimed by a conditional UPDATE on that stamp and committed
**before** the email is sent — at most once: a re-run, or a second worker that
slipped past the scheduler's claim, finds the stamp already set and sends
nothing, and a crash between the claim and the send loses that reminder
rather than repeating it. An approval first seen after its fourteenth day
(the first run after an upgrade) gets one reminder, not two.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from loguru import logger
from sqlalchemy import ColumnElement, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import settings
from app.core.constants import ROLE_TRAINING_OFFICER
from app.models.email_template import EmailTemplateType
from app.models.event import Event
from app.models.training import ApprovalStatus, TrainingApproval, TrainingSession
from app.models.user import (
    ACTIVE_ACCOUNT_STATUSES,
    Organization,
    Role,
    User,
    user_roles,
)
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    recipients_for,
)
from app.services.email_service import EmailService, _redact_email
from app.services.email_template_service import EmailTemplateService
from app.utils.org_timezone import format_in_org_timezone

TEMPLATE = EmailTemplateType.TRAINING_APPROVAL_REMINDER

#: Days after finalize at which a still-pending approval is reminded. Two, then
#: stop: a sign-off nobody has acted on in a fortnight needs a person, not a
#: third email.
FIRST_REMINDER = timedelta(days=7)
SECOND_REMINDER = timedelta(days=14)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@dataclass
class _Due:
    """An approval due a reminder, read before anything commits."""

    approval_id: str
    token: str
    created: datetime
    second: bool
    days_waiting: int
    attendees: int
    course_name: str
    event_title: str
    event_date: str


@dataclass
class ReminderCounts:
    approvals: int = 0
    emails: int = 0


async def _training_officers(db: AsyncSession, organization_id: str) -> List[User]:
    rows = await db.execute(
        select(User)
        .join(user_roles, User.id == user_roles.c.user_id)
        .join(Role, Role.id == user_roles.c.position_id)
        .where(
            Role.slug == ROLE_TRAINING_OFFICER,
            Role.organization_id == organization_id,
            User.organization_id == organization_id,
            User.status.in_(ACTIVE_ACCOUNT_STATUSES),
        )
    )
    return list(dict.fromkeys(rows.scalars().all()))


async def _claim(
    db: AsyncSession,
    approval_id: str,
    created: datetime,
    now: datetime,
    second: bool,
) -> bool:
    """Stamp the reminder before sending it; False when it was already sent."""
    condition: ColumnElement[bool] = TrainingApproval.reminder_sent_at.is_(None)
    if second:
        condition = or_(
            condition, TrainingApproval.reminder_sent_at < created + SECOND_REMINDER
        )
    result = await db.execute(
        update(TrainingApproval)
        .where(
            TrainingApproval.id == approval_id,
            TrainingApproval.status == ApprovalStatus.PENDING,
            condition,
        )
        .values(reminder_sent_at=now)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return bool(getattr(result, "rowcount", 0))


async def send_approval_reminders(
    db: AsyncSession, organization: Organization, now: Optional[datetime] = None
) -> ReminderCounts:
    """Remind the officers of every approval in *organization* now due one."""
    counts = ReminderCounts()
    now = now or datetime.now(timezone.utc)
    org_id = str(organization.id)
    newer = aliased(TrainingApproval)
    rows = (
        await db.execute(
            select(TrainingApproval, TrainingSession, Event)
            .join(
                TrainingSession,
                TrainingSession.id == TrainingApproval.training_session_id,
            )
            .join(Event, Event.id == TrainingApproval.event_id)
            .where(
                TrainingApproval.organization_id == org_id,
                TrainingSession.organization_id == org_id,
                Event.organization_id == org_id,
                TrainingApproval.status == ApprovalStatus.PENDING,
                TrainingApproval.token_expires_at > now,
                TrainingApproval.created_at <= now - FIRST_REMINDER,
                Event.is_cancelled.isnot(True),
                ~select(newer.id)
                .where(
                    newer.training_session_id == TrainingApproval.training_session_id,
                    newer.created_at > TrainingApproval.created_at,
                )
                .exists(),
            )
            .order_by(TrainingApproval.created_at)
        )
    ).all()
    if not rows:
        return counts

    # Read into plain values first: each claim commits, which expires the rows.
    due: List[_Due] = []
    for approval, session, event in rows:
        created = _as_utc(approval.created_at)
        stamped = _as_utc(approval.reminder_sent_at)
        attendees = len(approval.attendee_data or [])
        if created is None or not attendees:
            continue
        age = now - created
        second = age >= SECOND_REMINDER and (
            stamped is None or stamped < created + SECOND_REMINDER
        )
        if not second and stamped is not None:
            continue
        due.append(
            _Due(
                approval_id=str(approval.id),
                token=approval.approval_token,
                created=created,
                second=second,
                days_waiting=age.days,
                attendees=attendees,
                course_name=session.course_name or event.title or "",
                event_title=event.title or "",
                event_date=(
                    format_in_org_timezone(
                        event.start_datetime, organization, "%B %d, %Y"
                    )
                    or ""
                    if event.start_datetime
                    else ""
                ),
            )
        )

    officers: Optional[List[User]] = None
    template_svc = EmailTemplateService(db)
    email_off = await template_svc.is_switched_off(org_id, TEMPLATE)
    for item in due:
        if not await _claim(db, item.approval_id, item.created, now, item.second):
            continue
        counts.approvals += 1
        if email_off:
            continue
        if officers is None:
            officers = [
                o
                for o in recipients_for(
                    await _training_officers(db, org_id),
                    EmailKind.TRAINING_DUTIES,
                    department_required_kinds(organization),
                )
                if o.email
            ]
        counts.emails += await _send(db, organization, template_svc, officers, item)
    return counts


async def _send(
    db: AsyncSession,
    organization: Organization,
    template_svc: EmailTemplateService,
    officers: List[User],
    item: "_Due",
) -> int:
    sent = 0
    email_service = EmailService(organization=organization)
    for officer in officers:
        try:
            subject, html_body, text_body = await template_svc.render_stored_or_default(
                organization,
                TEMPLATE,
                {
                    "recipient_name": officer.preferred_name
                    or officer.first_name
                    or "",
                    "course_name": item.course_name,
                    "event_title": item.event_title,
                    "event_date": item.event_date,
                    "attendee_count": str(item.attendees),
                    "days_waiting": str(item.days_waiting),
                    "approval_url": (
                        f"{settings.FRONTEND_URL}/training/approve/{item.token}"
                    ),
                },
            )
            count, _ = await email_service.send_email(
                to_emails=[officer.email],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=db,
                template_type=TEMPLATE.value,
            )
            sent += count
        except Exception as e:
            # One bad address must not stop the others.
            logger.error(
                "Training approval reminder to {} for approval {} failed: {}",
                _redact_email(officer.email),
                item.approval_id,
                e,
            )
    return sent
