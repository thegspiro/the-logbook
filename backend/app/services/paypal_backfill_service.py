"""
PayPal reconciliation backfill (SF-backfill)

Recovers store payments the PayPal webhook never recorded. The webhook is the
primary path and stays so; this exists for the case it cannot cover. When
PayPal's verify-webhook-signature API is unreachable the webhook answers 401,
PayPal stops retrying after a few days, and the capture is then absent from
the ledger with no way to re-ingest it — a member has paid and the order
still says unpaid.

The run, per enabled PayPal integration:

1. Transaction Search lists the account's successful incoming transactions in
   the lookback window. It only *discovers* candidates.
2. Ids already in ``store_payment_events`` for this organization are dropped
   before anything else is fetched.
3. Each remaining id is re-read from the Payments API capture endpoint, and
   only a capture it reports COMPLETED goes on (see
   ``fetch_completed_capture``).
4. That capture is recorded through ``StorefrontService.record_external_payment``
   — the webhook's own entry point — wrapped as the PAYMENT.CAPTURE.COMPLETED
   event the webhook would have received. Matching, the currency and balance
   guards and the auto-apply choice are therefore the webhook's, not a second
   copy of them.

Idempotent with the webhook: both key a payment on the capture id, which is
unique per organization and provider in the database. A capture the webhook
already recorded is skipped at step 2; one the webhook records while the
backfill is working loses the unique-key race to whichever wrote first, and
``record_external_payment`` answers with the winner rather than writing it
twice. Nothing is applied to an order twice.

Org-scoped by construction: every PayPal call is made with that organization's
own credentials, so the account can only report its own captures, and every
read and write here is filtered on, or stamped with, the integration's
organization id.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.models.integration import Integration
from app.models.storefront import StorePaymentEvent
from app.services.integration_services.paypal_service import (
    credentials_from_integration,
    extract_capture,
    fetch_completed_capture,
    get_access_token,
    paypal_auto_apply,
    search_incoming_transactions,
)
from app.services.storefront_service import StorefrontService

PROVIDER = "paypal"

# PayPal retries a failed webhook for about three days; a week covers that
# with room for a backfill run that itself failed. Transaction Search accepts
# at most 31 days per request.
LOOKBACK = timedelta(days=7)

# Capture reads per integration per run. Each is one PayPal call; the rest of
# a large gap is picked up by the next run while still inside LOOKBACK.
MAX_CAPTURE_READS = 200


def _as_utc(moment: Optional[datetime]) -> Optional[datetime]:
    if moment is None:
        return None
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def _with_search_payer(
    resource: Dict[str, Any], candidate: Dict[str, Any]
) -> Dict[str, Any]:
    """The capture, plus the payer Transaction Search named if it has none.

    A capture object usually carries no payer; the webhook gets one from the
    event's supplementary data. The payer is shown to the treasurer on an
    unmatched payment and plays no part in matching, which reads only the
    capture's own references.
    """
    if resource.get("payer") or (resource.get("supplementary_data") or {}).get("payer"):
        return resource
    if not (candidate.get("payer_email") or candidate.get("payer_name")):
        return resource
    given, _, surname = (candidate.get("payer_name") or "").partition(" ")
    supplementary = dict(resource.get("supplementary_data") or {})
    supplementary["payer"] = {
        "email_address": candidate.get("payer_email"),
        "name": {"given_name": given or None, "surname": surname or None},
    }
    return {**resource, "supplementary_data": supplementary}


async def _already_recorded(
    db: AsyncSession, organization_id: str, capture_ids: List[str]
) -> set[str]:
    if not capture_ids:
        return set()
    result = await db.execute(
        select(StorePaymentEvent.external_id).where(
            StorePaymentEvent.organization_id == organization_id,
            StorePaymentEvent.provider == PROVIDER,
            StorePaymentEvent.external_id.in_(capture_ids),
        )
    )
    return {str(row) for row in result.scalars().all()}


async def backfill_paypal_captures(
    db: AsyncSession,
    integration: Integration,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Record completed captures for one integration that the ledger lacks.

    Raises ``PayPalError`` when PayPal refuses the credentials or the search,
    so the scheduled task can put it in front of the department; per-capture
    outcomes are counted, not raised.
    """
    organization_id = str(integration.organization_id)
    base_url, client_id, client_secret, _ = credentials_from_integration(integration)
    if not client_id or not client_secret:
        return {"organization_id": organization_id, "skipped": "no credentials"}

    end = _as_utc(now) or datetime.now(timezone.utc)
    start = end - LOOKBACK
    # Never reach back past the moment the department connected PayPal:
    # earlier captures were never this ledger's to record.
    connected_at = _as_utc(integration.created_at)
    if connected_at is not None and connected_at > start:
        start = connected_at

    token = await get_access_token(base_url, client_id, client_secret)
    candidates = await search_incoming_transactions(base_url, token, start, end)

    by_id: Dict[str, Dict[str, Any]] = {}
    for candidate in candidates:
        by_id.setdefault(candidate["transaction_id"], candidate)
    known = await _already_recorded(db, organization_id, list(by_id))
    missing = [cid for cid in by_id if cid not in known]

    auto_apply = paypal_auto_apply(integration.config or {})
    service = StorefrontService(db)
    recorded = 0
    raced = 0
    not_captures = 0
    for capture_id in missing[:MAX_CAPTURE_READS]:
        resource = await fetch_completed_capture(base_url, token, capture_id)
        if resource is None:
            not_captures += 1
            continue
        resource = _with_search_payer(resource, by_id[capture_id])
        capture = extract_capture(
            {"event_type": "PAYMENT.CAPTURE.COMPLETED", "resource": resource}
        )
        if capture is None:
            not_captures += 1
            continue
        raw_payload = {"source": "paypal_backfill", "resource": resource}
        event = await service.record_external_payment(
            organization_id,
            PROVIDER,
            capture,
            raw_payload=raw_payload,
            auto_apply=auto_apply,
        )
        if event.raw_payload != raw_payload:
            # The webhook recorded this capture after the step-2 check; its
            # row won the unique key and is what came back.
            raced += 1
            continue
        await log_audit_event(
            db=db,
            event_type="store_payment_received",
            event_category="storefront",
            severity="info",
            event_data={
                "provider": PROVIDER,
                "source": "backfill",
                "integration_id": str(integration.id),
                "organization_id": organization_id,
                "capture_id": capture.get("capture_id"),
                "amount": str(capture.get("amount")),
                "match_status": event.status.value if event.status else None,
                "matched_order_id": event.matched_order_id,
            },
        )
        await db.commit()
        recorded += 1

    deferred = max(len(missing) - MAX_CAPTURE_READS, 0)
    if recorded or deferred:
        logger.info(
            "PayPal backfill for org {}: {} recorded, {} deferred to the next run",
            organization_id,
            recorded,
            deferred,
        )
    return {
        "organization_id": organization_id,
        "searched": len(by_id),
        "already_recorded": len(known) + raced,
        "recorded": recorded,
        "not_captures": not_captures,
        "deferred": deferred,
    }
