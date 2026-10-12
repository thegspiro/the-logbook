"""
Integration health: last error, consecutive failures and a bounded run history.

Every outbound run against a third-party integration — a Salesforce sync, a
connection test, a chat notification, a Retry Sync — is recorded here so an
administrator can see whether an integration is working without reading the
server log.

What is stored is deliberately thin. An error message passes through
``sanitize_integration_error`` before it is written: only a connector's own
hand-written message survives (anything else becomes a generic sentence), and
even that is stripped of URLs — a Slack or Teams webhook URL *is* its secret —
email addresses, bearer tokens and long token-shaped strings, then capped. A
run's ``summary`` keeps integer counts only, never the records themselves, so
no member's name or contact detail lands in the history.
"""

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Optional

from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import sanitize_connector_error
from app.models.integration import (
    INTEGRATION_RUN_FAILURE,
    INTEGRATION_RUN_RUNNING,
    INTEGRATION_RUN_SUCCESS,
    Integration,
    IntegrationSyncLog,
)

# Per-integration history kept; older rows are pruned on every write so a
# webhook that fires on every event cannot grow the table without bound.
MAX_SYNC_HISTORY = 50

# Longest error message stored or shown.
MAX_ERROR_LENGTH = 300

# Consecutive failures at which an integration reads "failing" rather than
# "degraded" — one failure is often a blip, three in a row is not.
FAILING_THRESHOLD = 3

_URL = re.compile(r"\b[a-z][a-z0-9+.-]*://\S+", re.IGNORECASE)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_BEARER = re.compile(r"\b(bearer|basic|token)\s+\S+", re.IGNORECASE)
_KEY_VALUE = re.compile(
    r"\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|"
    r"secret|password|token)\s*[=:]\s*\S+",
    re.IGNORECASE,
)
_LONG_TOKEN = re.compile(r"\b[A-Za-z0-9_\-]{24,}\b")


def sanitize_integration_error(exc: BaseException | str) -> str:
    """Return an error message safe to store and show for an integration run."""
    if isinstance(exc, BaseException):
        from app.services.integration_services.paypal_service import PayPalError

        if isinstance(exc, Exception):
            message = sanitize_connector_error(exc, trusted_types=(PayPalError,))
        else:
            message = "The integration run was interrupted."
    else:
        message = exc
    message = _URL.sub("[url]", message)
    message = _EMAIL.sub("[email]", message)
    message = _BEARER.sub(lambda m: f"{m.group(1)} [redacted]", message)
    message = _KEY_VALUE.sub(lambda m: f"{m.group(1)}=[redacted]", message)
    message = _LONG_TOKEN.sub("[redacted]", message)
    message = " ".join(message.split())
    if len(message) > MAX_ERROR_LENGTH:
        message = message[: MAX_ERROR_LENGTH - 1].rstrip() + "…"
    return message or "The integration run failed."


def summarize_counts(counts: Optional[Mapping[str, Any]]) -> dict[str, int]:
    """Keep only integer counts, flattening nested mappings into joined keys.

    ``{"push": {"members": {"created": 2}}}`` becomes
    ``{"push_members_created": 2}``. Any non-integer value — a list of
    contacts, a name, a flag — is dropped: the history is a health record,
    not a copy of the data that moved.
    """
    flat: dict[str, int] = {}

    def walk(prefix: str, value: Any, depth: int) -> None:
        if isinstance(value, bool):
            return
        if isinstance(value, int):
            flat[prefix[:60]] = value
        elif isinstance(value, Mapping) and depth < 3:
            for key, sub in value.items():
                walk(f"{prefix}_{key}" if prefix else str(key), sub, depth + 1)

    walk("", counts or {}, 0)
    return flat


def health_state(integration: Integration) -> str:
    """``unknown`` (never run), ``healthy``, ``degraded`` or ``failing``."""
    errors = integration.consecutive_error_count or 0
    if errors >= FAILING_THRESHOLD:
        return "failing"
    if errors > 0:
        return "degraded"
    if integration.last_success_at or integration.last_sync_at:
        return "healthy"
    return "unknown"


def sync_log_to_dict(row: IntegrationSyncLog) -> dict[str, Any]:
    return {
        "id": row.id,
        "operation": row.operation,
        "trigger": row.trigger_source,
        "status": row.status,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
        "duration_ms": row.duration_ms,
        "summary": row.summary or {},
        "error_message": row.error_message,
        "triggered_by": row.triggered_by,
    }


async def start_integration_run(
    db: AsyncSession,
    integration: Integration,
    *,
    operation: str,
    trigger: str,
    user_id: Optional[str] = None,
) -> IntegrationSyncLog:
    """Insert a ``running`` history row and return it (flushed, not committed)."""
    run = IntegrationSyncLog(
        organization_id=str(integration.organization_id),
        integration_id=str(integration.id),
        operation=operation[:50],
        trigger_source=trigger[:20],
        status=INTEGRATION_RUN_RUNNING,
        started_at=datetime.now(timezone.utc),
        triggered_by=user_id,
    )
    db.add(run)
    await db.flush()
    return run


async def finish_integration_run(
    db: AsyncSession,
    integration: Integration,
    run: IntegrationSyncLog,
    *,
    success: bool,
    summary: Optional[Mapping[str, Any]] = None,
    error: BaseException | str | None = None,
    mark_synced: bool = False,
) -> None:
    """Close ``run`` and update the integration's health fields.

    ``mark_synced`` also advances ``last_sync_at`` — only for a run that
    actually synchronized data, not a connection test or a chat message.
    """
    now = datetime.now(timezone.utc)
    run.finished_at = now
    started = run.started_at
    if started is not None:
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        run.duration_ms = max(0, int((now - started).total_seconds() * 1000))
    run.summary = summarize_counts(summary) or None
    if success:
        run.status = INTEGRATION_RUN_SUCCESS
        integration.consecutive_error_count = 0
        integration.last_success_at = now
        if mark_synced:
            integration.last_sync_at = now
    else:
        message = sanitize_integration_error(
            error if error is not None else "The integration run failed."
        )
        run.status = INTEGRATION_RUN_FAILURE
        run.error_message = message
        integration.consecutive_error_count = (
            integration.consecutive_error_count or 0
        ) + 1
        integration.last_error = message
        integration.last_error_at = now
    await db.flush()
    await _prune_history(db, str(integration.id))


async def record_integration_run(
    db: AsyncSession,
    integration: Integration,
    *,
    operation: str,
    trigger: str,
    success: bool,
    summary: Optional[Mapping[str, Any]] = None,
    error: BaseException | str | None = None,
    user_id: Optional[str] = None,
    started_monotonic: Optional[float] = None,
    mark_synced: bool = False,
) -> None:
    """Record a finished run in one step. Never raises.

    Runs inside a SAVEPOINT so a failed write rolls back only the history row,
    leaving the caller's transaction usable — health bookkeeping must never
    break the operation it observes. The caller commits.
    """
    try:
        async with db.begin_nested():
            run = await start_integration_run(
                db, integration, operation=operation, trigger=trigger, user_id=user_id
            )
            if started_monotonic is not None:
                elapsed = time.monotonic() - started_monotonic
                run.started_at = datetime.now(timezone.utc) - timedelta(
                    seconds=max(0.0, elapsed)
                )
            await finish_integration_run(
                db,
                integration,
                run,
                success=success,
                summary=summary,
                error=error,
                mark_synced=mark_synced,
            )
    except Exception as exc:
        logger.warning(
            "Could not record {} run for integration {}: {}",
            operation,
            integration.id,
            type(exc).__name__,
        )


async def _prune_history(db: AsyncSession, integration_id: str) -> None:
    stale = (
        (
            await db.execute(
                select(IntegrationSyncLog.id)
                .where(IntegrationSyncLog.integration_id == integration_id)
                .order_by(
                    IntegrationSyncLog.started_at.desc(), IntegrationSyncLog.id.desc()
                )
                .offset(MAX_SYNC_HISTORY)
            )
        )
        .scalars()
        .all()
    )
    if not stale:
        return
    await db.execute(
        delete(IntegrationSyncLog).where(IntegrationSyncLog.id.in_(list(stale)))
    )
