"""Account-security notifications.

Sends the affected member an in-app notification (and a best-effort email) when
a security-sensitive change happens to their account — currently MFA enable /
disable / admin reset / recovery-code regeneration.

The in-app notification is written synchronously inside the request transaction
(a cheap insert that must be durable). The email is the slow part — SMTP I/O —
so it is dispatched to FastAPI ``BackgroundTasks`` and runs *after* the response
is returned, on its own database session. Both are fire-and-forget: a
notification failure must never block the security action itself.
"""

from typing import Any, Optional

from fastapi import BackgroundTasks
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.notification import NotificationLog
from app.models.user import Organization, User

# Free-form category string used on NotificationLog (matches how other features
# tag their notifications, e.g. "scheduling").
SECURITY_CATEGORY = "security"


def _record_in_app(
    db: AsyncSession,
    user: User,
    *,
    subject: str,
    message: str,
    action_url: str,
) -> None:
    """Add the in-app NotificationLog row to the caller's transaction.

    Synchronous on purpose: it's a single insert that commits with the request,
    so the member sees the notification even if the email never sends.
    """
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


async def _send_security_email(
    organization_id: str,
    to_email: str,
    subject: str,
    message: str,
) -> None:
    """Send the security email on a fresh DB session.

    Runs as a FastAPI background task — after the response, once the request's
    session is already closed — so it must open its own session rather than
    reuse the request's. Only primitive values are captured (no detached ORM
    objects). Never raises.
    """
    from app.core.database import database_manager
    from app.services.email_service import EmailService, wrap_email_body

    try:
        async for session in database_manager.get_session():
            org_result = await session.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
            org = org_result.scalar_one_or_none()
            html = wrap_email_body(org, subject, f"<p>{message}</p>")
            email_svc = EmailService(organization=org)
            await email_svc.send_email(
                to_emails=[to_email],
                subject=subject,
                html_body=html,
                db=session,
                template_type=SECURITY_CATEGORY,
            )
    except Exception as e:
        logger.warning("Security notification email failed: {}", e)


async def notify_security_event(
    db: AsyncSession,
    user: User,
    *,
    subject: str,
    message: str,
    action_url: str = "",
    background_tasks: Optional[BackgroundTasks] = None,
    send_email: bool = True,
    org: Optional[Any] = None,
) -> None:
    """Notify ``user`` of a security event: in-app now, email in the background.

    Adds a ``NotificationLog`` row to the session (the caller's transaction
    commits it). When ``background_tasks`` is provided the email is queued to run
    after the response on its own session; otherwise it is sent inline (a
    best-effort fallback for callers without a request context). Never raises —
    all failures are logged and swallowed.
    """
    try:
        _record_in_app(
            db, user, subject=subject, message=message, action_url=action_url
        )
        await db.flush()
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Security in-app notification failed: {}", e)

    if not send_email:
        return

    to_email = getattr(user, "email", None)
    if not to_email:
        return
    organization_id = str(user.organization_id)

    if background_tasks is not None:
        background_tasks.add_task(
            _send_security_email,
            organization_id,
            to_email,
            subject,
            message,
        )
        return

    # Inline fallback (no request context): send best-effort on the caller's db.
    try:
        if org is None:
            org_result = await db.execute(
                select(Organization).where(Organization.id == organization_id)
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
        logger.warning("Security notification email failed: {}", e)
