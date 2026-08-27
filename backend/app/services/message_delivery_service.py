"""Department message delivery / escalation.

When a department message is posted it is, by itself, only visible to members
who happen to open the app. This service fans a posted message out across the
channels members actually watch:

* an in-app notification (bell inbox) for every targeted member;
* an email to every targeted member — always;
* an SMS when the message is urgent and the member cleared both SMS opt-in
  gates (see ``notification_channels``).

**Email is the channel of record and is deliberately unconditional.** It is not
gated by consent and not gated by the member's notification preferences: a
member must not be able to opt out of the record that they were told something,
or the department loses its answer to "I never got that update". SMS, by
contrast, is an opt-in addition on top of that email — US TCPA requires express
consent for text messaging, and consent that is collected but never checked is
worse than none, because the UI represents to the member that their choice took
effect.

That pairing is the invariant to preserve if this is ever changed: SMS may be
suppressed for a member, but the same message always reaches them by email.

An urgent department message is the only notification in the application
allowed to escalate to SMS; ``notification_channels.SmsAlert`` holds that list
and the recipient filter that enforces it.

The fan-out is dispatched to FastAPI ``BackgroundTasks`` so the HTTP response
returns immediately, and runs on its own database session (the request's
session is closed by then). It is fire-and-forget: a delivery failure must never
undo or block the message that was already created.
"""

import html as _html
from datetime import datetime, timezone
from typing import List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.notification import (
    DepartmentMessage,
    DepartmentMessageDelivery,
    NotificationLog,
)
from app.models.user import Organization, User

# Free-form NotificationLog category (matches how other features tag theirs,
# e.g. "security", "scheduling").
MESSAGE_CATEGORY = "department_message"

# SMS bodies are billed per segment, so keep the escalation text short.
_SMS_MAX_LEN = 300

# Per-org escalation throttle. Caps how many email/SMS *broadcasts* an
# organization can fire within the window, so a runaway loop or a compromised
# admin account can't blast the whole department (SMS especially costs money).
# The limiter fails open: if Redis is unavailable, urgent alerts still go out —
# dropping a real safety notification is worse than an occasional over-send.
_ESCALATION_WINDOW_SECONDS = 3600
_EMAIL_ESCALATION_LIMIT = 30
_SMS_ESCALATION_LIMIT = 10


def _priority_value(message: DepartmentMessage) -> str:
    return (
        message.priority.value
        if hasattr(message.priority, "value")
        else str(message.priority)
    )


def _text_to_html(text: str) -> str:
    """Escape plain-text message body and preserve line breaks for email."""
    return _html.escape(text or "").replace("\n", "<br>")


class MessageDeliveryService:
    """Fan a posted department message out to in-app / email / SMS channels."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _claim_delivery(
        self, message: DepartmentMessage, user: User, channel: str
    ) -> Optional[DepartmentMessageDelivery]:
        """Atomically reserve an external channel send for one recipient."""
        key = f"department-message:{message.id}:{user.id}:{channel}"
        attempt = DepartmentMessageDelivery(
            id=generate_uuid(),
            message_id=str(message.id),
            recipient_id=str(user.id),
            channel=channel,
            status="pending",
            idempotency_key=key,
        )
        try:
            self.db.add(attempt)
            await self.db.commit()
            return attempt
        except IntegrityError:
            # A concurrent worker (or a retry after success) owns this key.
            await self.db.rollback()
            return None

    async def _finish_delivery(
        self, attempt: DepartmentMessageDelivery, error: Optional[Exception] = None
    ) -> None:
        attempt.status = "failed" if error else "delivered"
        attempt.error = str(error) if error else None
        attempt.delivered_at = None if error else datetime.now(timezone.utc)
        await self.db.commit()

    async def deliver(self, message: DepartmentMessage) -> None:
        """Deliver ``message`` to its targeted audience across channels.

        Never raises — the whole fan-out is guarded so that one message that
        errors (bad data, a transient DB/query failure) can't propagate out and
        halt a batch of other messages being published, and each channel is
        additionally best-effort so a failure in one doesn't suppress the rest.
        """
        try:
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

            await self._create_in_app(message, recipients)

            org_result = await self.db.execute(
                select(Organization).where(
                    Organization.id == str(message.organization_id)
                )
            )
            org = org_result.scalar_one_or_none()

            # Unconditional: email is the channel of record (see module
            # docstring). It must run before the SMS branch so that a member
            # whose SMS is suppressed for want of consent has already been
            # reached by email.
            await self._send_email(message, recipients, org)

            if is_urgent:
                await self._send_sms(message, recipients, org)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(
                "Department message delivery failed for {}: {}",
                getattr(message, "id", "?"),
                e,
            )

    async def _create_in_app(
        self, message: DepartmentMessage, recipients: List[User]
    ) -> None:
        """Write one in-app NotificationLog per recipient in a single commit."""
        try:
            priority = _priority_value(message)
            for user in recipients:
                try:
                    async with self.db.begin_nested():
                        self.db.add(
                            NotificationLog(
                                id=generate_uuid(),
                                organization_id=str(message.organization_id),
                                recipient_id=str(user.id),
                                department_message_id=str(message.id),
                                channel="in_app",
                                category=MESSAGE_CATEGORY,
                                subject=message.title,
                                message=message.body,
                                # Take the member straight to the communication.
                                action_url=f"/messages/{message.id}",
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
                        await self.db.flush()
                except IntegrityError:
                    # The unique (message, recipient, channel) key means the
                    # other worker already created this member's notification.
                    continue
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
            # Deliberately NOT filtered by the email_notifications preference
            # or by consent: this is the record-of-notice channel, so a member
            # cannot opt out of being told. Channel preferences still govern
            # SMS and the in-app inbox.
            email_recipients = [u for u in recipients if u.email]
            if not email_recipients:
                return

            from app.core.security import is_rate_limited

            if await is_rate_limited(
                f"deptmsg_email:{message.organization_id}",
                _EMAIL_ESCALATION_LIMIT,
                _ESCALATION_WINDOW_SECONDS,
                fail_closed=False,
            ):
                logger.warning(
                    "Email escalation throttled for org {} (message {})",
                    message.organization_id,
                    message.id,
                )
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
            for user in email_recipients:
                attempt = await self._claim_delivery(message, user, "email")
                if attempt is None:
                    continue
                try:
                    await email_svc.send_email(
                        to_emails=[user.email],
                        subject=subject,
                        html_body=html_body,
                        db=self.db,
                        template_type=MESSAGE_CATEGORY,
                    )
                    await self._finish_delivery(attempt)
                except Exception as exc:
                    await self._finish_delivery(attempt, exc)
                    logger.warning("Department message email send failed: {}", exc)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("Department message email escalation failed: {}", e)

    async def _send_sms(
        self,
        message: DepartmentMessage,
        recipients: List[User],
        org: Optional[Organization],
    ) -> None:
        try:
            # Twilio configuration, TCPA consent (fails closed — a member who
            # was never asked counts as having refused) and the member's own
            # sms_notifications preference are all applied here. Everyone
            # dropped has already received this message by email (see
            # deliver()), which is the invariant that makes the filter safe.
            from app.services.notification_channels import (
                SmsAlert,
                resolve_sms_recipients,
            )

            numbers = await resolve_sms_recipients(
                self.db, recipients, SmsAlert.URGENT_DEPARTMENT_MESSAGE
            )
            if not numbers:
                return

            from app.core.security import is_rate_limited

            if await is_rate_limited(
                f"deptmsg_sms:{message.organization_id}",
                _SMS_ESCALATION_LIMIT,
                _ESCALATION_WINDOW_SECONDS,
                fail_closed=False,
            ):
                logger.warning(
                    "SMS escalation throttled for org {} (message {})",
                    message.organization_id,
                    message.id,
                )
                return

            org_name = (org.name if org and org.name else "Department").strip()
            body = f"{org_name} URGENT: {message.title}"
            if len(body) > _SMS_MAX_LEN:
                body = body[: _SMS_MAX_LEN - 1].rstrip() + "…"

            from app.services.sms_service import SMSService

            sms = SMSService()
            users_by_number = {
                (getattr(user, "mobile", None) or getattr(user, "phone", None)): user
                for user in recipients
            }
            for number in numbers:
                user = users_by_number[number]
                attempt = await self._claim_delivery(message, user, "sms")
                if attempt is None:
                    continue
                try:
                    await sms.send_bulk_sms([number], body)
                    await self._finish_delivery(attempt)
                except Exception as exc:
                    await self._finish_delivery(attempt, exc)
                    logger.warning("Department message SMS send failed: {}", exc)
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
            # Only deliver a message that is still live — an admin may have
            # deleted or deactivated it between the POST and this background run.
            result = await session.execute(
                select(DepartmentMessage).where(
                    DepartmentMessage.id == str(message_id),
                    DepartmentMessage.organization_id == str(organization_id),
                    DepartmentMessage.is_active.is_(True),
                    DepartmentMessage.deleted_at.is_(None),
                )
            )
            message = result.scalar_one_or_none()
            if message is None:
                return
            await MessageDeliveryService(session).deliver(message)
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Department message delivery task failed: {}", e)
