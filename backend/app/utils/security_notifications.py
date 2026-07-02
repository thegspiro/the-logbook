"""Account-security notifications.

Sends the affected member an in-app notification (and a best-effort email) when
a security-sensitive change happens to their account — currently MFA enable /
disable / admin reset. These are intentionally fire-and-forget: a notification
failure must never block the security action itself.
"""

from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.notification import NotificationLog
from app.models.user import Organization, User

# Free-form category string used on NotificationLog (matches how other features
# tag their notifications, e.g. "scheduling").
SECURITY_CATEGORY = "security"


async def notify_security_event(
    db: AsyncSession,
    user: User,
    *,
    subject: str,
    message: str,
    action_url: str = "",
    send_email: bool = True,
    org: Optional[Any] = None,
) -> None:
    """Record an in-app security notification for ``user`` and optionally email.

    Adds a ``NotificationLog`` row to the session (the caller's transaction
    commits it) and sends a best-effort email. Never raises — all failures are
    logged and swallowed so the calling security flow is unaffected.
    """
    try:
        notif = NotificationLog(
            id=generate_uuid(),
            organization_id=str(user.organization_id),
            recipient_id=str(user.id),
            channel="in_app",
            category=SECURITY_CATEGORY,
            subject=subject,
            message=message,
            action_url=action_url,
            delivered=True,
        )
        db.add(notif)
        await db.flush()
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Security in-app notification failed: %s", e)

    if not send_email:
        return

    try:
        to_email = getattr(user, "email", None)
        if not to_email:
            return

        if org is None:
            org_result = await db.execute(
                select(Organization).where(
                    Organization.id == str(user.organization_id)
                )
            )
            org = org_result.scalar_one_or_none()

        from app.services.email_service import EmailService, wrap_email_body

        html = wrap_email_body(org, subject, f"<p>{message}</p>")
        email_svc = EmailService(organization=org)
        await email_svc.send_email(
            to_emails=[to_email],
            subject=subject,
            html_body=html,
            db=db,
            template_type=SECURITY_CATEGORY,
        )
    except Exception as e:
        logger.warning("Security notification email failed: %s", e)
