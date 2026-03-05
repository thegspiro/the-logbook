"""
Slack Integration Service

Sends notifications to Slack channels via incoming webhook URLs
using Slack Block Kit formatting.
"""

import logging
from typing import Any

from app.services.integration_services.base import create_integration_client

logger = logging.getLogger(__name__)


async def send_slack_notification(
    webhook_url: str,
    text: str,
    blocks: list[dict[str, Any]] | None = None,
) -> bool:
    """
    POST a message to a Slack incoming webhook.

    Args:
        webhook_url: The Slack webhook URL (stored encrypted).
        text: Fallback text for notifications.
        blocks: Optional Slack Block Kit blocks for rich formatting.

    Returns:
        True if the message was sent successfully.
    """
    payload: dict[str, Any] = {"text": text}
    if blocks:
        payload["blocks"] = blocks

    async with create_integration_client() as client:
        response = await client.post(webhook_url, json=payload)
        if response.status_code == 200:
            return True
        logger.warning(
            "Slack webhook returned %d: %s",
            response.status_code,
            response.text[:200],
        )
        return False


async def send_test_message(webhook_url: str) -> str:
    """Send a test message to verify the webhook URL works."""
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": ":white_check_mark: *The Logbook* — Integration test successful!\nThis Slack channel is now connected.",
            },
        }
    ]
    success = await send_slack_notification(
        webhook_url, "The Logbook integration test successful!", blocks
    )
    if success:
        return "Test message sent successfully"
    raise Exception("Slack webhook returned an error — check the webhook URL")


def format_event_notification(event: dict[str, Any]) -> dict[str, Any]:
    """Format a Logbook event as Slack Block Kit message."""
    title = event.get("title", "Untitled Event")
    event_type = event.get("event_type", "event")
    start = event.get("start_time", "TBD")
    location = event.get("location", "")

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"📅 {title}"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Type:* {event_type}"},
                {"type": "mrkdwn", "text": f"*When:* {start}"},
            ],
        },
    ]
    if location:
        blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*Location:* {location}"},
            }
        )

    return {"text": f"New event: {title}", "blocks": blocks}


def format_shift_notification(shift: dict[str, Any]) -> dict[str, Any]:
    """Format a shift update as Slack Block Kit message."""
    shift_type = shift.get("type", "Shift")
    start = shift.get("start_time", "")
    end = shift.get("end_time", "")
    crew = shift.get("crew", [])

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"🚒 {shift_type} Update"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Start:* {start}"},
                {"type": "mrkdwn", "text": f"*End:* {end}"},
            ],
        },
    ]
    if crew:
        crew_text = ", ".join(crew[:10])
        blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*Crew:* {crew_text}"},
            }
        )

    return {"text": f"{shift_type} update", "blocks": blocks}


def format_training_notification(record: dict[str, Any]) -> dict[str, Any]:
    """Format a training completion as Slack Block Kit message."""
    member = record.get("member_name", "A member")
    course = record.get("course_name", "training")
    hours = record.get("hours", 0)

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"📋 *{member}* completed *{course}* ({hours} hours)",
            },
        }
    ]

    return {"text": f"{member} completed {course}", "blocks": blocks}
