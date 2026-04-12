"""
Integration Notification Dispatcher

Bridge between internal app events and external messaging integrations.
When the app creates an event, starts a shift, or completes training,
this dispatcher sends notifications to all connected messaging integrations
(Slack, Discord, Teams, generic webhooks).
"""

import asyncio
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration

# Integration types that receive notifications
MESSAGING_TYPES = {"slack", "discord", "microsoft-teams", "generic-webhook"}

# Integration types that receive data sync pushes
SYNC_TYPES = {"salesforce"}


async def dispatch_notification(
    db: AsyncSession,
    organization_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """
    Send notifications to all connected messaging integrations for an org.

    This is fire-and-forget — failures are logged but don't block the caller.

    Args:
        db: Database session.
        organization_id: Organization to send for.
        event_type: Event type string (e.g. "event.created", "shift.started").
        payload: Event data dict.
    """
    result = await db.execute(
        select(Integration).where(
            Integration.organization_id == organization_id,
            Integration.enabled.is_(True),
            Integration.status == "connected",
            Integration.integration_type.in_(MESSAGING_TYPES),
        )
    )
    integrations = result.scalars().all()

    if not integrations:
        return

    tasks = []
    for integration in integrations:
        # Check if this integration subscribes to this event type
        config = integration.config or {}
        subscribed_types = config.get("event_types", [])
        if subscribed_types and event_type not in subscribed_types:
            continue

        task = asyncio.create_task(
            _send_to_integration(integration, event_type, payload)
        )
        tasks.append((integration, task))

    # Gather results (don't let failures propagate)
    for integration, task in tasks:
        try:
            await task
            # Update last_sync_at
            integration.last_sync_at = datetime.now(timezone.utc)
        except Exception:
            logger.warning(
                "Notification to %s (%s) failed for event %s",
                integration.name,
                integration.integration_type,
                event_type,
                exc_info=True,
            )

    if tasks:
        await db.commit()

    # Dispatch to sync-type integrations (Salesforce) in the background
    await _dispatch_to_sync_integrations(db, organization_id, event_type, payload)


async def _send_to_integration(
    integration: Integration,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Send a notification to a specific integration."""
    itype = integration.integration_type

    if itype == "slack":
        from app.services.integration_services import slack_service

        webhook_url = integration.get_secret("webhook_url") or (
            integration.config or {}
        ).get("webhook_url", "")
        if not webhook_url:
            return
        msg = _format_for_slack(event_type, payload)
        await slack_service.send_slack_notification(
            webhook_url, msg["text"], msg.get("blocks")
        )

    elif itype == "discord":
        from app.services.integration_services import discord_service

        webhook_url = integration.get_secret("webhook_url") or (
            integration.config or {}
        ).get("webhook_url", "")
        if not webhook_url:
            return
        msg = _format_for_discord(event_type, payload)
        await discord_service.send_discord_notification(
            webhook_url, msg["content"], msg.get("embeds")
        )

    elif itype == "microsoft-teams":
        from app.services.integration_services import teams_service

        webhook_url = integration.get_secret("webhook_url") or (
            integration.config or {}
        ).get("webhook_url", "")
        if not webhook_url:
            return
        msg = _format_for_teams(event_type, payload)
        await teams_service.send_teams_notification(
            webhook_url, msg["title"], msg["message"]
        )

    elif itype == "generic-webhook":
        from app.services.integration_services import webhook_service

        url = integration.get_secret("url") or (integration.config or {}).get("url", "")
        secret = integration.get_secret("secret")
        if not url:
            return
        await webhook_service.send_webhook(url, event_type, payload, secret)


def _format_for_slack(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Route to the appropriate Slack formatter."""
    from app.services.integration_services import slack_service

    if event_type.startswith("event."):
        return slack_service.format_event_notification(payload)
    if event_type.startswith("shift."):
        return slack_service.format_shift_notification(payload)
    if event_type.startswith("training."):
        return slack_service.format_training_notification(payload)
    return {
        "text": f"[{event_type}] {payload.get('title', payload.get('message', ''))}"
    }


def _format_for_discord(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Route to the appropriate Discord formatter."""
    from app.services.integration_services import discord_service

    if event_type.startswith("event."):
        embed = discord_service.format_event_embed(payload)
        return {"content": "", "embeds": [embed]}
    if event_type.startswith("shift."):
        embed = discord_service.format_shift_embed(payload)
        return {"content": "", "embeds": [embed]}
    if event_type.startswith("training."):
        embed = discord_service.format_training_embed(payload)
        return {"content": "", "embeds": [embed]}
    return {
        "content": f"[{event_type}] {payload.get('title', payload.get('message', ''))}"
    }


def _format_for_teams(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Route to the appropriate Teams formatter."""
    from app.services.integration_services import teams_service

    if event_type.startswith("event."):
        return teams_service.format_event_card(payload)
    if event_type.startswith("shift."):
        return teams_service.format_shift_card(payload)
    if event_type.startswith("training."):
        return teams_service.format_training_card(payload)
    return {
        "title": event_type,
        "message": payload.get("title", payload.get("message", "")),
    }


# ============================================================
# Sync-type integration dispatch (Salesforce)
# ============================================================


async def _dispatch_to_sync_integrations(
    db: AsyncSession,
    organization_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Push data to sync-type integrations (e.g. Salesforce)."""
    result = await db.execute(
        select(Integration).where(
            Integration.organization_id == organization_id,
            Integration.enabled.is_(True),
            Integration.status == "connected",
            Integration.integration_type.in_(SYNC_TYPES),
        )
    )
    integrations = result.scalars().all()
    if not integrations:
        return

    for integration in integrations:
        config = integration.config or {}
        sync_direction = config.get("sync_direction", "push")
        if sync_direction not in ("push", "both"):
            continue

        sync_types = config.get("sync_types", [])
        entity = event_type.split(".")[0] if "." in event_type else ""
        if sync_types and entity not in sync_types:
            continue

        try:
            await _send_to_salesforce(integration, event_type, payload)
            integration.last_sync_at = datetime.now(timezone.utc)
        except Exception:
            logger.warning(
                "Salesforce sync push failed for event %s",
                event_type,
                exc_info=True,
            )

    await db.commit()


async def _send_to_salesforce(
    integration: Integration,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Route an internal event to the appropriate Salesforce push method."""
    from app.services.integration_services.salesforce_service import SalesforceService
    from app.services.integration_services.salesforce_sync_service import (
        build_salesforce_credentials,
    )

    creds = build_salesforce_credentials(integration)
    sf = SalesforceService(creds)
    # Sync service needs a db session but the dispatcher doesn't own one
    # suitable for writes, so we use the SF service directly for pushes.

    if event_type.startswith("event.") and event_type != "event.cancelled":
        await sf.create_record(
            "Event",
            {
                "Subject": payload.get("title", ""),
                "Description": payload.get("description", ""),
                "StartDateTime": payload.get("start_time", ""),
                "EndDateTime": payload.get("end_time", ""),
                "Location": payload.get("location", ""),
                "Logbook_Event_ID__c": payload.get("id", ""),
            },
        )

    elif event_type.startswith("training."):
        await sf.create_record(
            "Task",
            {
                "Subject": payload.get("course_name", payload.get("title", "")),
                "Status": "Completed",
                "ActivityDate": payload.get("completion_date", ""),
                "Hours_Completed__c": payload.get("hours", 0),
                "Task_Source__c": "Logbook Training",
                "Logbook_Training_ID__c": payload.get("id", ""),
            },
        )

    elif event_type.startswith("member."):
        await sf.create_record(
            "Contact",
            {
                "FirstName": payload.get("first_name", ""),
                "LastName": payload.get("last_name", ""),
                "Email": payload.get("email", ""),
                "Phone": payload.get("phone", ""),
                "Title": payload.get("rank", ""),
                "Logbook_Member_ID__c": payload.get("id", ""),
            },
        )
