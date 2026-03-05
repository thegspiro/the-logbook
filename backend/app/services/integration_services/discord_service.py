"""
Discord Integration Service

Sends notifications to Discord channels via webhook URLs
using Discord embed formatting.
"""

import logging
from typing import Any

from app.services.integration_services.base import create_integration_client

logger = logging.getLogger(__name__)

# Discord color constants (decimal, not hex)
COLOR_BLUE = 0x3498DB
COLOR_GREEN = 0x2ECC71
COLOR_ORANGE = 0xE67E22
COLOR_RED = 0xE74C3C


async def send_discord_notification(
    webhook_url: str,
    content: str,
    embeds: list[dict[str, Any]] | None = None,
) -> bool:
    """
    POST a message to a Discord webhook.

    Discord returns 204 No Content on success.
    """
    payload: dict[str, Any] = {"content": content}
    if embeds:
        payload["embeds"] = embeds

    async with create_integration_client() as client:
        response = await client.post(webhook_url, json=payload)
        if response.status_code == 204:
            return True
        logger.warning(
            "Discord webhook returned %d: %s",
            response.status_code,
            response.text[:200],
        )
        return False


async def send_test_message(webhook_url: str) -> str:
    """Send a test embed to verify the webhook URL works."""
    embeds = [
        {
            "title": "✅ The Logbook — Connected",
            "description": "This Discord channel is now receiving notifications from The Logbook.",
            "color": COLOR_GREEN,
        }
    ]
    success = await send_discord_notification(
        webhook_url, "The Logbook integration test:", embeds
    )
    if success:
        return "Test message sent successfully"
    raise Exception("Discord webhook returned an error — check the webhook URL")


def format_event_embed(event: dict[str, Any]) -> dict[str, Any]:
    """Format a Logbook event as a Discord embed."""
    title = event.get("title", "Untitled Event")
    event_type = event.get("event_type", "event")
    start = event.get("start_time", "TBD")
    location = event.get("location", "")

    fields = [
        {"name": "Type", "value": event_type, "inline": True},
        {"name": "When", "value": str(start), "inline": True},
    ]
    if location:
        fields.append({"name": "Location", "value": location, "inline": True})

    return {
        "title": f"📅 {title}",
        "fields": fields,
        "color": COLOR_BLUE,
    }


def format_shift_embed(shift: dict[str, Any]) -> dict[str, Any]:
    """Format a shift update as a Discord embed."""
    shift_type = shift.get("type", "Shift")
    start = shift.get("start_time", "")
    end = shift.get("end_time", "")
    crew = shift.get("crew", [])

    fields = [
        {"name": "Start", "value": str(start), "inline": True},
        {"name": "End", "value": str(end), "inline": True},
    ]
    if crew:
        fields.append(
            {"name": "Crew", "value": ", ".join(crew[:10]), "inline": False}
        )

    return {
        "title": f"🚒 {shift_type} Update",
        "fields": fields,
        "color": COLOR_ORANGE,
    }


def format_training_embed(record: dict[str, Any]) -> dict[str, Any]:
    """Format a training completion as a Discord embed."""
    member = record.get("member_name", "A member")
    course = record.get("course_name", "training")
    hours = record.get("hours", 0)

    return {
        "title": "📋 Training Completed",
        "description": f"**{member}** completed **{course}** ({hours} hours)",
        "color": COLOR_GREEN,
    }
