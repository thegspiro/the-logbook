"""
Microsoft Teams Integration Service

Sends notifications to Teams channels via incoming webhook URLs
using Adaptive Card formatting.
"""

import logging
from typing import Any

from app.services.integration_services.base import create_integration_client

logger = logging.getLogger(__name__)


async def send_teams_notification(
    webhook_url: str,
    title: str,
    message: str,
    color: str = "0076D7",
) -> bool:
    """
    POST an Adaptive Card to a Teams incoming webhook.

    Args:
        webhook_url: The Teams webhook URL (stored encrypted).
        title: Card title.
        message: Card body text.
        color: Theme color hex string (without #).

    Returns:
        True if the message was sent successfully.
    """
    payload = {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "contentUrl": None,
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": [
                        {
                            "type": "TextBlock",
                            "size": "Medium",
                            "weight": "Bolder",
                            "text": title,
                        },
                        {
                            "type": "TextBlock",
                            "text": message,
                            "wrap": True,
                        },
                    ],
                },
            }
        ],
    }

    async with create_integration_client() as client:
        response = await client.post(webhook_url, json=payload)
        if response.status_code == 200:
            return True
        logger.warning(
            "Teams webhook returned %d: %s",
            response.status_code,
            response.text[:200],
        )
        return False


async def send_test_message(webhook_url: str) -> str:
    """Send a test Adaptive Card to verify the webhook URL works."""
    success = await send_teams_notification(
        webhook_url,
        title="✅ The Logbook — Connected",
        message="This Teams channel is now receiving notifications from The Logbook.",
        color="00CC6A",
    )
    if success:
        return "Test message sent successfully"
    raise Exception("Teams webhook returned an error — check the webhook URL")


def format_event_card(event: dict[str, Any]) -> dict[str, Any]:
    """Format a Logbook event as a Teams Adaptive Card payload."""
    title = event.get("title", "Untitled Event")
    event_type = event.get("event_type", "event")
    start = event.get("start_time", "TBD")
    location = event.get("location", "")

    facts = [
        {"title": "Type", "value": event_type},
        {"title": "When", "value": str(start)},
    ]
    if location:
        facts.append({"title": "Location", "value": location})

    return {
        "title": f"📅 {title}",
        "message": "\n".join(f"**{f['title']}:** {f['value']}" for f in facts),
    }


def format_shift_card(shift: dict[str, Any]) -> dict[str, Any]:
    """Format a shift update as a Teams Adaptive Card payload."""
    shift_type = shift.get("type", "Shift")
    start = shift.get("start_time", "")
    end = shift.get("end_time", "")
    crew = shift.get("crew", [])

    lines = [f"**Start:** {start}", f"**End:** {end}"]
    if crew:
        lines.append(f"**Crew:** {', '.join(crew[:10])}")

    return {"title": f"🚒 {shift_type} Update", "message": "\n".join(lines)}


def format_training_card(record: dict[str, Any]) -> dict[str, Any]:
    """Format a training completion as a Teams Adaptive Card payload."""
    member = record.get("member_name", "A member")
    course = record.get("course_name", "training")
    hours = record.get("hours", 0)

    return {
        "title": "📋 Training Completed",
        "message": f"**{member}** completed **{course}** ({hours} hours)",
    }
