"""Tests for off-host audit-log shipping (watermark + HMAC-signed NDJSON).

``TestConcurrentShipRuns`` (marked ``integration``) needs two real,
independently-committing database sessions to reproduce a watermark race and
so cannot run in the no-DB unit job.
"""

import asyncio
import hashlib
import hmac
import json
import uuid
from unittest.mock import MagicMock

import httpx
import pytest
from sqlalchemy import delete, select

import app.services.audit_ship_service as audit_ship_module
from app.core.audit import _get_audit_signing_key, audit_logger
from app.core.config import settings
from app.core.database import database_manager
from app.models.audit import AuditLog, AuditShipState
from app.services.audit_ship_service import ship_new_audit_logs

pytestmark = pytest.mark.integration

_URL = "https://collector.example/ingest"


@pytest.fixture(autouse=True)
def _public_collector(monkeypatch):
    """Keep shipping tests independent of external DNS resolution."""
    monkeypatch.setattr(audit_ship_module, "assert_outbound_url_safe", MagicMock())


async def _write_logs(db, count: int) -> list:
    rows = []
    for i in range(count):
        row = await audit_logger.create_log_entry(
            db,
            event_type=f"ship_test_{uuid.uuid4().hex[:6]}_{i}",
            event_category="security",
            severity="info",
            event_data={"i": i},
        )
        rows.append(row)
    return rows


def _collector(status_code: int = 200):
    """A mock collector client capturing every delivery request."""
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(status_code)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), captured


async def _watermark(db) -> int:
    state = (await db.execute(select(AuditShipState).limit(1))).scalar_one_or_none()
    return state.last_shipped_id if state else 0


class TestAuditShipping:
    async def test_skips_when_not_configured(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "AUDIT_SHIP_WEBHOOK_URL", None)
        result = await ship_new_audit_logs(db_session)
        assert result["skipped_reason"] == "AUDIT_SHIP_WEBHOOK_URL not configured"
        assert result["shipped_entries"] == 0

    async def test_ships_signed_ndjson_and_advances_watermark(
        self, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "AUDIT_SHIP_WEBHOOK_URL", _URL)
        rows = await _write_logs(db_session, 3)
        client, captured = _collector()

        result = await ship_new_audit_logs(db_session, client=client)

        assert result["error"] is None
        assert result["shipped_entries"] == 3
        assert len(captured) == 1
        body = captured[0].content
        lines = body.decode().strip().splitlines()
        assert len(lines) == 3
        first = json.loads(lines[0])
        assert first["id"] == rows[0].id
        assert first["current_hash"] == rows[0].current_hash

        # Signature authenticates the exact body with the audit signing key.
        expected_sig = hmac.new(
            _get_audit_signing_key().encode(), body, hashlib.sha256
        ).hexdigest()
        assert captured[0].headers["X-Logbook-Signature"] == f"sha256={expected_sig}"
        assert captured[0].headers["X-Logbook-Last-Id"] == str(rows[-1].id)

        assert await _watermark(db_session) == rows[-1].id

    async def test_failed_delivery_does_not_advance_watermark(
        self, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "AUDIT_SHIP_WEBHOOK_URL", _URL)
        await _write_logs(db_session, 2)
        before = await _watermark(db_session)
        client, captured = _collector(status_code=500)

        result = await ship_new_audit_logs(db_session, client=client)

        assert result["shipped_entries"] == 0
        assert result["error"] == "collector returned HTTP 500"
        assert len(captured) == 1
        assert await _watermark(db_session) == before

    async def test_unsafe_collector_is_blocked_before_delivery(
        self, db_session, monkeypatch
    ):
        url = "https://127.0.0.1/internal-collector"
        monkeypatch.setattr(settings, "AUDIT_SHIP_WEBHOOK_URL", url)
        await _write_logs(db_session, 1)
        before = await _watermark(db_session)
        guard = MagicMock(side_effect=ValueError("private/internal IP address"))
        monkeypatch.setattr(audit_ship_module, "assert_outbound_url_safe", guard)
        client, captured = _collector()

        result = await ship_new_audit_logs(db_session, client=client)

        assert result["shipped_entries"] == 0
        assert result["error"] == ("unsafe collector URL: private/internal IP address")
        guard.assert_called_once_with(url, allow_private=False)
        assert captured == []
        assert await _watermark(db_session) == before

    async def test_second_run_ships_only_new_rows(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "AUDIT_SHIP_WEBHOOK_URL", _URL)
        await _write_logs(db_session, 2)
        client, _ = _collector()
        first = await ship_new_audit_logs(db_session, client=client)
        assert first["shipped_entries"] == 2

        new_rows = await _write_logs(db_session, 1)
        client2, captured2 = _collector()
        second = await ship_new_audit_logs(db_session, client=client2)

        assert second["shipped_entries"] == 1
        lines = captured2[0].content.decode().strip().splitlines()
        assert [json.loads(line)["id"] for line in lines] == [new_rows[0].id]

    async def test_batching_splits_deliveries(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "AUDIT_SHIP_WEBHOOK_URL", _URL)
        monkeypatch.setattr(settings, "AUDIT_SHIP_BATCH_SIZE", 1)
        rows = await _write_logs(db_session, 3)
        client, captured = _collector()

        result = await ship_new_audit_logs(db_session, client=client)

        assert result["shipped_entries"] == 3
        assert result["batches"] == 3
        assert len(captured) == 3
        assert await _watermark(db_session) == rows[-1].id


@pytest.mark.usefixtures("_initialize_database")
class TestConcurrentShipRuns:
    """SEC2-28-9: the watermark read must be a locking read.

    ``audit_log_ship`` runs both on a schedule and via a manual
    ``/scheduled/run-task?task=audit_log_ship`` trigger, so two runs can
    execute concurrently. A plain SELECT would let both read the same
    watermark, ship an overlapping batch to the collector, and race to
    advance it -- whichever commits last can regress the watermark, causing
    the next run to re-deliver rows already shipped. Real committed rows,
    two independent sessions, and asyncio.gather -- a mocked session cannot
    reproduce real row-lock blocking.
    """

    async def test_two_concurrent_runs_never_double_ship_or_regress_watermark(
        self, monkeypatch
    ):
        monkeypatch.setattr(settings, "AUDIT_SHIP_WEBHOOK_URL", _URL)
        monkeypatch.setattr(audit_ship_module, "assert_outbound_url_safe", MagicMock())

        async with database_manager.session_factory() as setup:
            rows = await _write_logs(setup, 4)
            await setup.commit()
            last_id = rows[-1].id
            # Pre-create the watermark row so this test exercises only the
            # locked steady-state read, not the (separate, far narrower)
            # first-ever-row creation race.
            setup.add(AuditShipState(id=1, last_shipped_id=0))
            await setup.commit()

        session_a = database_manager.session_factory()
        session_b = database_manager.session_factory()
        client_a, captured_a = _collector()
        client_b, captured_b = _collector()
        try:
            result_a, result_b = await asyncio.gather(
                ship_new_audit_logs(session_a, client=client_a),
                ship_new_audit_logs(session_b, client=client_b),
                return_exceptions=True,
            )

            for label, outcome in (("A", result_a), ("B", result_b)):
                assert not isinstance(
                    outcome, BaseException
                ), f"run {label} raised {outcome!r} instead of completing"

            assert result_a["error"] is None
            assert result_b["error"] is None

            # Exactly the 4 rows must be delivered in total -- not doubled
            # (both runs racing on the same stale watermark) and not lost
            # (a regressed watermark stranding a row neither run re-picks-up
            # within this test).
            assert result_a["shipped_entries"] + result_b["shipped_entries"] == 4

            delivered_ids = set()
            for captured in (captured_a, captured_b):
                for request in captured:
                    for line in request.content.decode().strip().splitlines():
                        delivered_ids.add(json.loads(line)["id"])
            assert delivered_ids == {row.id for row in rows}

            async with database_manager.session_factory() as verify:
                assert await _watermark(verify) == last_id
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await session_a.close()
            await session_b.close()
            # Real commits above (a locking read needs a real transaction,
            # which the auto-rollback db_session fixture can't provide), so
            # this test must clean up after itself rather than leak the
            # singleton watermark row and these log rows into every test
            # that runs after it in this session.
            async with database_manager.session_factory() as cleanup:
                await cleanup.execute(delete(AuditShipState))
                await cleanup.execute(
                    delete(AuditLog).where(AuditLog.id.in_([row.id for row in rows]))
                )
                await cleanup.commit()
