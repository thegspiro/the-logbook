"""
Shared pieces of the Google Calendar and Outlook connectors.

The connectors push department events one way, into a single calendar the
app created. Everything a provider receives comes out of
``build_calendar_payload``: it is an allowlist, so a new column on ``Event``
reaches an external calendar only when somebody adds it here on purpose.

Provider failures are raised as the typed errors below rather than logged and
swallowed, so a caller can tell "reconnect required" from "try again later"
from "already gone".
"""

import base64
import email.utils
import hashlib
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

if TYPE_CHECKING:
    from app.models.event import Event


class CalendarError(Exception):
    """A calendar provider call failed. Messages are safe to store and show:
    they never carry the provider's raw response or transport detail."""


class CalendarAuthRevoked(CalendarError):
    """The grant is gone (revoked, expired or invalid_grant): retrying cannot
    succeed until an administrator reconnects the integration."""


class CalendarRateLimited(CalendarError):
    """The provider asked us to slow down (429, 503, or Google's 403 rate
    reasons). ``retry_after`` is in seconds, or None when none was sent."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class CalendarNotFound(CalendarError):
    """The calendar or event does not exist (404, or Google's 410 Gone)."""


class CalendarConflict(CalendarError):
    """The id is already taken (409): an earlier insert of the same event
    landed, so the caller should update instead."""


class CalendarTransient(CalendarError):
    """A timeout, connection failure or 5xx: worth retrying later."""


@dataclass(frozen=True)
class CalendarTokens:
    """OAuth tokens after a refresh. The service never stores these: the
    caller persists them, including a rotated ``refresh_token``."""

    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    rotated: bool


ClientFactory = Callable[[], httpx.AsyncClient]

# Refresh this long before the provider's stated expiry, so a token does not
# lapse between the check and the request that uses it.
TOKEN_EXPIRY_MARGIN = timedelta(seconds=60)


def parse_retry_after(value: str | None) -> float | None:
    """Seconds from a Retry-After header (delta-seconds or an HTTP date)."""
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())


def error_for_status(
    provider: str, status: int, retry_after: str | None = None
) -> CalendarError:
    """The typed error for an HTTP status both providers share."""
    if status == 401:
        return CalendarAuthRevoked(
            f"{provider} rejected the stored authorization — reconnect required"
        )
    if status in (429, 503):
        return CalendarRateLimited(
            f"{provider} is rate limiting requests",
            parse_retry_after(retry_after),
        )
    if status in (404, 410):
        return CalendarNotFound(f"{provider} has no such calendar or event")
    if status == 409:
        return CalendarConflict(f"{provider} already has an event with this id")
    if status >= 500:
        return CalendarTransient(f"{provider} returned a server error ({status})")
    return CalendarError(f"{provider} refused the request ({status})")


def token_is_fresh(expires_at: datetime | None) -> bool:
    """True when a token with this expiry can be used without refreshing.
    An unknown expiry is trusted; a 401 still triggers one refresh."""
    if expires_at is None:
        return True
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at - TOKEN_EXPIRY_MARGIN > datetime.now(timezone.utc)


def parse_expires_at(value: Any) -> datetime | None:
    """Accept a stored ``token_expires_at`` as a datetime or ISO string."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


async def refresh_oauth_token(
    provider: str,
    token_url: str,
    form: dict[str, str],
    refresh_token: str,
    client_factory: ClientFactory,
) -> CalendarTokens:
    """POST a refresh_token grant and return the new tokens.

    ``invalid_grant`` (revoked, expired, or the password changed) and
    ``invalid_client`` both mean nothing will work until an administrator
    reconnects, so both raise CalendarAuthRevoked.
    """
    data = {**form, "grant_type": "refresh_token", "refresh_token": refresh_token}
    try:
        async with client_factory() as client:
            response = await client.post(token_url, data=data)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise CalendarTransient(
            f"{provider} token refresh could not reach the provider"
        ) from exc

    if response.status_code in (400, 401):
        try:
            error = response.json().get("error")
        except ValueError:
            error = None
        if error in ("invalid_grant", "invalid_client", "unauthorized_client") or (
            response.status_code == 401
        ):
            raise CalendarAuthRevoked(
                f"{provider} authorization was revoked — reconnect required"
            )
        raise CalendarError(f"{provider} refused the token refresh")
    if response.status_code >= 300:
        raise error_for_status(
            provider, response.status_code, response.headers.get("retry-after")
        )

    try:
        body = response.json()
    except ValueError as exc:
        raise CalendarTransient(f"{provider} token response was not JSON") from exc
    access = body.get("access_token")
    if not isinstance(access, str) or not access:
        raise CalendarError(f"{provider} token response had no access token")
    new_refresh = body.get("refresh_token")
    if not isinstance(new_refresh, str) or not new_refresh:
        new_refresh = refresh_token
    expires_in = body.get("expires_in")
    expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        if isinstance(expires_in, (int, float, str)) and str(expires_in).isdigit()
        else None
    )
    return CalendarTokens(
        access_token=access,
        refresh_token=new_refresh,
        expires_at=expires_at,
        rotated=new_refresh != refresh_token,
    )


async def with_refresh_on_401(
    call: Callable[[], Awaitable[Any]],
    refresh: Callable[[], Awaitable[CalendarTokens]] | None,
) -> Any:
    """Run ``call``; on CalendarAuthRevoked, refresh once and retry.

    An access token can be revoked or expire early without the stored expiry
    saying so. Only a second 401, after a successful refresh, is final.
    """
    try:
        return await call()
    except CalendarAuthRevoked:
        if refresh is None:
            raise
    await refresh()
    return await call()


# ---------------------------------------------------------------------------
# Payload
# ---------------------------------------------------------------------------


def _as_zone(dt: datetime, tz: ZoneInfo) -> datetime:
    # MySQL does not store an offset: DateTime(timezone=True) columns come
    # back naive, holding UTC, so naive means UTC here.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz)


def _type_label(event: "Event", event_type_label: str | None) -> str | None:
    if event_type_label:
        return event_type_label
    raw = getattr(event.event_type, "value", event.event_type)
    if not raw:
        return None
    return str(raw).replace("_", " ").title()


def build_calendar_payload(
    event: "Event",
    *,
    org_timezone: str,
    base_url: str,
    sync_descriptions: bool = False,
    location_name: str | None = None,
    event_type_label: str | None = None,
) -> dict[str, Any]:
    """The provider-neutral, allowlisted view of an event.

    Only these keys leave the system: title, start/end (in the organization's
    timezone), location name, event type label, a link back to the event,
    and the description when the integration opted in. RSVPs, attendees,
    custom fields, attachments, the cancellation reason and the organizer are
    never read here, so they cannot be sent.

    ``event_id`` is the Logbook id, used to derive provider ids; it is also
    visible in the link, so it adds nothing a subscriber could not see.
    """
    try:
        tz = ZoneInfo(org_timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("UTC")
        org_timezone = "UTC"
    location = location_name or event.location or None
    description = (event.description or None) if sync_descriptions else None
    return {
        "event_id": str(event.id),
        "title": event.title,
        "start": _as_zone(event.start_datetime, tz).isoformat(),
        "end": _as_zone(event.end_datetime, tz).isoformat(),
        "time_zone": org_timezone or "UTC",
        "location": location,
        "event_type": _type_label(event, event_type_label),
        "url": f"{base_url.rstrip('/')}/events/{event.id}",
        "description": description,
    }


def payload_body_text(payload: dict[str, Any]) -> str:
    """The body text both providers show: the opted-in description, then the
    event type and the link back."""
    parts: list[str] = []
    if payload.get("description"):
        parts.append(str(payload["description"]))
    if payload.get("event_type"):
        parts.append(f"Type: {payload['event_type']}")
    parts.append(f"View in The Logbook: {payload['url']}")
    return "\n\n".join(parts)


def content_hash(payload: dict[str, Any]) -> str:
    """A stable digest of a payload: key order and dict identity do not
    matter, any value change does."""
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def google_event_id(event_id: str) -> str:
    """A deterministic Google Calendar event id for a Logbook event UUID.

    Google allows a client-chosen id of 5-1024 characters from base32hex
    (``a-v`` and ``0-9``). The UUID's 16 bytes encode to 26 such characters,
    so inserting the same event twice collides on the id (409) instead of
    creating a duplicate.
    """
    raw = uuid.UUID(str(event_id)).bytes
    return base64.b32hexencode(raw).decode("ascii").rstrip("=").lower()
