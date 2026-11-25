"""Tell the officer handling an outreach request that its requester answered.

Called by ``OutreachFeedbackService.submit`` for every response (owner
decision 2026-11-24: every response, not only low ratings, since a request
gets at most one). A response rated in the bottom three-fifths of its scale
— 3 or less out of 5 — is flagged in the subject and the bell, so a complaint
reads as one in an inbox.

Who is told, in order, stopping at the first that yields anyone:

1. the request's coordinator (``assigned_to``);
2. the department's default coordinator (``default_assignee_id``);
3. every member who manages events.

Each must be a current member holding ``events.manage``, because the notice
links to the request page and a link to a page the recipient cannot open
would only confuse them. A coordinator who has left, or lost the permission,
falls through to the next step rather than silencing the notice.

Delivery, and why in this order (pitfall #36). The bell rows are added before
the submit commits, so they land in the same transaction as the response: a
response that was stored has its bell, and one that was refused has none. The
emails go after the commit, once per stored response — the unique constraint
on ``event_request_feedback.request_id`` is what keeps a second submit from
producing a second notice. A crash between the commit and the emails loses
the emails, not the bell (at most once), and a failed email never fails the
requester's submit, because their feedback is already saved.

Email is the channel of record (pitfall #18): the bell is an addition. The
email honours the member's "Event officer duties" preference and the
department's switch on the Requester Feedback Received template.
"""

from dataclasses import dataclass, field
from typing import List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings
from app.core.utils import generate_uuid
from app.models.email_template import EmailTemplateType
from app.models.event_request import EventRequest
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import Organization, User
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
)
from app.services.event_request_service import (
    get_pipeline_settings,
    outreach_type_label,
)
from app.utils.org_timezone import format_in_org_timezone

NOTIFICATION_CATEGORY = "outreach_feedback"

LOW_RATING_PREFIX = "Low rating: "


def is_low_rating(rating: Optional[int], scale_max: Optional[int]) -> bool:
    """A rating in the bottom three-fifths of its scale: 3 or less out of 5,
    6 or less out of 10. Unknown without a rating or a top of the scale."""
    if rating is None or not scale_max or scale_max <= 0:
        return False
    return rating * 5 <= scale_max * 3


def rating_text(rating: Optional[int], scale_max: Optional[int]) -> str:
    if rating is None:
        return "No rating given"
    return f"{rating} out of {scale_max}" if scale_max else str(rating)


@dataclass
class FeedbackNotice:
    """What the submit prepared: the recipients, and what to tell them."""

    event_request: EventRequest
    organization: Organization
    rating: Optional[int]
    scale_max: Optional[int]
    recipients: List[User] = field(default_factory=list)


class OutreachFeedbackNoticeService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def prepare(
        self,
        event_request: EventRequest,
        organization: Organization,
        rating: Optional[int],
        scale_max: Optional[int],
    ) -> FeedbackNotice:
        """Resolve the recipients and add their bells to the open transaction.

        Called before the submit commits; nothing here commits."""
        notice = FeedbackNotice(event_request, organization, rating, scale_max)
        notice.recipients = await self._recipients(event_request, organization)
        for recipient in notice.recipients:
            self._add_bell(notice, recipient)
        if not notice.recipients:
            logger.warning(
                "Outreach feedback on request {} reached nobody: no current "
                "member of org {} manages events",
                event_request.id,
                organization.id,
            )
        return notice

    async def send_emails(self, notice: FeedbackNotice) -> int:
        """Email each recipient; after the commit. Returns how many were sent.

        Never raises: the requester's feedback is already saved, and a failure
        here is logged rather than turned into an error on their page."""
        if not notice.recipients:
            return 0
        org_id = str(notice.organization.id)
        try:
            template_svc = EmailTemplateService(self.db)
            if await template_svc.is_switched_off(
                org_id, EmailTemplateType.OUTREACH_FEEDBACK_RECEIVED
            ):
                return 0
            required_kinds = department_required_kinds(notice.organization)
        except Exception as e:
            logger.error(
                "Outreach feedback notice for request {} could not start: {}",
                notice.event_request.id,
                e,
            )
            return 0
        sent = 0
        for recipient in notice.recipients:
            if (
                recipient.email
                and member_receives_email(
                    recipient.notification_preferences,
                    EmailKind.EVENT_DUTIES,
                    required_kinds,
                )
                and await self._send_email(notice, template_svc, recipient)
            ):
                sent += 1
        return sent

    async def _recipients(
        self, event_request: EventRequest, organization: Organization
    ) -> List[User]:
        org_id = str(organization.id)
        pipeline = get_pipeline_settings(organization)
        for user_id in (event_request.assigned_to, pipeline.get("default_assignee_id")):
            if not user_id:
                continue
            found = await self._members(org_id, user_id=str(user_id))
            if found:
                return found
        return await self._members(org_id)

    async def _members(self, org_id: str, user_id: Optional[str] = None) -> List[User]:
        """Current members of the department who manage events; one of them
        when *user_id* is given."""
        query = (
            select(User)
            .where(User.organization_id == org_id, eligible_member_clause())
            .options(selectinload(User.roles))
            .order_by(User.id)
        )
        if user_id is not None:
            query = query.where(User.id == user_id)
        users = (await self.db.execute(query)).scalars().all()
        return [u for u in users if user_has_permission(u, EVENT_MANAGER_PERMISSION)]

    @staticmethod
    def _request_title(event_request: EventRequest) -> str:
        return event_request.organization_name or event_request.contact_name or ""

    def _add_bell(self, notice: FeedbackNotice, recipient: User) -> None:
        req = notice.event_request
        low = is_low_rating(notice.rating, notice.scale_max)
        prefix = LOW_RATING_PREFIX if low else ""
        self.db.add(
            NotificationLog(
                id=generate_uuid(),
                organization_id=str(notice.organization.id),
                recipient_id=str(recipient.id),
                channel=NotificationChannel.IN_APP,
                category=NOTIFICATION_CATEGORY,
                subject=f"{prefix}Feedback from {req.contact_name}",
                message=(
                    f"{req.contact_name} sent feedback on "
                    f'"{self._request_title(req)}": '
                    f"{rating_text(notice.rating, notice.scale_max)}."
                ),
                action_url=f"/events/admin/requests/{req.id}",
                notification_metadata={
                    "request_id": str(req.id),
                    "rating": notice.rating,
                    "low_rating": low,
                },
                delivered=True,
            )
        )

    async def _send_email(
        self,
        notice: FeedbackNotice,
        template_svc: EmailTemplateService,
        recipient: User,
    ) -> bool:
        req = notice.event_request
        organization = notice.organization
        low = is_low_rating(notice.rating, notice.scale_max)
        try:
            subject, html_body, text_body = await template_svc.render_stored_or_default(
                organization,
                EmailTemplateType.OUTREACH_FEEDBACK_RECEIVED,
                {
                    "recipient_name": recipient.preferred_name
                    or recipient.first_name
                    or "",
                    "requester_name": req.contact_name or "",
                    "request_title": self._request_title(req),
                    "outreach_type": outreach_type_label(
                        organization, req.outreach_type or ""
                    ),
                    "visit_date": (
                        format_in_org_timezone(
                            req.event_date, organization, "%B %d, %Y"
                        )
                        if req.event_date
                        else ""
                    ),
                    "rating_text": rating_text(notice.rating, notice.scale_max),
                    "low_rating_prefix": LOW_RATING_PREFIX if low else "",
                    "request_url": (
                        f"{settings.FRONTEND_URL}/events/admin/requests/{req.id}"
                    ),
                },
            )
            sent, _ = await EmailService(organization=organization).send_email(
                to_emails=[recipient.email],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=self.db,
                template_type=EmailTemplateType.OUTREACH_FEEDBACK_RECEIVED.value,
            )
            return sent > 0
        except Exception as e:
            # One bad address must not stop the rest; the bell is already
            # stored for this recipient.
            logger.error(
                "Outreach feedback email to {} for request {} failed: {}",
                _redact_email(recipient.email),
                req.id,
                e,
            )
            return False
