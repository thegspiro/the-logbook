"""PayPal reconciliation backfill (SF-backfill).

The webhook is the primary path. When PayPal's verify API is unreachable the
webhook answers 401, PayPal stops retrying, and the capture is lost from the
ledger. The backfill recovers it from PayPal's own API.

PayPal is mocked throughout — at the HTTP client for the two API wrappers, and
at the wrapper functions for the service — so nothing here touches the network.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration
from app.models.storefront import StoreOrder, StorePaymentEvent
from app.services import paypal_backfill_service as backfill_mod
from app.services.integration_services import paypal_service
from app.services.integration_services.paypal_service import (
    PayPalError,
    fetch_completed_capture,
    search_incoming_transactions,
)
from app.services.paypal_backfill_service import backfill_paypal_captures
from app.services.storefront_service import StorefrontService

_BASE = "https://api-m.sandbox.paypal.com"


# ---------------------------------------------------------------------------
# The two PayPal API wrappers, against a fake HTTP client
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int, body: dict | None = None):
        self.status_code = status_code
        self._body = body or {}

    def json(self):
        return self._body


class _FakeClient:
    """Answers GETs from a queue and records what was asked for."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[tuple[str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None, params=None):
        self.calls.append((url, params or {}))
        return self._responses.pop(0)


def _fake_http(client: _FakeClient):
    return patch.object(
        paypal_service, "create_integration_client", MagicMock(return_value=client)
    )


def _txn(transaction_id, value="45.00", email=None):
    detail = {
        "transaction_info": {
            "transaction_id": transaction_id,
            "transaction_amount": {"value": value, "currency_code": "USD"},
        }
    }
    if email:
        detail["payer_info"] = {
            "email_address": email,
            "payer_name": {"given_name": "Pat", "surname": "Member"},
        }
    return detail


@pytest.mark.unit
class TestTransactionSearch:
    _START = datetime(2026, 10, 1, tzinfo=timezone.utc)
    _END = datetime(2026, 10, 5, tzinfo=timezone.utc)

    async def test_keeps_incoming_payments_and_drops_the_rest(self):
        client = _FakeClient(
            [
                _FakeResponse(
                    200,
                    {
                        "transaction_details": [
                            _txn("CAP-IN", email="pat@example.org"),
                            _txn("REFUND-OUT", value="-45.00"),
                            {"transaction_info": {}},
                        ],
                        "total_pages": 1,
                    },
                )
            ]
        )
        with _fake_http(client):
            found = await search_incoming_transactions(
                _BASE, "tok", self._START, self._END
            )

        assert found == [
            {
                "transaction_id": "CAP-IN",
                "payer_email": "pat@example.org",
                "payer_name": "Pat Member",
            }
        ]
        url, params = client.calls[0]
        assert url == f"{_BASE}/v1/reporting/transactions"
        assert params["transaction_status"] == "S"
        assert params["start_date"] == "2026-10-01T00:00:00+0000"

    async def test_follows_pages(self):
        client = _FakeClient(
            [
                _FakeResponse(
                    200, {"transaction_details": [_txn("A")], "total_pages": 2}
                ),
                _FakeResponse(
                    200, {"transaction_details": [_txn("B")], "total_pages": 2}
                ),
            ]
        )
        with _fake_http(client):
            found = await search_incoming_transactions(
                _BASE, "tok", self._START, self._END
            )
        assert [f["transaction_id"] for f in found] == ["A", "B"]
        assert [c[1]["page"] for c in client.calls] == ["1", "2"]

    async def test_a_page_count_beyond_the_bound_stops_at_the_bound(self):
        pages = paypal_service._SEARCH_MAX_PAGES
        client = _FakeClient(
            [
                _FakeResponse(
                    200, {"transaction_details": [], "total_pages": pages + 50}
                )
                for _ in range(pages)
            ]
        )
        with _fake_http(client):
            await search_incoming_transactions(_BASE, "tok", self._START, self._END)
        assert len(client.calls) == pages

    async def test_a_refused_search_says_why(self):
        client = _FakeClient([_FakeResponse(403)])
        with _fake_http(client), pytest.raises(PayPalError, match="Transaction Search"):
            await search_incoming_transactions(_BASE, "tok", self._START, self._END)


@pytest.mark.unit
class TestCaptureReread:
    async def test_completed_capture_is_returned(self):
        body = {"id": "CAP-1", "status": "COMPLETED", "amount": {"value": "45.00"}}
        client = _FakeClient([_FakeResponse(200, body)])
        with _fake_http(client):
            assert await fetch_completed_capture(_BASE, "tok", "CAP-1") == body
        assert client.calls[0][0] == f"{_BASE}/v2/payments/captures/CAP-1"

    @pytest.mark.parametrize("status", ["REFUNDED", "PARTIALLY_REFUNDED", "PENDING"])
    async def test_anything_but_completed_is_skipped(self, status):
        client = _FakeClient([_FakeResponse(200, {"id": "CAP-1", "status": status})])
        with _fake_http(client):
            assert await fetch_completed_capture(_BASE, "tok", "CAP-1") is None

    async def test_a_transaction_that_is_not_a_capture_is_skipped(self):
        client = _FakeClient([_FakeResponse(404)])
        with _fake_http(client):
            assert await fetch_completed_capture(_BASE, "tok", "PAYOUT-1") is None

    async def test_a_different_capture_in_the_answer_is_not_trusted(self):
        client = _FakeClient(
            [_FakeResponse(200, {"id": "CAP-OTHER", "status": "COMPLETED"})]
        )
        with _fake_http(client):
            assert await fetch_completed_capture(_BASE, "tok", "CAP-1") is None

    async def test_the_id_cannot_steer_the_path(self):
        client = _FakeClient([_FakeResponse(404)])
        with _fake_http(client):
            await fetch_completed_capture(_BASE, "tok", "../../v1/oauth2/token")
        assert client.calls[0][0] == (
            f"{_BASE}/v2/payments/captures/..%2F..%2Fv1%2Foauth2%2Ftoken"
        )


# ---------------------------------------------------------------------------
# record_external_payment: a lost unique-key race answers with the winner
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_a_concurrent_duplicate_returns_the_row_that_won():
    winner = SimpleNamespace(id="evt-webhook")
    lookups = iter([None, winner])

    def _result():
        result = MagicMock()
        result.scalar_one_or_none.return_value = next(lookups)
        return result

    db = MagicMock()
    db.execute = AsyncMock(side_effect=lambda *a, **k: _result())
    db.add = MagicMock()
    db.commit = AsyncMock(side_effect=IntegrityError("INSERT", {}, Exception("dup")))
    db.rollback = AsyncMock()
    service = StorefrontService(db)

    with patch.object(service, "find_order_by_reference", AsyncMock(return_value=None)):
        event = await service.record_external_payment(
            "org-1",
            "paypal",
            {"capture_id": "CAP-RACE", "amount": Decimal("10.00")},
        )

    assert event is winner
    db.rollback.assert_awaited_once()


# ---------------------------------------------------------------------------
# The backfill against MySQL, with PayPal mocked at the wrapper functions
# ---------------------------------------------------------------------------


async def _org(db: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, active) VALUES (:i, 'Backfill FD', 'fire_department', "
            ":s, 'UTC', 1)"
        ),
        {"i": org_id, "s": f"backfill-{org_id[:8]}"},
    )
    return org_id


async def _order(db: AsyncSession, org_id: str, number: str, total: int) -> str:
    window_id, order_id = str(uuid.uuid4()), str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO store_order_windows (id, organization_id, name, status) "
            "VALUES (:i, :o, 'Window', 'open')"
        ),
        {"i": window_id, "o": org_id},
    )
    await db.execute(
        text(
            "INSERT INTO store_orders (id, organization_id, window_id, "
            "order_number, customer_name, status, payment_status, subtotal, "
            "tax_amount, shipping_amount, discount_amount, total, amount_paid, "
            "fulfillment_method, submitted_at) VALUES (:i, :o, :w, :n, 'M', "
            "'submitted', 'unpaid', :t, 0, 0, 0, :t, 0, 'pickup', NOW())"
        ),
        {"i": order_id, "o": org_id, "w": window_id, "n": number, "t": total},
    )
    return order_id


async def _integration(
    db: AsyncSession, org_id: str, created_at: datetime | None = None
) -> Integration:
    integration = Integration(
        organization_id=org_id,
        integration_type="paypal",
        name="PayPal",
        category="Payments",
        status="connected",
        enabled=True,
        config={"environment": "sandbox", "auto_apply_payments": True},
    )
    integration.set_secret("client_id", "cid")
    integration.set_secret("client_secret", "csec")
    db.add(integration)
    await db.flush()
    if created_at is not None:
        integration.created_at = created_at
        await db.flush()
    # MySQL has no RETURNING, so the server-default timestamps are left
    # expired after the flush and the service's read of created_at would be
    # a lazy load (MariaDB 10.5+ returns them, which is why it passed there).
    await db.refresh(integration)
    return integration


def _capture(capture_id: str, invoice: str, value: str = "100.00") -> dict:
    return {
        "id": capture_id,
        "status": "COMPLETED",
        "amount": {"value": value, "currency_code": "USD"},
        "invoice_id": invoice,
        "create_time": "2026-10-04T12:00:00Z",
    }


class _PayPal:
    """The account's view: what Transaction Search lists, what each capture
    re-reads as. Patches the wrappers the service calls."""

    def __init__(self, listed: list[dict], captures: dict[str, dict | None]):
        self.search = AsyncMock(return_value=listed)
        self.fetch = AsyncMock(side_effect=lambda _b, _t, cid: captures.get(cid))

    def __enter__(self):
        self._patches = [
            patch.object(
                backfill_mod, "get_access_token", AsyncMock(return_value="tok")
            ),
            patch.object(backfill_mod, "search_incoming_transactions", self.search),
            patch.object(backfill_mod, "fetch_completed_capture", self.fetch),
        ]
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in reversed(self._patches):
            p.stop()
        return False


def _listed(*ids: str) -> list[dict]:
    return [
        {"transaction_id": i, "payer_email": "pat@example.org", "payer_name": "Pat M"}
        for i in ids
    ]


async def _events(db: AsyncSession, org_id: str) -> list[StorePaymentEvent]:
    result = await db.execute(
        select(StorePaymentEvent).where(StorePaymentEvent.organization_id == org_id)
    )
    return list(result.scalars().all())


@pytest.mark.integration
class TestBackfill:
    async def test_a_missed_capture_is_recorded_and_settles_its_order(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        order_id = await _order(db_session, org_id, "ORD-2026-9001", 100)
        integration = await _integration(db_session, org_id)

        with _PayPal(
            _listed("CAP-MISSED"),
            {"CAP-MISSED": _capture("CAP-MISSED", "ORD-2026-9001")},
        ):
            outcome = await backfill_paypal_captures(db_session, integration)

        assert outcome["recorded"] == 1
        (event,) = await _events(db_session, org_id)
        assert event.external_id == "CAP-MISSED"
        assert event.matched_order_id == order_id
        assert event.payer_email == "pat@example.org"
        assert event.raw_payload["source"] == "paypal_backfill"
        order = await db_session.get(StoreOrder, order_id)
        await db_session.refresh(order)
        assert Decimal(order.amount_paid) == Decimal("100")

    async def test_a_second_run_records_nothing_and_reads_nothing(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        await _order(db_session, org_id, "ORD-2026-9002", 100)
        integration = await _integration(db_session, org_id)
        captures = {"CAP-TWICE": _capture("CAP-TWICE", "ORD-2026-9002")}

        with _PayPal(_listed("CAP-TWICE"), captures):
            await backfill_paypal_captures(db_session, integration)
        with _PayPal(_listed("CAP-TWICE"), captures) as paypal:
            outcome = await backfill_paypal_captures(db_session, integration)

        assert outcome["recorded"] == 0
        assert outcome["already_recorded"] == 1
        paypal.fetch.assert_not_awaited()
        assert len(await _events(db_session, org_id)) == 1

    async def test_a_capture_the_webhook_recorded_is_left_alone(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        order_id = await _order(db_session, org_id, "ORD-2026-9003", 100)
        integration = await _integration(db_session, org_id)
        resource = _capture("CAP-HOOKED", "ORD-2026-9003")
        webhook_event = {
            "id": "WH-1",
            "event_type": "PAYMENT.CAPTURE.COMPLETED",
            "resource": resource,
        }
        await StorefrontService(db_session).record_external_payment(
            org_id,
            "paypal",
            paypal_service.extract_capture(webhook_event),
            raw_payload=webhook_event,
        )

        with _PayPal(_listed("CAP-HOOKED"), {"CAP-HOOKED": resource}) as paypal:
            outcome = await backfill_paypal_captures(db_session, integration)

        assert outcome["recorded"] == 0
        paypal.fetch.assert_not_awaited()
        (event,) = await _events(db_session, org_id)
        assert event.raw_payload["id"] == "WH-1"
        order = await db_session.get(StoreOrder, order_id)
        await db_session.refresh(order)
        # Paid once by the webhook, not again by the backfill.
        assert Decimal(order.amount_paid) == Decimal("100")

    async def test_the_webhook_landing_mid_run_is_not_recorded_twice(
        self, db_session: AsyncSession
    ):
        """The webhook records the capture after the backfill's known-check
        and before its write: the backfill gets the webhook's row back."""
        org_id = await _org(db_session)
        await _order(db_session, org_id, "ORD-2026-9004", 100)
        integration = await _integration(db_session, org_id)
        resource = _capture("CAP-LATE", "ORD-2026-9004")
        webhook_event = {
            "id": "WH-LATE",
            "event_type": "PAYMENT.CAPTURE.COMPLETED",
            "resource": resource,
        }

        async def _fetch_while_webhook_lands(_base, _token, _cid):
            await StorefrontService(db_session).record_external_payment(
                org_id,
                "paypal",
                paypal_service.extract_capture(webhook_event),
                raw_payload=webhook_event,
            )
            return resource

        with _PayPal(_listed("CAP-LATE"), {}) as paypal:
            paypal.fetch.side_effect = _fetch_while_webhook_lands
            outcome = await backfill_paypal_captures(db_session, integration)

        assert outcome["recorded"] == 0
        assert outcome["already_recorded"] == 1
        (event,) = await _events(db_session, org_id)
        assert event.raw_payload["id"] == "WH-LATE"

    async def test_only_completed_captures_are_recorded(self, db_session: AsyncSession):
        org_id = await _org(db_session)
        integration = await _integration(db_session, org_id)

        # fetch_completed_capture answers None for a refunded capture or a
        # transaction that is not a capture at all.
        with _PayPal(_listed("CAP-REFUNDED"), {"CAP-REFUNDED": None}):
            outcome = await backfill_paypal_captures(db_session, integration)

        assert outcome["recorded"] == 0
        assert outcome["not_captures"] == 1
        assert await _events(db_session, org_id) == []

    async def test_records_into_its_own_organization_only(
        self, db_session: AsyncSession
    ):
        """Org B has an order with the same number and has already recorded
        the same capture id; org A's backfill touches neither."""
        org_a = await _org(db_session)
        org_b = await _org(db_session)
        order_a = await _order(db_session, org_a, "ORD-2026-9005", 100)
        order_b = await _order(db_session, org_b, "ORD-2026-9005", 100)
        integration_a = await _integration(db_session, org_a)
        await StorefrontService(db_session).record_external_payment(
            org_b,
            "paypal",
            {"capture_id": "CAP-SHARED-ID", "amount": Decimal("1.00")},
            auto_apply=False,
        )

        with _PayPal(
            _listed("CAP-SHARED-ID"),
            {"CAP-SHARED-ID": _capture("CAP-SHARED-ID", "ORD-2026-9005")},
        ) as paypal:
            outcome = await backfill_paypal_captures(db_session, integration_a)

        # Org B's row does not count as "already recorded" for org A.
        paypal.fetch.assert_awaited_once()
        assert outcome["recorded"] == 1
        (event_a,) = await _events(db_session, org_a)
        assert event_a.matched_order_id == order_a
        b = await db_session.get(StoreOrder, order_b)
        await db_session.refresh(b)
        assert Decimal(b.amount_paid) == Decimal("0")

    async def test_never_reaches_back_before_paypal_was_connected(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        now = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)
        connected = now - timedelta(days=2)
        integration = await _integration(db_session, org_id, created_at=connected)

        with _PayPal([], {}) as paypal:
            await backfill_paypal_captures(db_session, integration, now=now)

        _base, _token, start, end = paypal.search.await_args.args
        assert start == connected
        assert end == now

    async def test_looks_back_a_week_for_an_older_integration(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        now = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)
        integration = await _integration(
            db_session, org_id, created_at=now - timedelta(days=90)
        )

        with _PayPal([], {}) as paypal:
            await backfill_paypal_captures(db_session, integration, now=now)

        _base, _token, start, _end = paypal.search.await_args.args
        assert start == now - timedelta(days=7)


# ---------------------------------------------------------------------------
# The scheduled task
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_one_departments_failure_does_not_stop_the_next():
    from app.services import scheduled_tasks

    class _Row:
        """Models what a real rollback does to a loaded instance: every
        attribute is expired, and reading one without an awaited reload is a
        lazy load, which async SQLAlchemy refuses."""

        def __init__(self, org_id):
            self._org_id = org_id
            self.expired = False

        @property
        def organization_id(self):
            if self.expired:
                raise RuntimeError("MissingGreenlet: lazy load after rollback")
            return self._org_id

    good = _Row("org-good")
    bad = _Row("org-bad")
    result = MagicMock()
    result.scalars.return_value.all.return_value = [bad, good]
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)

    async def _rollback():
        for row in (good, bad):
            row.expired = True

    async def _refresh(row):
        row.expired = False

    db.rollback = AsyncMock(side_effect=_rollback)
    db.refresh = AsyncMock(side_effect=_refresh)

    async def _backfill(_db, integration):
        if integration is bad:
            raise PayPalError("PayPal refused Transaction Search")
        # The service's first act is to read the integration's fields.
        assert integration.organization_id == "org-good"
        return {"recorded": 2}

    with (
        patch.object(backfill_mod, "backfill_paypal_captures", _backfill),
        patch.object(
            scheduled_tasks, "persist_task_error_log", AsyncMock()
        ) as error_log,
    ):
        outcome = await scheduled_tasks.run_paypal_capture_backfill(db)

    assert outcome == {
        "task": "paypal_capture_backfill",
        "integrations": 2,
        "recorded": 2,
        "failed": 1,
    }
    db.rollback.assert_awaited_once()
    db.refresh.assert_awaited_once_with(good)
    assert error_log.await_args.args[0] == "org-bad"


@pytest.mark.unit
def test_the_task_is_scheduled_and_triggerable():
    from app.services.scheduled_tasks import (
        SCHEDULE,
        TASK_INTERVALS_SECONDS,
        TASK_RUNNERS,
    )

    assert "paypal_capture_backfill" in SCHEDULE
    assert TASK_INTERVALS_SECONDS["paypal_capture_backfill"] == 86400
    # TASK_RUNNERS is what POST /scheduled/run-task dispatches on.
    assert "paypal_capture_backfill" in TASK_RUNNERS
