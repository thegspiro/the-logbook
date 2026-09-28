"""Tell a member what happened to their equipment request.

A member used to learn that a request was approved, declined or issued only by
opening My Equipment and noticing the badge had changed. The quartermaster's
note — often the one thing a decline needs, "we don't carry XS; one is on
order" — reached nobody.

Each notice goes out as a bell entry, a web push where configured, and an
email, the email subject to :mod:`app.services.email_policy`. Never SMS: an
equipment decision is an administrative notice, not an urgent one (CLAUDE.md
pitfall #18). The whole notice is behind the ``equipment_request_update``
notification rule, which is on unless a department switches it off.
"""

import html
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.inventory import EquipmentRequest
from app.models.notification import (
    NotificationChannel,
    NotificationLog,
    NotificationTrigger,
)
from app.models.user import Organization, User
from app.services.email_policy import EmailKind, member_receives_email
from app.services.email_theme import fact, facts
from app.services.inventory_service import _size_label
from app.services.notification_rules import NotificationRuleResolver

# The outcomes a notice is sent for, as the request's stored status reads
# after the change.
APPROVED = "approved"
DENIED = "denied"
FULFILLED = "fulfilled"
OUTCOMES = (APPROVED, DENIED, FULFILLED)

REQUESTS_PATH = "/inventory/my-equipment"

# A bell entry is a pointer to the request, which is where the history lives.
NOTICE_EXPIRY_DAYS = 30

# The member-facing words for each outcome, matching the status labels on
# the member's request list (EQUIPMENT_REQUEST_STATUS_LABELS in the frontend).
_STATUS_LABELS = {APPROVED: "approved", DENIED: "declined", FULFILLED: "issued"}

_FULFILLMENT_PHRASES = {
    "checkout": "loaned to you",
    "assignment": "assigned to you as your gear",
    "issuance": "issued to you from stock",
}

_FULFILLMENT_LABELS = {
    "checkout": "Loaned (to be returned)",
    "assignment": "Assigned to you",
    "issuance": "Issued from stock",
}


def _subject_safe(text: str) -> str:
    # A subject is a header; a line break in an item name would end it early.
    return " ".join((text or "").split())


def _display_name(user: User) -> str:
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return name or user.username or ""


def _status_message(req: EquipmentRequest, outcome: str) -> str:
    item = req.item_name
    if outcome == APPROVED:
        return (
            f"The quartermaster approved your request for {item}. You'll get "
            "another notice when it has been issued."
        )
    if outcome == DENIED:
        return f"The quartermaster declined your request for {item}."
    how = _FULFILLMENT_PHRASES.get(req.fulfillment_type or "", "issued to you")
    return f"{item} has been {how}. It now appears under My Issued Gear."


def _detail_rows(req: EquipmentRequest, outcome: str) -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []
    if req.requested_size:
        rows.append(("Size", _size_label(req.requested_size)))
    if (req.quantity or 1) > 1:
        rows.append(("Quantity", str(req.quantity)))
    if outcome == FULFILLED and req.fulfillment_type in _FULFILLMENT_LABELS:
        rows.append(("How it was issued", _FULFILLMENT_LABELS[req.fulfillment_type]))
    return rows


def build_notice(req: EquipmentRequest, outcome: str) -> Dict[str, Any]:
    """Everything the three channels say about *req*, as plain values.

    ``email_context`` holds the ``equipment_request_update`` template
    variables apart from the member's name, which is per recipient. Every
    value that reaches the HTML variables is escaped here, because those
    variables are inserted raw.
    """
    if outcome not in OUTCOMES:
        raise ValueError(f"Unknown equipment request outcome: {outcome}")
    status_label = _STATUS_LABELS[outcome]
    message = _status_message(req, outcome)
    rows = _detail_rows(req, outcome)
    note = (req.review_notes or "").strip()

    details_html = (
        facts([[fact(html.escape(k), html.escape(v))] for k, v in rows]) if rows else ""
    )
    notes_html = (
        '<p style="white-space:pre-line;"><strong>From the quartermaster:'
        f"</strong> {html.escape(note)}</p>"
        if note
        else ""
    )
    subject = (
        f"Your equipment request was {status_label}: " f"{_subject_safe(req.item_name)}"
    )
    return {
        "subject": subject,
        # The bell shows the note too; for a decline it is the reason.
        "message": f"{message} Note: {note}" if note else message,
        "email_context": {
            "item_name": req.item_name,
            "status_label": status_label,
            "status_message": message,
            "details_html": details_html,
            "details_text": "\n".join(f"{k}: {v}" for k, v in rows),
            "notes_html": notes_html,
            "review_notes": f"From the quartermaster: {note}" if note else "",
            "requests_url": f"{settings.FRONTEND_URL.rstrip('/')}{REQUESTS_PATH}",
        },
    }


async def send_equipment_request_notice(
    organization_id: str, request_id: str, outcome: str
) -> None:
    """Background task: tell the requester what happened to *request_id*.

    Runs on its own session after the response has gone, so nothing here can
    fail or slow the quartermaster's action; it never raises. The request is
    re-read rather than passed in, so the notice reflects what was committed.
    """
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            await _deliver(session, str(organization_id), str(request_id), outcome)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Equipment request notification failed: {}", exc)


async def _deliver(
    session: AsyncSession, organization_id: str, request_id: str, outcome: str
) -> None:
    if not await NotificationRuleResolver(session).is_enabled(
        organization_id, NotificationTrigger.EQUIPMENT_REQUEST_UPDATE
    ):
        return

    req = (
        await session.execute(
            select(EquipmentRequest).where(
                EquipmentRequest.id == request_id,
                EquipmentRequest.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if req is None:
        return
    member = (
        await session.execute(
            select(User).where(
                User.id == str(req.requester_id),
                User.organization_id == organization_id,
                User.is_active,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        return

    notice = build_notice(req, outcome)
    await _record_in_app(session, organization_id, member, notice)
    await _push(session, organization_id, member, notice)
    org = await session.get(Organization, organization_id)
    await _email(session, org, member, notice)


async def _record_in_app(
    session: AsyncSession,
    organization_id: str,
    member: User,
    notice: Dict[str, Any],
) -> None:
    session.add(
        NotificationLog(
            organization_id=organization_id,
            recipient_id=str(member.id),
            channel=NotificationChannel.IN_APP,
            category="inventory",
            subject=notice["subject"],
            message=notice["message"],
            action_url=REQUESTS_PATH,
            expires_at=datetime.now(timezone.utc) + timedelta(days=NOTICE_EXPIRY_DAYS),
            delivered=True,
        )
    )
    try:
        await session.commit()
    except Exception as exc:
        # The email still carries the notice; a failed bell insert must not
        # take it down too.
        await session.rollback()
        logger.warning("Equipment request in-app notification failed: {}", exc)


async def _push(
    session: AsyncSession,
    organization_id: str,
    member: User,
    notice: Dict[str, Any],
) -> None:
    try:
        from app.services.push_service import PushService

        push = PushService(session)
        if not push.is_configured():
            return
        await push.send_to_user(
            organization_id=uuid.UUID(organization_id),
            user_id=uuid.UUID(str(member.id)),
            title=notice["subject"],
            body=notice["message"],
            url=REQUESTS_PATH,
            tag="inventory",
        )
    except Exception as exc:
        logger.warning("Equipment request web push failed: {}", exc)


async def _email(
    session: AsyncSession,
    org: Optional[Organization],
    member: User,
    notice: Dict[str, Any],
) -> None:
    if not member.email:
        return
    if not member_receives_email(
        member.notification_preferences, EmailKind.EQUIPMENT_REQUEST_UPDATE
    ):
        return
    try:
        from app.services.email_service import EmailService

        await EmailService(organization=org).send_equipment_request_update_email(
            to_email=member.email,
            context={**notice["email_context"], "member_name": _display_name(member)},
            db=session,
            organization_id=str(org.id) if org else None,
        )
    except Exception as exc:
        logger.warning("Equipment request email failed: {}", exc)
