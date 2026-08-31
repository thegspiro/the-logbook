"""
RPT-29 addendum, three verified-but-narrow gaps found reviewing feature 29
(Reports & analytics) against Codex feedback on the pass-3 findings doc:

- Saved-report listing (`GET /reports/saved`) has no pagination and returns
  the org's full active set on every load; capping creation is what keeps
  that read bounded.
- `SavedReportCreate`/`SavedReportUpdate` accepted unconstrained `name`,
  `report_type`, and `schedule_frequency` strings even though the model
  stores them in narrower `VARCHAR` columns — an overlong value reached
  `db.commit()` and raised an uncaught `DataError` under MySQL strict mode
  instead of a validation response.
- `/analytics/track` copied `metadata.deviceType` straight into a
  `VARCHAR(20)` column with no type or length check.

DB mocked where needed; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import analytics as analytics_ep
from app.api.v1.endpoints import reports as reports_ep
from app.schemas.reports import SavedReportCreate, SavedReportUpdate


def _manager(user_id="mgr-1", org_id="org-1"):
    return SimpleNamespace(id=user_id, organization_id=org_id)


class TestSavedReportCap:
    @staticmethod
    def _db_at_count(count: int):
        result = MagicMock()
        result.scalar.return_value = count
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        return db

    async def test_rejects_create_at_the_cap(self):
        db = self._db_at_count(reports_ep.MAX_ACTIVE_SAVED_REPORTS_PER_ORG)
        request = SavedReportCreate(name="One more", report_type="call_volume")

        with pytest.raises(HTTPException) as exc:
            await reports_ep.create_saved_report(
                request, db=db, current_user=_manager()
            )

        assert exc.value.status_code == 400
        db.add.assert_not_called()
        db.commit.assert_not_awaited()

    async def test_allows_create_under_the_cap(self):
        db = self._db_at_count(reports_ep.MAX_ACTIVE_SAVED_REPORTS_PER_ORG - 1)
        request = SavedReportCreate(name="Room left", report_type="call_volume")

        result = await reports_ep.create_saved_report(
            request, db=db, current_user=_manager()
        )

        db.add.assert_called_once()
        db.commit.assert_awaited_once()
        assert result.name == "Room left"


class TestSavedReportFieldBounds:
    """Bounds mirror saved_reports' column widths: name VARCHAR(255),
    report_type VARCHAR(50), schedule_frequency VARCHAR(20)."""

    def test_create_rejects_overlong_name(self):
        with pytest.raises(ValidationError):
            SavedReportCreate(name="x" * 256, report_type="call_volume")

    def test_create_rejects_overlong_report_type(self):
        with pytest.raises(ValidationError):
            SavedReportCreate(name="ok", report_type="x" * 51)

    def test_create_rejects_overlong_schedule_frequency(self):
        with pytest.raises(ValidationError):
            SavedReportCreate(
                name="ok", report_type="call_volume", schedule_frequency="x" * 21
            )

    def test_create_accepts_values_at_the_column_width(self):
        report = SavedReportCreate(
            name="x" * 255, report_type="x" * 50, schedule_frequency="x" * 20
        )
        assert len(report.name) == 255
        assert len(report.report_type) == 50
        assert len(report.schedule_frequency) == 20

    def test_update_rejects_overlong_name(self):
        with pytest.raises(ValidationError):
            SavedReportUpdate(name="x" * 256)


class TestAnalyticsDeviceTypeSanitization:
    """The device_type column is VARCHAR(20); metadata is an unconstrained
    client-supplied dict, so the extraction must not pass through a value
    that column can't hold."""

    def test_accepts_a_normal_device_type(self):
        assert (
            analytics_ep._device_type_from_metadata({"deviceType": "mobile"})
            == "mobile"
        )

    def test_drops_an_overlong_device_type(self):
        assert analytics_ep._device_type_from_metadata({"deviceType": "x" * 21}) is None

    def test_drops_a_non_string_device_type(self):
        assert analytics_ep._device_type_from_metadata({"deviceType": 12345}) is None
        assert (
            analytics_ep._device_type_from_metadata({"deviceType": {"nested": True}})
            is None
        )

    def test_handles_missing_metadata(self):
        assert analytics_ep._device_type_from_metadata(None) is None
        assert analytics_ep._device_type_from_metadata({}) is None

    async def test_track_event_stores_sanitized_device_type(self):
        db = MagicMock()
        db.add = MagicMock()
        db.commit = AsyncMock()
        data = analytics_ep.AnalyticsEventCreate(
            event_type="page_view", metadata={"deviceType": "x" * 21}
        )

        await analytics_ep.track_event(data, db=db, current_user=_manager())

        stored_event = db.add.call_args[0][0]
        assert stored_event.device_type is None
