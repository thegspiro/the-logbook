"""
iCalendar (ICS) Feed Service

Generates read-only ICS calendar feeds that can be subscribed to
from Apple Calendar, Google Calendar, Outlook, Thunderbird, etc.

No OAuth required — each feed is addressed by an unguessable token in its URL:
a member's personal shifts feed, and the department events feed behind the
``ical`` integration.
"""

import hashlib
import hmac
import secrets
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

ICAL_INTEGRATION_TYPE = "ical"

# The department feed's token is kept twice on its ``ical`` integration row:
# encrypted in the secret store so an administrator can be shown the URL
# again, and as a SHA-256 digest in public config so the public route can find
# the row without decrypting every department's secrets.
ORG_FEED_TOKEN_SECRET = "feed_token"
ORG_FEED_TOKEN_HASH_KEY = "feed_token_hash"


def generate_feed_token() -> str:
    """Generate a cryptographically secure feed token."""
    return secrets.token_urlsafe(48)


def hash_feed_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def org_feed_token_matches(config: Mapping[str, Any] | None, token: str) -> bool:
    """Constant-time check of a presented token against a stored digest."""
    stored = (config or {}).get(ORG_FEED_TOKEN_HASH_KEY)
    if not isinstance(stored, str) or not stored:
        return False
    return hmac.compare_digest(stored, hash_feed_token(token))


def org_feed_path(token: str) -> str:
    return f"/api/public/v1/calendar/org/{token}.ics"


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
        f"X-WR-TIMEZONE:{_escape_ics(timezone_name)}",
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
    categories = event.get("categories", "")
    url = event.get("url", "")
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
    if categories:
        lines.append(f"CATEGORIES:{_escape_ics(categories)}")
    if url:
        # A URI value is not TEXT, so commas and semicolons stay as they are;
        # line breaks are still removed so the value cannot start a property.
        lines.append(f"URL:{''.join(url.splitlines())}")

    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines.append(f"DTSTAMP:{now}")
    lines.append("END:VEVENT")
    return lines


def _escape_ics(text: str) -> str:
    """Escape special characters per RFC 5545.

    All line breaks (CRLF, lone CR, lone LF) are folded to the escaped ``\\n``
    sequence. A bare ``\\r`` must not survive: RFC 5545 lines are CRLF-delimited
    and many parsers treat a lone CR as a line break, so an unescaped CR in a
    field value (e.g. an event title/description/location) could inject arbitrary
    ICS properties or events (calendar spoofing).
    """
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
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
            # Never echo an unparseable string straight into DTSTART/DTEND — it
            # would be an ICS-injection sink. Escape it so it can't break out.
            return _escape_ics(dt)
    if isinstance(dt, datetime):
        # The trailing Z states UTC. Stored datetimes come back naive and are
        # UTC already; an aware one in another zone has to be converted, or
        # its wall-clock time would be published as if it were UTC.
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y%m%dT%H%M%SZ")
    return str(dt)
