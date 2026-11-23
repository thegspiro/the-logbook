"""The morning-after reminder to record an outreach event's guest headcount.

Run daily by the ``guest_headcount_reminders`` task. An outreach event — by
the same rule the Outreach Impact report counts (``outreach_event_clause``,
pitfall #29) — that ended before today on the department's calendar, within
the last ``LOOKBACK_DAYS``, with no guest headcount recorded, gets one reminder:
an email and a bell notification linking to its event page.

Who is reminded: the event's organizer and alternate, and its creator, but only
those who hold ``events.manage``, because recording a headcount needs it and a
reminder about a card the recipient cannot see would only confuse them. The
organizer and alternate come first; the creator is asked only when neither of
them can record it. When nobody qualifies, nobody is reminded, and the event is
marked so later runs do not keep looking at it.

Each event is reminded at most once: ``REMINDER_MARKER`` in its
``custom_fields`` is set after the sends and committed with them. That is
"send, then stamp" (pitfall #36), so a crash between the two can at worst send
a second reminder, which for a reminder is a nuisance and not harm.
Postponing an event clears the marker, since the reminder was about a run that
did not happen.

Email is the channel of record (pitfall #18): the bell is an addition. The
email honours the member's "Event officer duties" preference and the
department's switch on the Guest Headcount Reminder template.
"""

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Dict, List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings
from app.core.utils import generate_uuid
from app.models.email_template import EmailTemplateType
from app.models.event import Event
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import Organization, User
from app.services.dashboard_widget_service import outreach_event_clause
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_service import EmailService, _redact_email
from app.services.email_template_service import EmailTemplateService
from app.services.event_organizer_service import (
    EVENT_MANAGER_PERMISSION,
    eligible_member_clause,
    organizer_ids,
)
from app.utils.org_timezone import (
    format_in_org_timezone,
    org_today,
    scheduling_timezone,
)

REMINDER_MARKER = "guest_headcount_reminder_sent"

# Only events that ended this recently are reminded about. Without a limit the
# first run after an upgrade would email organizers about every outreach event
# they ever ran without a count.
LOOKBACK_DAYS = 14

NOTIFICATION_CATEGORY = "event_headcount"


@dataclass
class ReminderCounts:
    events: int = 0
    emails: int = 0
    notifications: int = 0


def can_record_headcount(user: User) -> bool:
    """Whether *user* holds the permission ``set_guest_headcount`` requires.

    Resolved the same way ``require_permission`` resolves it (CLAUDE.md #29) —
    a hand-rolled loop over ``user.roles`` alone missed a grant that reaches a
    user only through their operational rank's defaults, not a position of
    their own (see ``_collect_user_permissions``), which silently dropped that
    organizer from their own event's reminder.
    """
    return user_has_permission(user, EVENT_MANAGER_PERMISSION)


class GuestHeadcountReminderService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def send_reminders(self, organization: Organization) -> ReminderCounts:
        """Remind about each outreach event still owed a headcount; commits."""
        org_id = str(organization.id)
        counts = ReminderCounts()

        # Midnight at the start of today on the department's calendar: an
        # event that ended before it ended "yesterday or earlier", so the
        # first run after it, the next morning, is the one that reminds.
        today = org_today(organization)
        tz = scheduling_timezone(organization)
        start_of_today = datetime.combine(today, time.min, tzinfo=tz).astimezone(
            timezone.utc
        )
        earliest_end = start_of_today - timedelta(days=LOOKBACK_DAYS)

        events = (
            (
                await self.db.execute(
                    select(Event).where(
                        Event.organization_id == org_id,
                        outreach_event_clause(org_id),
                        Event.guest_headcount.is_(None),
                        Event.end_datetime < start_of_today,
                        Event.end_datetime >= earliest_end,
                    )
                )
            )
            .scalars()
            .all()
        )
        pending = [
            e for e in events if not (e.custom_fields or {}).get(REMINDER_MARKER)
        ]
        if not pending:
            return counts

        template_svc = EmailTemplateService(self.db)
        email_off = await template_svc.is_switched_off(
            org_id, EmailTemplateType.GUEST_HEADCOUNT_REMINDER
        )
        required_kinds = department_required_kinds(organization)
        people = await self._load_people(pending, org_id)

        for event in pending:
            recipients = self._recipients(event, people)
            for recipient in recipients:
                self._add_bell(event, recipient, org_id)
                counts.notifications += 1
                if (
                    recipient.email
                    and not email_off
                    and member_receives_email(
                        recipient.notification_preferences,
                        EmailKind.EVENT_DUTIES,
                        required_kinds,
                    )
                    and await self._send_email(
                        organization, template_svc, event, recipient
                    )
                ):
                    counts.emails += 1
            if recipients:
                counts.events += 1
            # A new dict rather than an in-place change, so the JSON column is
            # seen as modified (pitfall #12).
            event.custom_fields = {**(event.custom_fields or {}), REMINDER_MARKER: True}

        await self.db.commit()
        return counts

    async def _load_people(self, events: List[Event], org_id: str) -> Dict[str, User]:
        """Every organizer, alternate and creator of *events* who can still run one."""
        ids = {i for e in events for i in organizer_ids(e)}
        ids.update(str(e.created_by) for e in events if e.created_by)
        if not ids:
            return {}
        users = (
            (
                await self.db.execute(
                    select(User)
                    .where(
                        User.id.in_(list(ids)),
                        User.organization_id == org_id,
                        eligible_member_clause(),
                    )
                    .options(selectinload(User.roles))
                )
            )
            .scalars()
            .all()
        )
        return {str(u.id): u for u in users}

    @staticmethod
    def _recipients(event: Event, people: Dict[str, User]) -> List[User]:
        """The organizer and alternate who can record a headcount, or failing
        both, the creator if they can."""
        organizers = [
            people[i]
            for i in organizer_ids(event)
            if i in people and can_record_headcount(people[i])
        ]
        if organizers:
            return organizers
        creator = people.get(str(event.created_by)) if event.created_by else None
        if creator is not None and can_record_headcount(creator):
            return [creator]
        return []

    def _add_bell(self, event: Event, recipient: User, org_id: str) -> None:
        self.db.add(
            NotificationLog(
                id=generate_uuid(),
                organization_id=org_id,
                recipient_id=str(recipient.id),
                channel=NotificationChannel.IN_APP,
                category=NOTIFICATION_CATEGORY,
                subject=f"Record the guest headcount for {event.title}",
                message=(
                    f'"{event.title}" has ended with no guest headcount. Enter '
                    "how many people attended so the Outreach Impact "
                    "report counts them."
                ),
                action_url=f"/events/{event.id}",
                notification_metadata={"event_id": str(event.id)},
                delivered=True,
            )
        )

    async def _send_email(
        self,
        organization: Organization,
        template_svc: EmailTemplateService,
        event: Event,
        recipient: User,
    ) -> bool:
        event_date: Optional[str] = (
            format_in_org_timezone(event.start_datetime, organization, "%B %d, %Y")
            if event.start_datetime
            else ""
        )
        try:
            subject, html_body, text_body = await template_svc.render_stored_or_default(
                organization,
                EmailTemplateType.GUEST_HEADCOUNT_REMINDER,
                {
                    "recipient_name": recipient.preferred_name
                    or recipient.first_name
                    or "",
                    "event_title": event.title or "",
                    "event_date": event_date,
                    "event_url": f"{settings.FRONTEND_URL}/events/{event.id}",
                },
            )
            sent, _ = await EmailService(organization=organization).send_email(
                to_emails=[recipient.email],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=self.db,
                template_type=EmailTemplateType.GUEST_HEADCOUNT_REMINDER.value,
            )
            return sent > 0
        except Exception as e:
            # One bad address must not stop the rest of the department's
            # reminders; the bell is already queued for this recipient.
            logger.error(
                "Guest headcount reminder email to {} for event {} failed: {}",
                _redact_email(recipient.email),
                event.id,
                e,
            )
            return False
