"""Chat notification dispatch.

Fans a domain event (a new calendar event, shift, or training record) out to a
department's enabled chat integrations — Slack, Discord, or Microsoft Teams —
using each platform's existing formatter + sender. Delivery is best-effort and
never raises into the caller: a failing webhook must not break the create.

Callers pass a plain ``payload`` dict describing the entity; each platform's
formatter reads the fields it needs (title/event_type/start_time/location for
events, type/start/end/crew for shifts, etc.), so callers don't need to know
platform-specific shapes.
"""

from typing import Any

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration

# integration_type values that are chat/messaging platforms.
MESSAGING_TYPES = ("slack", "discord", "microsoft-teams")

# Non-empty Discord content per kind (Discord rejects a fully empty message).
_DISCORD_CONTENT = {
    "event": "📅 New event",
    "shift": "🚒 Shift update",
    "training": "🎓 Training recorded",
}


def _webhook_url(integration: Integration) -> str:
    return integration.get_secret("webhook_url") or (integration.config or {}).get(
        "webhook_url", ""
    )


async def send_integration_notification(
    integration: Integration, kind: str, payload: dict[str, Any]
) -> bool:
    """Format ``payload`` for ``kind`` and send it to one chat integration.

    ``kind`` is ``"event"``, ``"shift"``, or ``"training"``. Returns True only
    when the platform webhook accepted the message.
    """
    itype = integration.integration_type
    if itype not in MESSAGING_TYPES:
        return False
    webhook_url = _webhook_url(integration)
    if not webhook_url:
        return False

    if itype == "discord":
        from app.services.integration_services.discord_service import (
            format_event_embed,
            format_shift_embed,
            format_training_embed,
            send_discord_notification,
        )

        formatter = {
            "event": format_event_embed,
            "shift": format_shift_embed,
            "training": format_training_embed,
        }.get(kind)
        if formatter is None:
            return False
        return await send_discord_notification(
            webhook_url,
            content=_DISCORD_CONTENT.get(kind, "The Logbook"),
            embeds=[formatter(payload)],
        )

    if itype == "slack":
        from app.services.integration_services.slack_service import (
            format_event_notification,
            format_shift_notification,
            format_training_notification,
            send_slack_notification,
        )

        formatter = {
            "event": format_event_notification,
            "shift": format_shift_notification,
            "training": format_training_notification,
        }.get(kind)
        if formatter is None:
            return False
        msg = formatter(payload)
        return await send_slack_notification(
            webhook_url, msg.get("text", ""), msg.get("blocks")
        )

    if itype == "microsoft-teams":
        from app.services.integration_services.teams_service import (
            format_event_card,
            format_shift_card,
            format_training_card,
            send_teams_notification,
        )

        formatter = {
            "event": format_event_card,
            "shift": format_shift_card,
            "training": format_training_card,
        }.get(kind)
        if formatter is None:
            return False
        card = formatter(payload)
        return await send_teams_notification(
            webhook_url, card.get("title", "The Logbook"), card.get("message", "")
        )

    return False


async def dispatch_chat_notifications(
    db: AsyncSession,
    organization_id: str,
    kind: str,
    payload: dict[str, Any],
) -> int:
    """Send a chat notification to every enabled messaging integration for an org.

    Returns the number of successful deliveries. Never raises — each integration
    is attempted independently and failures are logged, so one broken webhook
    doesn't suppress the others or bubble up into the request that triggered it.
    """
    try:
        result = await db.execute(
            select(Integration).where(
                Integration.organization_id == str(organization_id),
                Integration.enabled.is_(True),
                Integration.integration_type.in_(MESSAGING_TYPES),
            )
        )
        integrations = result.scalars().all()
    except Exception as exc:
        logger.warning("Could not load messaging integrations: {}", exc)
        return 0

    sent = 0
    for integration in integrations:
        try:
            if await send_integration_notification(integration, kind, payload):
                sent += 1
        except Exception as exc:
            logger.warning(
                "Chat notification to {} failed: {}", integration.integration_type, exc
            )
    return sent


async def notify_entity_created(
    organization_id: str, kind: str, payload: dict[str, Any]
) -> None:
    """Background-task entrypoint for chat notifications.

    Intended for ``BackgroundTasks.add_task`` so it runs AFTER the HTTP response.
    It therefore must NOT reuse the request-scoped DB session (already closed by
    then) — it opens its own. Fully self-contained and never raises.
    """
    from app.core.database import async_session_factory

    try:
        async with async_session_factory() as db:
            await dispatch_chat_notifications(db, organization_id, kind, payload)
    except Exception as exc:
        logger.warning("Background chat notification failed: {}", exc)
