"""The item-history timeline's date for each event row (``_first_iso``)."""

from datetime import date, datetime, timezone

import pytest

from app.services.inventory_service import _first_iso

pytestmark = [pytest.mark.unit]

CREATED = datetime(2026, 3, 1, 12, 30, tzinfo=timezone.utc)


def test_the_event_date_wins_over_created_at():
    assert _first_iso(date(2026, 2, 14), CREATED) == "2026-02-14"


def test_created_at_is_the_fallback():
    assert _first_iso(None, CREATED) == CREATED.isoformat()


def test_maintenance_prefers_completed_then_scheduled():
    assert _first_iso(date(2026, 2, 1), date(2026, 1, 1), CREATED) == "2026-02-01"
    assert _first_iso(None, date(2026, 1, 1), CREATED) == "2026-01-01"


def test_a_row_with_no_timestamp_at_all_is_refused():
    with pytest.raises(ValueError, match="no timestamp"):
        _first_iso(None, None)
