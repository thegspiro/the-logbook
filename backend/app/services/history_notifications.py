"""Notices sent by the History module.

Three notices, all ``EmailKind.HISTORY_DUTIES`` (optional, on by default), each
an email plus a bell entry. Never SMS: nothing here is urgent, and none is in
``SmsAlert`` (CLAUDE.md pitfall #18).

==========================  ==============================================
Notice                      Recipients
==========================  ==============================================
Awaiting your clearance     active holders of the step's position
Cleared / returned          the member who submitted the record
Clearance list changed      active ``settings.manage`` holders
==========================  ==============================================

A notice names the record and links to it; it carries none of the record's
content, so a draft biography or a burial location never sits in a mailbox.
Sending runs as a background task on its own session and never raises: a
failed notice is logged and dropped rather than undoing the decision that
caused it.
"""

import html
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import Organization, User

#: Bell entries are pointers to the record, which holds the history itself.
NOTICE_EXPIRY_DAYS = 30
NOTIFICATION_CATEGORY = "history"
EMAIL_TEMPLATE_TYPE = "history_clearance"


def _link(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def _subject_safe(text: str) -> str:
    return " ".join(text.split())[:200]


def _notice(subject: str, lead_html: str, message: str, path: str) -> Dict[str, str]:
    url = html.escape(_link(path))
    return {
        "subject": _subject_safe(subject),
        "body_html": (
            f"<p>{lead_html}</p>" f'<p><a href="{url}">Open it in the Logbook</a>.</p>'
        ),
        "message": message,
        "action_path": path,
    }


def awaiting_clearance_notice(record_label: str, record_path: str) -> Dict[str, str]:
    label = html.escape(record_label)
    return _notice(
        f"History record awaiting your clearance: {record_label}",
        f"<strong>{label}</strong> is waiting for your clearance before it "
        "can be published.",
        f"{record_label} is waiting for your clearance.",
        record_path,
    )


def clearance_outcome_notice(
    record_label: str, record_path: str, *, cleared: bool
) -> Dict[str, str]:
    label = html.escape(record_label)
    if cleared:
        return _notice(
            f"History record cleared: {record_label}",
            f"<strong>{label}</strong> has been cleared by every step and is "
            "ready to publish.",
            f"{record_label} has been cleared and is ready to publish.",
            record_path,
        )
    return _notice(
        f"History record returned for changes: {record_label}",
        f"<strong>{label}</strong> was returned for changes. The reviewer's "
        "note is on the record.",
        f"{record_label} was returned for changes.",
        record_path,
    )


def clearance_list_changed_notice(actor_name: str) -> Dict[str, str]:
    actor = html.escape(actor_name)
    return _notice(
        "The History clearance list was changed",
        f"{actor} changed the department's History clearance list — the "
        "reviews a record must pass before it is published to the public.",
        f"{actor_name} changed the History clearance list.",
        "/history/settings",
    )


def unique_ids(user_ids: Iterable[Optional[str]]) -> List[str]:
    seen: Dict[str, None] = {}
    for user_id in user_ids:
        if user_id:
            seen.setdefault(str(user_id), None)
    return list(seen)


async def send_history_notice(
    organization_id: str, user_ids: List[str], notice: Dict[str, str]
) -> None:
    """Background task: a bell entry and an email for each active member."""
    if not user_ids:
        return
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            org = await session.get(Organization, str(organization_id))
            result = await session.execute(
                select(User).where(
                    User.id.in_(user_ids),
                    User.organization_id == str(organization_id),
                    User.is_active,
                )
            )
            users = sorted(result.scalars().all(), key=lambda u: str(u.id))
            if not users:
                return
            await _record_in_app(session, str(organization_id), users, notice)
            await _email(session, org, users, notice)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("History notification failed: {}", exc)


async def _record_in_app(
    session: AsyncSession,
    organization_id: str,
    users: List[User],
    notice: Dict[str, str],
) -> None:
    from app.models.notification import NotificationChannel, NotificationLog

    expires_at = datetime.now(timezone.utc) + timedelta(days=NOTICE_EXPIRY_DAYS)
    for user in users:
        session.add(
            NotificationLog(
                organization_id=organization_id,
                recipient_id=str(user.id),
                channel=NotificationChannel.IN_APP,
                category=NOTIFICATION_CATEGORY,
                subject=notice["subject"],
                message=notice["message"],
                action_url=notice["action_path"],
                expires_at=expires_at,
                delivered=True,
            )
        )
    try:
        await session.commit()
    except Exception as exc:
        # The email below still carries the notice.
        await session.rollback()
        logger.warning("History in-app notification failed: {}", exc)


async def _email(
    session: AsyncSession,
    org: Optional[Organization],
    users: List[User],
    notice: Dict[str, str],
) -> None:
    from app.services.email_policy import (
        EmailKind,
        department_required_kinds,
        member_receives_email,
    )
    from app.services.email_service import EmailService, wrap_email_body

    email_service = EmailService(organization=org)
    required = department_required_kinds(org)
    body = wrap_email_body(org, notice["subject"], notice["body_html"])
    for user in users:
        if not user.email:
            continue
        if not member_receives_email(
            user.notification_preferences, EmailKind.HISTORY_DUTIES, required
        ):
            continue
        try:
            # One message per member, so no recipient sees another's address.
            await email_service.send_email(
                to_emails=[user.email],
                subject=notice["subject"],
                html_body=body,
                db=session,
                template_type=EMAIL_TEMPLATE_TYPE,
            )
        except Exception as exc:
            logger.warning("History email to a recipient failed: {}", exc)
