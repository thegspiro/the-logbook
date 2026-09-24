"""The not-seen report endpoints: the gate, the CSV, and that the NFC switch
does not apply. The report's computation is in ``test_inventory_nfc_audit.py``,
against the database."""

import csv
import io
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.inventory_last_seen import router
from app.core.database import get_db
from app.models.inventory import ItemStatus

pytestmark = pytest.mark.unit

MODULE = "app.api.v1.endpoints.inventory_last_seen"


def _user(permissions=("*",)):
    return SimpleNamespace(
        id="admin-1",
        organization_id="org-1",
        username="qm",
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _app_for(current_user):
    app = FastAPI()
    app.include_router(router, prefix="/inventory")
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: current_user
    return app


async def _get(app, path: str):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.get(path)


def _report(rows):
    return {
        "cutoff": datetime(2026, 3, 28, tzinfo=timezone.utc),
        "total": len(rows),
        "items": rows,
    }


def _row(**overrides):
    row = {
        "id": "i-1",
        "name": "Helmet",
        "serial_number": "SN-1",
        "asset_tag": None,
        "category_name": "PPE",
        "status": ItemStatus.AVAILABLE,
        "storage_area_name": "Shelf A",
        "last_seen_at": datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc),
        "last_seen_source": "return",
        "days_since_seen": 265,
    }
    row.update(overrides)
    return row


def _service(report):
    service = MagicMock()
    service.not_seen = AsyncMock(return_value=report)
    return patch(f"{MODULE}.InventoryLastSeenService", return_value=service), service


class TestGate:
    @pytest.mark.parametrize(
        "path", ["/inventory/not-seen", "/inventory/not-seen/export"]
    )
    async def test_a_viewer_is_refused(self, path):
        response = await _get(_app_for(_user(("inventory.view",))), path)
        assert response.status_code == 403

    async def test_not_gated_by_the_nfc_switch(self):
        """Custody events alone make the report useful; it must answer for an
        organization that has never switched tags on."""
        patcher, _ = _service(_report([]))
        with patcher:
            response = await _get(_app_for(_user()), "/inventory/not-seen")
        assert response.status_code == 200

    @pytest.mark.parametrize("days", [0, 3651])
    async def test_days_is_bounded(self, days):
        response = await _get(_app_for(_user()), f"/inventory/not-seen?days={days}")
        assert response.status_code == 422


class TestReport:
    async def test_passes_the_filters_through(self):
        patcher, service = _service(_report([_row()]))
        with patcher:
            response = await _get(
                _app_for(_user()), "/inventory/not-seen?days=90&category_id=c-1"
            )
        assert response.status_code == 200
        body = response.json()
        assert body["items"][0]["last_seen_source"] == "return"
        assert service.not_seen.await_args.kwargs["days"] == 90
        assert service.not_seen.await_args.kwargs["category_id"] == "c-1"


class TestCsv:
    async def test_writes_every_row_and_neutralizes_formulas(self):
        rows = [
            _row(),
            _row(
                id="i-2",
                name="=HYPERLINK(1)",
                last_seen_at=None,
                last_seen_source=None,
                days_since_seen=None,
            ),
        ]
        patcher, service = _service(_report(rows))
        with patcher, patch(f"{MODULE}.log_audit_event", AsyncMock()) as audit:
            response = await _get(
                _app_for(_user()), "/inventory/not-seen/export?days=30"
            )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert "inventory_not_seen_30d.csv" in response.headers["content-disposition"]
        parsed = list(csv.reader(io.StringIO(response.text)))
        assert parsed[0][0] == "Name"
        assert parsed[1][6:] == ["2026-01-02 03:04", "Returned", "265"]
        assert parsed[2][0] == "'=HYPERLINK(1)"
        assert parsed[2][6:] == ["Never", "", ""]
        assert audit.await_args.kwargs["event_type"] == "inventory_not_seen_exported"
        assert service.not_seen.await_args.kwargs["limit"] == 5000
