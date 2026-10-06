"""
Off-Host Audit-Log Shipping (ISO/IEC 27001 A.8.15)

The audit chain's HMAC hash chain detects tampering, but it cannot survive
deletion of the whole table by an attacker with database access. Shipping a
copy to an external collector (SIEM, log archive, another host) closes that
gap: the off-host copy is outside the attacker's reach.

Delivery model: a scheduled task POSTs new rows as NDJSON batches to
``AUDIT_SHIP_WEBHOOK_URL``. Each request carries an HMAC-SHA256 signature of
the body (``X-Logbook-Signature: sha256=<hex>``, keyed with the audit
signing key) so the collector can authenticate the sender. The high-water
mark (``audit_ship_state``) advances only after the collector acknowledges
with a 2xx — failed deliveries are simply retried next run.

Rows purged by retention before ever being shipped are skipped by the
watermark; with the default cadences (shipping every 30 minutes, retention
after 7 years) that never happens in practice.
"""

import asyncio
import hashlib
import hmac
import json
from datetime import UTC, datetime
from typing import Any

import httpx
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import _get_audit_signing_key, audit_logger
from app.core.config import settings
from app.models.audit import AuditLog, AuditShipState
from app.services.integration_services.base import create_integration_client
from app.utils.ssrf_transport import UnsafeDestinationError
from app.utils.url_validator import assert_outbound_url_safe

# Bound one run's work so a huge backlog (first enablement on an old
# install) drains across runs instead of blocking the scheduler loop.
_MAX_BATCHES_PER_RUN = 20


async def _get_or_create_state(db: AsyncSession) -> AuditShipState:
    # Locked read: this task runs both on a schedule and via a manual
    # /scheduled/run-task?task=audit_log_ship trigger (system.run_tasks), so
    # two runs can start concurrently. A plain SELECT would let both read the
    # same watermark, ship an overlapping batch, and race to advance it --
    # whichever commits last can regress the watermark, causing the next run
    # to re-deliver rows already shipped (CLAUDE.md pitfall #27's model,
    # applied to a watermark advance rather than a capacity count). FOR UPDATE
    # makes the second run block until the first commits, so it starts from an
    # advanced watermark rather than the same one.
    #
    # What this does NOT do, deliberately, is serialize a whole run: the
    # per-batch `db.commit()` in `ship_new_audit_logs` is what makes progress
    # durable, and committing is also what releases this lock. So the two runs
    # are serialized for their first batch only; past that both proceed from
    # the watermark as it stood after batch 1 and can deliver the same later
    # batches twice. The collector sees duplicates (it is given
    # `X-Logbook-First-Id`/`X-Logbook-Last-Id` to deduplicate on) and no row is
    # ever lost or skipped, which is the trade this shape accepts: durable
    # per-batch progress and at-least-once delivery, rather than exactly-once
    # at the cost of re-shipping a whole run after any mid-run failure.
    # Closing the gap properly needs a run-scoped claim rather than a row lock
    # -- recorded as OPS-7 rather than bolted on here.
    state = (
        await db.execute(select(AuditShipState).limit(1).with_for_update())
    ).scalar_one_or_none()
    if state is None:
        state = AuditShipState(id=1, last_shipped_id=0)
        db.add(state)
        await db.flush()
    return state


def _sign(payload: bytes) -> str:
    return hmac.new(
        _get_audit_signing_key().encode(), payload, hashlib.sha256
    ).hexdigest()


async def ship_new_audit_logs(
    db: AsyncSession,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Deliver audit rows past the watermark to the configured collector."""
    results: dict[str, Any] = {
        "shipped_entries": 0,
        "batches": 0,
        "skipped_reason": None,
        "error": None,
    }
    url = settings.AUDIT_SHIP_WEBHOOK_URL
    if not url:
        results["skipped_reason"] = "AUDIT_SHIP_WEBHOOK_URL not configured"
        return results

    # Validate the collector URL once per run, before taking the watermark
    # lock or opening a client: it is identical for every batch, and the
    # guard's DNS resolution is blocking, so it runs in a worker thread
    # (to_thread) instead of stalling the event loop — a slow resolver would
    # otherwise freeze every coroutine in the worker, up to
    # _MAX_BATCHES_PER_RUN times per run. Each scheduled run still re-resolves,
    # keeping the DNS-rebinding window to one shipping interval, and fails
    # closed for private/internal destinations unless the operator has
    # explicitly accepted a trusted-network collector.
    #
    # Its own try/except, and ahead of `_get_or_create_state`, for two
    # reasons: a `ValueError` raised anywhere else in the run (a misconfigured
    # signing key, say) used to be reported to the operator as "unsafe
    # collector URL", which sends them to the wrong setting entirely; and a
    # blocking DNS lookup should not be held across a `FOR UPDATE` row lock.
    try:
        await asyncio.to_thread(
            assert_outbound_url_safe,
            url,
            allow_private=settings.AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION,
        )
    except ValueError as exc:
        results["error"] = f"unsafe collector URL: {exc}"
        logger.warning(f"Audit shipping blocked unsafe collector URL: {exc}")
        return results

    state = await _get_or_create_state(db)
    own_client = client is None
    if own_client:
        # The shared factory, not a bare AsyncClient: the check above narrows
        # DNS rebinding, but only the factory's pinned transport closes it, by
        # connecting to the address it validated rather than re-resolving
        # (SCH-10). The operator's private-destination opt-in reaches the
        # pinning too, so a trusted on-prem collector keeps working.
        client = create_integration_client(
            timeout=httpx.Timeout(30.0),
            allow_private_destinations=settings.AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION,
        )
    try:
        for _ in range(_MAX_BATCHES_PER_RUN):
            rows = (
                (
                    await db.execute(
                        select(AuditLog)
                        .where(AuditLog.id > state.last_shipped_id)
                        .order_by(AuditLog.id)
                        .limit(settings.AUDIT_SHIP_BATCH_SIZE)
                    )
                )
                .scalars()
                .all()
            )
            if not rows:
                break

            payload = (
                "\n".join(
                    json.dumps(
                        audit_logger.serialize_row(row), sort_keys=True, default=str
                    )
                    for row in rows
                )
                + "\n"
            ).encode("utf-8")

            response = await client.post(
                url,
                content=payload,
                headers={
                    "Content-Type": "application/x-ndjson",
                    "X-Logbook-Signature": f"sha256={_sign(payload)}",
                    "X-Logbook-First-Id": str(rows[0].id),
                    "X-Logbook-Last-Id": str(rows[-1].id),
                },
            )
            if response.status_code < 200 or response.status_code >= 300:
                results["error"] = f"collector returned HTTP {response.status_code}"
                break

            # Advance the watermark durably per acknowledged batch, so a
            # failure mid-run never re-ships confirmed rows.
            state.last_shipped_id = rows[-1].id
            state.last_shipped_at = datetime.now(UTC)
            await db.commit()
            results["shipped_entries"] += len(rows)
            results["batches"] += 1
    except httpx.HTTPError as exc:
        results["error"] = f"delivery failed: {exc.__class__.__name__}"
        logger.warning(f"Audit shipping delivery failed: {exc!r}")
    except UnsafeDestinationError as exc:
        # The pinned transport's own resolution refused the collector — the
        # URL check above passed, so the name changed answers between the two.
        results["error"] = f"unsafe collector URL: {exc}"
        logger.warning(f"Audit shipping blocked unsafe collector URL: {exc}")
    except ValueError as exc:
        # Kept broad, but no longer labelled "unsafe collector URL" — the URL
        # check has its own handler above, and a ValueError raised in the loop
        # is something else entirely (a misconfigured audit signing key is the
        # realistic one). Reporting that as a URL problem sent an operator to
        # the wrong setting. Still returned rather than raised: both callers
        # treat this function's results dict as its contract, and the manual
        # `/scheduled/run-task` trigger does not wrap the runner, so raising
        # here would turn a misconfiguration into a 500.
        results["error"] = f"delivery aborted: {exc.__class__.__name__}: {exc}"
        logger.warning(f"Audit shipping aborted: {exc!r}")
    finally:
        if own_client:
            await client.aclose()

    if results["error"]:
        logger.warning(
            f"Audit shipping stopped after {results['batches']} batch(es): "
            f"{results['error']}"
        )
    return results
