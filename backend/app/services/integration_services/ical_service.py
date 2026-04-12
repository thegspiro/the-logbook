"""
iCalendar (ICS) Feed Service

Generates read-only ICS calendar feeds that can be subscribed to
from Apple Calendar, Google Calendar, Outlook, Thunderbird, etc.

No OAuth required — uses a per-org token-protected URL.
"""

import secrets
from datetime import datetime, timezone
from typing import Any


def generate_feed_token() -> str:
    """Generate a cryptographically secure feed token."""
    return secrets.token_urlsafe(48)


def generate_ical_feed(
    events: list[dict[str, Any]],
    org_name: str = "The Logbook",
    timezone_name: str = "UTC",
) -> str:
    """
    Generate an ICS-formatted calendar feed from a list of events.

    Uses manual ICS string building to avoid extra dependencies.
    Compliant with RFC 5545.

    Args:
        events: List of event dicts with title, start_time, end_time, etc.
        org_name: Organization name for the calendar title.
        timezone_name: IANA timezone string.

    Returns:
        ICS-formatted string.
    """
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//The Logbook//EN",
        f"X-WR-CALNAME:{_escape_ics(org_name)} Events",
        f"X-WR-TIMEZONE:{timezone_name}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]

    for event in events:
        lines.extend(_event_to_vevent(event))

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)


def _event_to_vevent(event: dict[str, Any]) -> list[str]:
    """Convert an event dict to VEVENT lines."""
    uid = event.get("id", "unknown")
    title = event.get("title", "Untitled")
    description = event.get("description", "")
    location = event.get("location", "")
    start = event.get("start_time")
    end = event.get("end_time")

    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}@thelogbook.app",
        f"SUMMARY:{_escape_ics(title)}",
    ]

    if start:
        lines.append(f"DTSTART:{_format_ics_datetime(start)}")
    if end:
        lines.append(f"DTEND:{_format_ics_datetime(end)}")
    if description:
        lines.append(f"DESCRIPTION:{_escape_ics(description)}")
    if location:
        lines.append(f"LOCATION:{_escape_ics(location)}")

    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines.append(f"DTSTAMP:{now}")
    lines.append("END:VEVENT")
    return lines


def _escape_ics(text: str) -> str:
    """Escape special characters per RFC 5545."""
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _format_ics_datetime(dt: Any) -> str:
    """Format a datetime (string or object) as ICS datetime string."""
    if isinstance(dt, str):
        # Try to parse ISO format and convert to ICS format
        try:
            parsed = datetime.fromisoformat(dt.replace("Z", "+00:00"))
            return parsed.strftime("%Y%m%dT%H%M%SZ")
        except (ValueError, AttributeError):
            return dt
    if isinstance(dt, datetime):
        return dt.strftime("%Y%m%dT%H%M%SZ")
    return str(dt)
