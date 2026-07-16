"""Department message delivery / escalation.

When a department message is posted it is, by itself, only visible to members
who happen to open the app. This service fans a posted message out across the
channels members actually watch:

* an in-app notification (bell inbox) for every targeted member;
* an email when the message is urgent or requires acknowledgment;
* an SMS when the message is urgent (and Twilio is configured).

The fan-out is dispatched to FastAPI ``BackgroundTasks`` so the HTTP response
returns immediately, and runs on its own database session (the request's
session is closed by then). It is fire-and-forget: a delivery failure must never
undo or block the message that was already created.
"""

import html as _html
from typing import List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.notification import DepartmentMessage, NotificationLog
from app.models.user import Organization, User

# Free-form NotificationLog category (matches how other features tag theirs,
# e.g. "security", "scheduling").
MESSAGE_CATEGORY = "department_message"

# SMS bodies are billed per segment, so keep the escalation text short.
_SMS_MAX_LEN = 300


def _priority_value(message: DepartmentMessage) -> str:
    return (
        message.priority.value
        if hasattr(message.priority, "value")
        else str(message.priority)
    )


def _wants(prefs: Optional[dict], key: str) -> bool:
    """Whether a member opts in to a channel. Defaults to True when unset, so a
    member only stops receiving a channel by explicitly turning it off."""
    return (prefs or {}).get(key, True) is not False


def _text_to_html(text: str) -> str:
    """Escape plain-text message body and preserve line breaks for email."""
    return _html.escape(text or "").replace("\n", "<br>")


class MessageDeliveryService:
    """Fan a posted department message out to in-app / email / SMS channels."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def deliver(self, message: DepartmentMessage) -> None:
        """Deliver ``message`` to its targeted audience across channels.

        Never raises — every channel is best-effort and independently guarded so
        a failure in one does not suppress the others.
        """
        # Reuse the exact targeting the inbox uses so escalation and in-app
        # visibility never disagree about who the audience is.
        from app.services.messaging_service import MessagingService

        recipients = await MessagingService(self.db)._targeted_users(
            message, str(message.organization_id)
        )
        # Don't notify the author about their own post.
        recipients = [u for u in recipients if str(u.id) != str(message.posted_by)]
        if not recipients:
            return

        priority = _priority_value(message)
        is_urgent = priority == "urgent"
        escalate_email = is_urgent or bool(message.requires_acknowledgment)

        await self._create_in_app(message, recipients)

        org = None
        if escalate_email or is_urgent:
            org_result = await self.db.execute(
                select(Organization).where(
                    Organization.id == str(message.organization_id)
                )
            )
            org = org_result.scalar_one_or_none()

        if escalate_email:
            await self._send_email(message, recipients, org)

        if is_urgent:
            await self._send_sms(message, recipients, org)

    async def _create_in_app(
        self, message: DepartmentMessage, recipients: List[User]
    ) -> None:
        """Write one in-app NotificationLog per recipient in a single commit."""
        try:
            priority = _priority_value(message)
            for user in recipients:
                self.db.add(
                    NotificationLog(
                        id=generate_uuid(),
                        organization_id=str(message.organization_id),
                        recipient_id=str(user.id),
                        channel="in_app",
                        category=MESSAGE_CATEGORY,
                        subject=message.title,
                        message=message.body,
                        action_url="/messages",
                        delivered=True,
                        expires_at=message.expires_at,
                        notification_metadata={
                            "message_id": str(message.id),
                            "priority": priority,
                            "requires_acknowledgment": bool(
                                message.requires_acknowledgment
                            ),
                        },
                    )
                )
            await self.db.commit()
        except Exception as e:  # pragma: no cover - defensive
            await self.db.rollback()
            logger.warning("Department message in-app fan-out failed: {}", e)

    async def _send_email(
        self,
        message: DepartmentMessage,
        recipients: List[User],
        org: Optional[Organization],
    ) -> None:
        try:
            to_emails = [
                u.email
                for u in recipients
                if u.email and _wants(u.notification_preferences, "email_notifications")
            ]
            if not to_emails:
                return

            from app.services.email_service import EmailService, wrap_email_body

            priority = _priority_value(message)
            # Red banner for urgent, amber for the rest, matching the in-app
            # priority styling.
            header_color = "#dc2626" if priority == "urgent" else ""
            subject = message.title
            if priority != "normal":
                subject = f"[{priority.upper()}] {message.title}"
            html_body = wrap_email_body(
                org,
                message.title,
                f"<p>{_text_to_html(message.body)}</p>",
                header_color=header_color,
            )
            email_svc = EmailService(organization=org)
            await email_svc.send_email(
                to_emails=to_emails,
                subject=subject,
                html_body=html_body,
                db=self.db,
                template_type=MESSAGE_CATEGORY,
            )
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("Department message email escalation failed: {}", e)

    async def _send_sms(
        self,
        message: DepartmentMessage,
        recipients: List[User],
        org: Optional[Organization],
    ) -> None:
        try:
            from app.services.sms_service import SMSService

            sms_svc = SMSService()
            if not sms_svc.enabled:
                return

            numbers = [
                (u.mobile or u.phone)
                for u in recipients
                if (u.mobile or u.phone)
                and _wants(u.notification_preferences, "sms_notifications")
            ]
            if not numbers:
                return

            org_name = (org.name if org and org.name else "Department").strip()
            body = f"{org_name} URGENT: {message.title}"
            if len(body) > _SMS_MAX_LEN:
                body = body[: _SMS_MAX_LEN - 1].rstrip() + "…"
            await sms_svc.send_bulk_sms(numbers, body)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("Department message SMS escalation failed: {}", e)


async def deliver_department_message(message_id: str, organization_id: str) -> None:
    """Background-task entrypoint: load the message on a fresh session and

    deliver it. Runs after the HTTP response, so it must open its own session
    rather than reuse the request's. Never raises.
    """
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            result = await session.execute(
                select(DepartmentMessage).where(
                    DepartmentMessage.id == str(message_id),
                    DepartmentMessage.organization_id == str(organization_id),
                )
            )
            message = result.scalar_one_or_none()
            if message is None:
                return
            await MessageDeliveryService(session).deliver(message)
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Department message delivery task failed: {}", e)
