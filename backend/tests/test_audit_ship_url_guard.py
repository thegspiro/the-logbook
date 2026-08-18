"""Unit tests for audit-shipping URL guarding (PR #1425 review fixes).

Two behaviors, no database required:

- ``assert_outbound_url_safe(..., allow_private=True)`` skips ONLY the
  private-resolution (blocking DNS) check; structural checks — HTTPS scheme,
  hostname presence, cloud-metadata blocklist — still apply.
- ``ship_new_audit_logs`` validates the collector URL exactly once per run
  (not once per batch), off the event loop via ``asyncio.to_thread``, and
  threads ``AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION`` into the guard.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import app.services.audit_ship_service as audit_ship_module
from app.core.config import settings
from app.services.audit_ship_service import ship_new_audit_logs
from app.utils.url_validator import assert_outbound_url_safe

pytestmark = pytest.mark.unit

_URL = "https://collector.example/ingest"


class TestAllowPrivateGuard:
    @staticmethod
    def _dns(*ips):
        return [(2, 1, 6, "", (ip, 0)) for ip in ips]

    def test_default_rejects_private_resolution(self):
        with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = self._dns("10.0.0.5")
            with pytest.raises(ValueError, match="private/internal IP"):
                assert_outbound_url_safe("https://siem.corp.example/ingest")

    def test_allow_private_accepts_private_destination_without_dns(self):
        with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = self._dns("10.0.0.5")
            assert_outbound_url_safe(
                "https://siem.corp.example/ingest", allow_private=True
            )
            # The private-resolution check is skipped entirely, so the
            # blocking DNS lookup never happens either.
            mock_dns.assert_not_called()

    def test_allow_private_still_rejects_http_outside_dev(self):
        with patch("app.utils.url_validator.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "production"
            with pytest.raises(ValueError, match="HTTPS"):
                assert_outbound_url_safe(
                    "http://siem.corp.example/ingest", allow_private=True
                )

    def test_allow_private_still_rejects_missing_hostname(self):
        with pytest.raises(ValueError, match="hostname"):
            assert_outbound_url_safe("https:///ingest", allow_private=True)

    @pytest.mark.parametrize(
        "host",
        [
            "metadata.google.internal",
            "metadata.goog",
            "169.254.169.254",
            "[fd00:ec2::254]",
        ],
    )
    def test_allow_private_still_blocks_metadata_endpoints(self, host):
        with pytest.raises(ValueError, match="not allowed"):
            assert_outbound_url_safe(
                f"https://{host}/latest/meta-data/", allow_private=True
            )


def _batch_result(rows):
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    return result


def _fake_db(state, batches):
    """AsyncSession stand-in: first execute() returns the ship state, then
    each subsequent call returns the next batch of rows."""
    state_result = MagicMock()
    state_result.scalar_one_or_none.return_value = state
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[state_result] + [_batch_result(rows) for rows in batches]
    )
    db.commit = AsyncMock()
    return db


def _collector(status_code: int = 200):
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(status_code)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), captured


@pytest.fixture
def _shipping_env(monkeypatch):
    """Isolate the ship loop from settings, signing, and row serialization."""
    monkeypatch.setattr(settings, "AUDIT_SHIP_WEBHOOK_URL", _URL)
    monkeypatch.setattr(settings, "AUDIT_SHIP_BATCH_SIZE", 1)
    monkeypatch.setattr(settings, "AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION", False)
    monkeypatch.setattr(
        audit_ship_module, "_get_audit_signing_key", lambda: "unit-test-key"
    )
    monkeypatch.setattr(
        audit_ship_module.audit_logger, "serialize_row", lambda row: {"id": row.id}
    )


class TestShipValidatesOncePerRunOffLoop:
    @pytest.mark.usefixtures("_shipping_env")
    async def test_validates_once_via_to_thread_across_batches(self, monkeypatch):
        guard = MagicMock()
        monkeypatch.setattr(audit_ship_module, "assert_outbound_url_safe", guard)
        to_thread_funcs = []

        async def fake_to_thread(func, /, *args, **kwargs):
            to_thread_funcs.append(func)
            return func(*args, **kwargs)

        monkeypatch.setattr(audit_ship_module.asyncio, "to_thread", fake_to_thread)

        state = SimpleNamespace(last_shipped_id=0, last_shipped_at=None)
        rows = [SimpleNamespace(id=1), SimpleNamespace(id=2)]
        db = _fake_db(state, [[rows[0]], [rows[1]], []])
        client, captured = _collector()

        result = await ship_new_audit_logs(db, client=client)

        assert result["error"] is None
        assert result["batches"] == 2
        assert result["shipped_entries"] == 2
        assert len(captured) == 2
        # One validation for the whole run — not one per batch — and it went
        # through asyncio.to_thread so the blocking DNS stays off the loop.
        guard.assert_called_once_with(_URL, allow_private=False)
        assert to_thread_funcs == [guard]
        assert state.last_shipped_id == 2
        assert db.commit.await_count == 2

    @pytest.mark.usefixtures("_shipping_env")
    async def test_operator_opt_in_threads_allow_private_into_guard(self, monkeypatch):
        monkeypatch.setattr(settings, "AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION", True)
        guard = MagicMock()
        monkeypatch.setattr(audit_ship_module, "assert_outbound_url_safe", guard)

        state = SimpleNamespace(last_shipped_id=0, last_shipped_at=None)
        db = _fake_db(state, [[SimpleNamespace(id=1)], []])
        client, captured = _collector()

        result = await ship_new_audit_logs(db, client=client)

        assert result["error"] is None
        assert result["shipped_entries"] == 1
        guard.assert_called_once_with(_URL, allow_private=True)
        assert len(captured) == 1

    @pytest.mark.usefixtures("_shipping_env")
    async def test_guard_failure_blocks_run_before_any_delivery(self, monkeypatch):
        guard = MagicMock(side_effect=ValueError("private/internal IP address"))
        monkeypatch.setattr(audit_ship_module, "assert_outbound_url_safe", guard)

        state = SimpleNamespace(last_shipped_id=0, last_shipped_at=None)
        db = _fake_db(state, [[SimpleNamespace(id=1)], []])
        client, captured = _collector()

        result = await ship_new_audit_logs(db, client=client)

        assert result["shipped_entries"] == 0
        assert result["error"] == "unsafe collector URL: private/internal IP address"
        guard.assert_called_once_with(_URL, allow_private=False)
        assert captured == []
        assert state.last_shipped_id == 0
        db.commit.assert_not_awaited()
