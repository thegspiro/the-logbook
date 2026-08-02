"""Tests for off-host audit-log shipping (watermark + HMAC-signed NDJSON)."""

import hashlib
import hmac
import json
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.core.audit import _get_audit_signing_key, audit_logger
from app.core.config import settings
from app.models.audit import AuditShipState
from app.services.audit_ship_service import ship_new_audit_logs

pytestmark = pytest.mark.integration

_URL = "https://collector.example/ingest"


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
