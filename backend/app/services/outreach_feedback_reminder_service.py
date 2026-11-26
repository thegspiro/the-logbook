"""One reminder to an outreach requester who has not answered the feedback form.

Run daily by the ``outreach_feedback_reminders`` task (owner decision
2026-11-26: three days after Completed, once, as a template a department can
switch off). A request is reminded when all of these hold:

- the department has a feedback form it can offer (``configured``);
- the request is Completed, and was completed between ``REMINDER_DAYS`` and
  ``LOOKBACK_DAYS`` ago — completion time being the activity row the move to
  Completed logs, the same rule the Outreach Impact report counts by;
- the requester left an email address, and the request has a status link;
- no feedback has arrived, and no reminder has gone out
  (``feedback_reminder_sent_at`` is NULL).

``LOOKBACK_DAYS`` is what keeps the first run after an upgrade, or after a
department first picks a form, from emailing everyone whose request was ever
completed: only the last fortnight's requesters are asked.

Each request is reminded at most once: ``feedback_reminder_sent_at`` is set
after the send and committed with it, request by request. That is "send, then
stamp" (pitfall #36), so a crash between the two can at worst send a second
reminder, which for a reminder is a nuisance and not harm. A department that
switched the template off sends nothing and stamps nothing.

The recipient is a member of the public, so the template carries the public
footer, and the link is the requester's own status page, whose token is the
credential — it goes only to the address the requester gave.
"""

from datetime import datetime, timedelta, timezone

from loguru import logger
from sqlalchemy import and_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.email_template import EmailTemplateType
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestFeedback,
    EventRequestStatus,
)
from app.models.user import Organization
from app.services.email_service import EmailService, _redact_email
from app.services.email_template_service import EmailTemplateService
from app.services.event_request_service import outreach_type_label
from app.services.outreach_feedback_service import OutreachFeedbackService
from app.utils.org_timezone import format_in_org_timezone

REMINDER_DAYS = 3

# Only requests completed this recently are reminded. Without a limit the first
# run after an upgrade would email every requester the department ever served.
LOOKBACK_DAYS = 14


def _now() -> datetime:
    # Whole seconds, like every stamp written to a DATETIME(0) column: MySQL 8
    # rounds a fraction where MariaDB truncates it.
    return datetime.now(timezone.utc).replace(microsecond=0)


class OutreachFeedbackReminderService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def send_reminders(self, organization: Organization) -> int:
        """Remind each requester still owed one; commits. Returns emails sent."""
        org_id = str(organization.id)
        if await OutreachFeedbackService(self.db).configured(organization) is None:
            return 0
        template_svc = EmailTemplateService(self.db)
        if await template_svc.is_switched_off(
            org_id, EmailTemplateType.OUTREACH_FEEDBACK_REMINDER
        ):
            return 0

        now = _now()
        completed_between = and_(
            EventRequestActivity.request_id == EventRequest.id,
            EventRequestActivity.new_status == EventRequestStatus.COMPLETED.value,
            EventRequestActivity.created_at <= now - timedelta(days=REMINDER_DAYS),
            EventRequestActivity.created_at > now - timedelta(days=LOOKBACK_DAYS),
        )
        pending = (
            (
                await self.db.execute(
                    select(EventRequest)
                    .where(
                        EventRequest.organization_id == org_id,
                        EventRequest.status == EventRequestStatus.COMPLETED,
                        EventRequest.feedback_reminder_sent_at.is_(None),
                        EventRequest.contact_email.isnot(None),
                        EventRequest.contact_email != "",
                        exists().where(completed_between),
                        ~exists().where(
                            EventRequestFeedback.request_id == EventRequest.id
                        ),
                    )
                    .order_by(EventRequest.id)
                )
            )
            .scalars()
            .all()
        )

        sent = 0
        for event_request in pending:
            token = event_request.status_token
            address = event_request.contact_email
            if not token or not address:
                continue
            if await self._send(
                organization, template_svc, event_request, token, address
            ):
                event_request.feedback_reminder_sent_at = _now()
                await self.db.commit()
                sent += 1
        return sent

    async def _send(
        self,
        organization: Organization,
        template_svc: EmailTemplateService,
        event_request: EventRequest,
        token: str,
        address: str,
    ) -> bool:
        base = (settings.FRONTEND_URL or "").rstrip("/")
        try:
            subject, html_body, text_body = await template_svc.render_stored_or_default(
                organization,
                EmailTemplateType.OUTREACH_FEEDBACK_REMINDER,
                {
                    "requester_name": event_request.contact_name or "",
                    "request_title": event_request.organization_name
                    or event_request.contact_name
                    or "",
                    "outreach_type": outreach_type_label(
                        organization, event_request.outreach_type or ""
                    ),
                    "visit_date": (
                        format_in_org_timezone(
                            event_request.event_date, organization, "%B %d, %Y"
                        )
                        if event_request.event_date
                        else ""
                    ),
                    "feedback_url": f"{base}/event-request/status/{token}",
                },
            )
            delivered, _ = await EmailService(organization=organization).send_email(
                to_emails=[address],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=self.db,
                template_type=EmailTemplateType.OUTREACH_FEEDBACK_REMINDER.value,
            )
            return delivered > 0
        except Exception as e:
            # One bad address must not stop the rest of the department's
            # reminders. Not stamped, so tomorrow's run tries again while the
            # request is inside the lookback window.
            logger.error(
                "Outreach feedback reminder to {} for request {} failed: {}",
                _redact_email(address),
                event_request.id,
                e,
            )
            return False
