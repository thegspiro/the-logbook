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

# Bound one run's work so a huge backlog (first enablement on an old
# install) drains across runs instead of blocking the scheduler loop.
_MAX_BATCHES_PER_RUN = 20


async def _get_or_create_state(db: AsyncSession) -> AuditShipState:
    state = (await db.execute(select(AuditShipState).limit(1))).scalar_one_or_none()
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

    state = await _get_or_create_state(db)
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=30.0)
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
    finally:
        if own_client:
            await client.aclose()

    if results["error"]:
        logger.warning(
            f"Audit shipping stopped after {results['batches']} batch(es): "
            f"{results['error']}"
        )
    return results
