"""
Calendar sync: publish department events one way into an external calendar.

``reconcile_integration`` makes one connected Google Calendar or Outlook
integration's calendar match the department's events. It compares what each
event should look like now (``build_calendar_payload``, an allowlist) with the
digest recorded in ``calendar_sync_mappings`` and creates, updates or deletes
only what differs. The ``calendar_sync`` scheduled task calls it every five
minutes while ``CALENDAR_SYNC_ENABLED`` is on.

What is published:

- events whose time overlaps the window from 30 days ago to ``days_ahead``
  days ahead (integration config, default 180);
- not drafts; cancelled events are deleted from the calendar;
- only the event types in ``event_types_to_sync`` when that list is set;
- each stored occurrence of a recurring series, as its own event.

An event that drops out of that set — deleted, cancelled, turned back into a
draft, filtered out, moved past the window — is deleted from the calendar. An
event that ages out of the past end of the window is left in the calendar and
simply forgotten, so subscribers keep their history.

A push or delete that fails is retried after 5, 10, 20, 40 and 80 minutes and
then left as failed until the event changes. A rate limit, a provider outage
or a revoked grant ends the integration's pass at once; a revoked grant also
marks the integration as needing to be reconnected, so the task stops trying
until an administrator does.
"""

import copy
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.core.config import settings
from app.models.event import Event
from app.models.integration import (
    CALENDAR_SYNC_FAILED,
    CALENDAR_SYNC_PENDING_DELETE,
    CALENDAR_SYNC_SYNCED,
    CalendarSyncMapping,
    Integration,
)
from app.models.location import Location
from app.models.user import Organization
from app.services.integration_health import (
    record_integration_run,
    sanitize_integration_error,
)
from app.services.integration_services.calendar_common import (
    CalendarAuthRevoked,
    CalendarError,
    CalendarNotFound,
    CalendarRateLimited,
    CalendarTransient,
    build_calendar_payload,
    content_hash,
    google_event_id,
)
from app.services.integration_services.calendar_interface import CalendarSyncInterface
from app.utils.org_timezone import scheduling_timezone

CALENDAR_INTEGRATION_TYPES = ("google-calendar", "outlook")

SYNC_OPERATION = "calendar_sync"

PAST_WINDOW = timedelta(days=30)
DEFAULT_DAYS_AHEAD = 180
MAX_DAYS_AHEAD = 730

# Provider calls one pass may make. Whatever is left waits for the next pass,
# five minutes later, so a first sync of a busy calendar spreads out instead
# of tripping the provider's rate limit in one burst.
MAX_OPS_PER_PASS = 200

# Wait before retry n (1-based). A failure after the last one leaves the row
# failed until the event changes.
RETRY_DELAYS = tuple(timedelta(minutes=m) for m in (5, 10, 20, 40, 80))

# A rate limit with no Retry-After pauses the integration this long; a longer
# Retry-After is honoured up to the cap, so a bad header cannot stall it for
# days.
DEFAULT_RATE_LIMIT_PAUSE = timedelta(minutes=5)
MAX_RATE_LIMIT_PAUSE = timedelta(hours=1)

# Public config keys this module writes.
PAUSED_UNTIL_KEY = "sync_paused_until"
TOKEN_EXPIRES_KEY = "token_expires_at"

RECONNECT_REQUIRED = (
    "Reconnect required: the calendar provider no longer accepts the stored "
    "authorization."
)

ServiceFactory = Callable[[Integration], CalendarSyncInterface]

_EVENT_COLUMNS = (
    Event.id,
    Event.organization_id,
    Event.title,
    Event.description,
    Event.event_type,
    Event.custom_category,
    Event.location_id,
    Event.location,
    Event.start_datetime,
    Event.end_datetime,
    Event.is_draft,
    Event.is_cancelled,
)


class _StopPass(Exception):
    """Ends the integration's pass; the reason is already recorded."""


@dataclass
class _Pass:
    counts: dict[str, int] = field(
        default_factory=lambda: {
            "created": 0,
            "updated": 0,
            "deleted": 0,
            "unchanged": 0,
            "failed": 0,
            "waiting": 0,
            "deferred": 0,
            "forgotten": 0,
        }
    )
    ops: int = 0
    stop_error: Optional[str] = None
    first_failure: Optional[str] = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    # MySQL hands DateTime(timezone=True) back naive, holding UTC.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _parse_iso(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        return _aware(datetime.fromisoformat(value))
    except ValueError:
        return None


def _error_text(exc: BaseException) -> str:
    # CalendarError messages are written by the connectors and never carry a
    # provider response; anything else goes through the generic sanitizer,
    # which replaces an unvetted message with a stock sentence.
    if isinstance(exc, CalendarError):
        return sanitize_integration_error(str(exc))
    return sanitize_integration_error(exc)


def _set_config(integration: Integration, **values: Any) -> None:
    # Integration.config is plain JSON: a new dict is what marks it dirty.
    config = copy.deepcopy(integration.config or {})
    for key, value in values.items():
        if value is None:
            config.pop(key, None)
        else:
            config[key] = value
    integration.config = config


def _days_ahead(config: dict[str, Any]) -> int:
    raw = config.get("days_ahead")
    if isinstance(raw, bool):
        return DEFAULT_DAYS_AHEAD
    try:
        days = int(raw) if raw is not None else DEFAULT_DAYS_AHEAD
    except (TypeError, ValueError):
        return DEFAULT_DAYS_AHEAD
    return max(1, min(days, MAX_DAYS_AHEAD))


def _type_filter(config: dict[str, Any]) -> Optional[set[str]]:
    raw = config.get("event_types_to_sync")
    if not isinstance(raw, list) or not raw:
        return None
    return {str(v) for v in raw if isinstance(v, str) and v}


def _event_type_value(event: Event) -> str:
    return str(getattr(event.event_type, "value", event.event_type) or "")


def has_credentials(integration: Integration) -> bool:
    return bool(
        integration.get_secret("refresh_token")
        or integration.get_secret("access_token")
        or integration.get_secret("token")
    )


def default_service_factory(integration: Integration) -> CalendarSyncInterface:
    """The provider service for an integration, with its stored credentials.

    A department's own OAuth client (``client_id`` / ``client_secret``
    secrets) takes precedence; otherwise the deployment's Google or Azure AD
    sign-in app is used, as the design reuses those registrations.
    """
    from app.services.integration_services import _get_calendar_credentials

    creds = _get_calendar_credentials(integration)
    if integration.integration_type == "google-calendar":
        from app.services.integration_services.google_calendar_service import (
            GoogleCalendarService,
        )

        if settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
            creds.setdefault("client_id", settings.GOOGLE_CLIENT_ID)
            creds.setdefault("client_secret", settings.GOOGLE_CLIENT_SECRET)
        return GoogleCalendarService(creds)

    from app.services.integration_services.outlook_calendar_service import (
        OutlookCalendarService,
    )

    if settings.AZURE_AD_CLIENT_ID and settings.AZURE_AD_CLIENT_SECRET:
        creds.setdefault("client_id", settings.AZURE_AD_CLIENT_ID)
        creds.setdefault("client_secret", settings.AZURE_AD_CLIENT_SECRET)
        if settings.AZURE_AD_TENANT_ID:
            creds.setdefault("tenant_id", settings.AZURE_AD_TENANT_ID)
    return OutlookCalendarService(creds)


def _persist_tokens(integration: Integration, service: CalendarSyncInterface) -> None:
    """Store tokens the service refreshed during the pass.

    A provider may rotate the refresh token on use; losing the new one would
    strand the integration on a token the provider has retired.
    """
    tokens = service.tokens
    if tokens is None:
        return
    integration.set_secret("access_token", tokens.access_token)
    if tokens.refresh_token:
        integration.set_secret("refresh_token", tokens.refresh_token)
    # The services read "token" before "access_token"; a stale copy under the
    # older key would shadow the fresh one.
    if integration.get_secret("token"):
        integration.clear_secret("token")
    _set_config(
        integration,
        **{
            TOKEN_EXPIRES_KEY: (
                tokens.expires_at.isoformat() if tokens.expires_at else None
            )
        },
    )


async def _load_desired(
    db: AsyncSession,
    integration: Integration,
    organization: Organization,
    now: datetime,
) -> tuple[dict[str, tuple[Event, dict[str, Any], str]], datetime]:
    """Events that should be in the calendar, keyed by id, with payloads."""
    org_id = str(integration.organization_id)
    config = integration.config or {}
    window_start = now - PAST_WINDOW
    window_end = now + timedelta(days=_days_ahead(config))
    types = _type_filter(config)

    result = await db.execute(
        select(Event)
        .options(load_only(*_EVENT_COLUMNS))
        .where(
            Event.organization_id == org_id,
            Event.end_datetime >= window_start,
            Event.start_datetime <= window_end,
            Event.is_cancelled.is_(False),
            Event.is_draft.isnot(True),
        )
    )
    events = [
        e
        for e in result.scalars().all()
        if types is None or _event_type_value(e) in types
    ]

    location_ids = {e.location_id for e in events if e.location_id}
    locations: dict[str, str] = {}
    if location_ids:
        rows = await db.execute(
            select(Location.id, Location.name).where(
                Location.organization_id == org_id,
                Location.id.in_(location_ids),
            )
        )
        locations = {str(i): n for i, n in rows.all() if n}

    category_labels: dict[str, str] = {}
    event_settings = (organization.settings or {}).get("events") or {}
    for category in event_settings.get("custom_event_categories") or []:
        if isinstance(category, dict) and category.get("value"):
            label = category.get("label")
            if isinstance(label, str) and label:
                category_labels[str(category["value"])] = label

    tz_name = scheduling_timezone(organization).key
    sync_descriptions = config.get("sync_descriptions") is True
    desired: dict[str, tuple[Event, dict[str, Any], str]] = {}
    for event in events:
        payload = build_calendar_payload(
            event,
            org_timezone=tz_name,
            base_url=settings.FRONTEND_URL,
            sync_descriptions=sync_descriptions,
            location_name=locations.get(str(event.location_id or "")),
            event_type_label=category_labels.get(event.custom_category or ""),
        )
        desired[str(event.id)] = (event, payload, content_hash(payload))
    return desired, window_start


def _record_failure(
    mapping: CalendarSyncMapping,
    message: str,
    now: datetime,
    *,
    intended_hash: Optional[str],
) -> None:
    deleting = intended_hash is None
    mapping.content_hash = intended_hash
    mapping.attempt_count = (mapping.attempt_count or 0) + 1
    mapping.last_error = message
    if mapping.attempt_count <= len(RETRY_DELAYS):
        mapping.next_attempt_at = now + RETRY_DELAYS[mapping.attempt_count - 1]
        mapping.status = (
            CALENDAR_SYNC_PENDING_DELETE if deleting else CALENDAR_SYNC_FAILED
        )
    else:
        mapping.next_attempt_at = None
        mapping.status = CALENDAR_SYNC_FAILED


def _due(
    mapping: CalendarSyncMapping, intended_hash: Optional[str], now: datetime
) -> Optional[bool]:
    """Whether to act on ``mapping`` this pass.

    True: act now. False: waiting for a retry. None: nothing to do — already
    in sync, or retries are spent for this exact intent.
    """
    if intended_hash is not None and mapping.status == CALENDAR_SYNC_SYNCED:
        if mapping.content_hash == intended_hash:
            return None
        return True
    if mapping.content_hash != intended_hash:
        # The intent changed since the last attempt: start over at once.
        mapping.attempt_count = 0
        mapping.next_attempt_at = None
        return True
    if mapping.next_attempt_at is None:
        return None if mapping.status == CALENDAR_SYNC_FAILED else True
    return _aware(mapping.next_attempt_at) <= now


async def _call(
    integration: Integration,
    state: _Pass,
    mapping: CalendarSyncMapping,
    now: datetime,
    work: Callable[[], Awaitable[Any]],
    *,
    intended_hash: Optional[str],
) -> bool:
    """Run one provider call for ``mapping``. True when it succeeded.

    A rate limit or a revoked grant does not count against the row's
    retries: it is tried again on the next pass that runs.
    """
    state.ops += 1
    try:
        await work()
        return True
    except CalendarRateLimited as exc:
        pause = (
            timedelta(seconds=exc.retry_after)
            if exc.retry_after
            else DEFAULT_RATE_LIMIT_PAUSE
        )
        pause = min(max(pause, timedelta(seconds=1)), MAX_RATE_LIMIT_PAUSE)
        _set_config(integration, **{PAUSED_UNTIL_KEY: (now + pause).isoformat()})
        state.stop_error = _error_text(exc)
        raise _StopPass() from exc
    except CalendarAuthRevoked as exc:
        integration.status = "error"
        state.stop_error = RECONNECT_REQUIRED
        raise _StopPass() from exc
    except CalendarTransient as exc:
        # The provider is down or unreachable; the rest of the pass would
        # fail the same way, one event at a time.
        message = _error_text(exc)
        _record_failure(mapping, message, now, intended_hash=intended_hash)
        state.counts["failed"] += 1
        state.stop_error = message
        raise _StopPass() from exc
    except Exception as exc:
        message = _error_text(exc)
        if not isinstance(exc, CalendarError):
            logger.opt(exception=True).warning(
                "Calendar sync call failed for integration {}", integration.id
            )
        _record_failure(mapping, message, now, intended_hash=intended_hash)
        state.counts["failed"] += 1
        state.first_failure = state.first_failure or message
        return False


async def reconcile_integration(
    db: AsyncSession,
    integration: Integration,
    *,
    service_factory: Optional[ServiceFactory] = None,
    trigger: str = "scheduled",
) -> dict[str, int]:
    """Bring one integration's calendar in line with the department's events.

    Flushes but does not commit; the caller commits. Returns the pass's
    counts. Provider failures are recorded on the mapping rows and in the
    integration's run history rather than raised.
    """
    org_id = str(integration.organization_id)
    config = integration.config or {}
    calendar_id = config.get("calendar_id")
    if (
        integration.integration_type not in CALENDAR_INTEGRATION_TYPES
        or integration.status != "connected"
        or not isinstance(calendar_id, str)
        or not calendar_id
        or not has_credentials(integration)
    ):
        return {"skipped": 1}

    now = _utcnow()
    paused_until = _parse_iso(config.get(PAUSED_UNTIL_KEY))
    if paused_until is not None:
        if paused_until > now:
            return {"paused": 1}
        _set_config(integration, **{PAUSED_UNTIL_KEY: None})

    organization = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    if organization is None:
        return {"skipped": 1}

    started = time.monotonic()
    desired, window_start = await _load_desired(db, integration, organization, now)
    mappings = {
        m.event_id: m
        for m in (
            await db.execute(
                select(CalendarSyncMapping).where(
                    CalendarSyncMapping.organization_id == org_id,
                    CalendarSyncMapping.integration_id == str(integration.id),
                )
            )
        )
        .scalars()
        .all()
    }

    # Mapped events that are no longer wanted: find out why, so one that
    # merely aged out of the past end of the window is not deleted.
    unwanted_ids = [eid for eid in mappings if eid not in desired]
    still_present: dict[str, Event] = {}
    if unwanted_ids:
        rows = await db.execute(
            select(Event)
            .options(load_only(*_EVENT_COLUMNS))
            .where(Event.organization_id == org_id, Event.id.in_(unwanted_ids))
        )
        still_present = {str(e.id): e for e in rows.scalars().all()}

    state = _Pass()
    service = (service_factory or default_service_factory)(integration)
    try:
        # Deletions first: a cancelled event still showing is the more
        # misleading error.
        for event_id in unwanted_ids:
            mapping = mappings[event_id]
            event = still_present.get(event_id)
            if (
                event is not None
                and not event.is_cancelled
                and not event.is_draft
                and _aware(event.end_datetime) < window_start
            ):
                await db.delete(mapping)
                state.counts["forgotten"] += 1
                continue
            await _delete_one(db, integration, service, state, mapping, now)

        upcoming = sorted(
            desired.values(),
            key=lambda item: (
                _aware(item[0].end_datetime) < now,
                _aware(item[0].start_datetime),
            ),
        )
        for event, payload, digest in upcoming:
            await _push_one(
                db,
                integration,
                service,
                state,
                mappings.get(str(event.id)),
                payload,
                digest,
                calendar_id,
                now,
            )
    except _StopPass:
        pass
    finally:
        _persist_tokens(integration, service)
        await db.flush()

    counts = dict(state.counts)
    if state.stop_error is not None:
        success, error = False, state.stop_error
    elif state.first_failure is not None:
        success, error = False, (
            f"{counts['failed']} event(s) could not be published and will be "
            f"retried. First error: {state.first_failure}"
        )
    else:
        success, error = True, None
    await record_integration_run(
        db,
        integration,
        operation=SYNC_OPERATION,
        trigger=trigger,
        success=success,
        summary=counts,
        error=error,
        started_monotonic=started,
        mark_synced=success,
    )
    return counts


def _over_budget(state: _Pass) -> bool:
    if state.ops >= MAX_OPS_PER_PASS:
        state.counts["deferred"] += 1
        return True
    return False


async def _delete_one(
    db: AsyncSession,
    integration: Integration,
    service: CalendarSyncInterface,
    state: _Pass,
    mapping: CalendarSyncMapping,
    now: datetime,
) -> None:
    if not mapping.external_event_id or not mapping.external_calendar_id:
        # Never reached the calendar: nothing to remove there.
        await db.delete(mapping)
        state.counts["deleted"] += 1
        return
    due = _due(mapping, None, now)
    if due is None:
        return
    if not due:
        state.counts["waiting"] += 1
        return
    if _over_budget(state):
        return
    mapping.status = CALENDAR_SYNC_PENDING_DELETE
    mapping.content_hash = None
    calendar_id = mapping.external_calendar_id
    external_id = mapping.external_event_id

    async def work() -> None:
        try:
            await service.delete_event(calendar_id, external_id)
        except CalendarNotFound:
            # Already gone from the calendar, which is the goal.
            pass

    ok = await _call(integration, state, mapping, now, work, intended_hash=None)
    if ok:
        await db.delete(mapping)
        state.counts["deleted"] += 1


async def _push_one(
    db: AsyncSession,
    integration: Integration,
    service: CalendarSyncInterface,
    state: _Pass,
    mapping: Optional[CalendarSyncMapping],
    payload: dict[str, Any],
    digest: str,
    calendar_id: str,
    now: datetime,
) -> None:
    if mapping is not None and mapping.external_calendar_id not in (
        None,
        calendar_id,
    ):
        # The integration points at a different calendar now; the event has
        # to be created there, and the old calendar is no longer ours to edit.
        mapping.external_calendar_id = None
        mapping.external_event_id = None
        mapping.content_hash = None
        mapping.status = CALENDAR_SYNC_FAILED
        mapping.attempt_count = 0
        mapping.next_attempt_at = None

    if mapping is not None:
        due = _due(mapping, digest, now)
        if due is None:
            if mapping.status == CALENDAR_SYNC_SYNCED:
                state.counts["unchanged"] += 1
            return
        if not due:
            state.counts["waiting"] += 1
            return
    if _over_budget(state):
        return

    if mapping is None:
        mapping = CalendarSyncMapping(
            organization_id=str(integration.organization_id),
            integration_id=str(integration.id),
            event_id=payload["event_id"],
            status=CALENDAR_SYNC_FAILED,
            attempt_count=0,
        )
        db.add(mapping)
    existing_id = mapping.external_event_id
    previously_synced = existing_id is not None and mapping.last_synced_at is not None
    if integration.integration_type == "google-calendar" and existing_id is None:
        # Known before the call, so a failed insert can still be cleaned up
        # by id if the event is deleted before a retry succeeds.
        mapping.external_event_id = google_event_id(payload["event_id"])
    mapping.external_calendar_id = calendar_id

    result: dict[str, str] = {}

    async def work() -> None:
        result["id"] = await service.upsert_event(calendar_id, existing_id, payload)

    ok = await _call(integration, state, mapping, now, work, intended_hash=digest)
    if not ok:
        return
    mapping.external_event_id = result["id"]
    mapping.content_hash = digest
    mapping.status = CALENDAR_SYNC_SYNCED
    mapping.attempt_count = 0
    mapping.next_attempt_at = None
    mapping.last_error = None
    mapping.last_synced_at = now
    state.counts["updated" if previously_synced else "created"] += 1
