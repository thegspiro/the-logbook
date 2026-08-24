"""
The admin-hours summary serializes its category breakdown like everything else.

`AdminHoursSummary.by_category` was `list[dict]`. The alias generator that gives
this module its camelCase responses only rewrites *declared* fields, so the
untyped list passed the service's snake_case keys straight through: the
summary's own totals arrived as `totalHours` while the rows beneath them arrived
as `total_hours`.

The Summary tab reads `categoryName`, `totalHours`, `entryCount` and
`totalMinutes` off each row, so every one was undefined — six nameless bars
reading "hrs · entries · 0%" under a heading promising a ranking, with the
cards above them correct. Nobody reports that as a bug; the page looks like it
merely has no data.
"""

import pytest

from app.schemas.admin_hours import AdminHoursSummary

pytestmark = [pytest.mark.unit]


# Exactly what AdminHoursService.get_summary builds, keys included.
SERVICE_PAYLOAD = {
    "total_hours": 39.0,
    "total_entries": 12,
    "approved_hours": 29.5,
    "approved_entries": 9,
    "pending_hours": 9.5,
    "pending_entries": 3,
    "by_category": [
        {
            "category_id": "cat-1",
            "category_name": "Fundraising",
            "category_color": "#F59E0B",
            "total_minutes": 360,
            "total_hours": 6.0,
            "entry_count": 2,
        },
        {
            "category_id": "cat-2",
            "category_name": "Administrative Work",
            "category_color": None,
            "total_minutes": 510,
            "total_hours": 8.5,
            "entry_count": 2,
        },
    ],
    "period_start": None,
    "period_end": None,
}

# The keys SummaryTab.tsx reads off each row.
ROW_KEYS = {
    "categoryId",
    "categoryName",
    "categoryColor",
    "totalMinutes",
    "totalHours",
    "entryCount",
}


class TestSummaryShape:
    def test_the_service_payload_validates(self):
        summary = AdminHoursSummary.model_validate(SERVICE_PAYLOAD)

        assert len(summary.by_category) == 2

    def test_rows_serialize_camelcase_like_the_totals_above_them(self):
        summary = AdminHoursSummary.model_validate(SERVICE_PAYLOAD)

        body = summary.model_dump(by_alias=True)

        assert "totalHours" in body
        # The outer key aliases either way -- it is a declared field. What the
        # untyped list broke is one level down.
        for row in body["byCategory"]:
            assert ROW_KEYS <= set(row), f"missing {ROW_KEYS - set(row)}"
            assert not any("_" in key for key in row), row

    def test_a_missing_colour_stays_null_rather_than_failing(self):
        # `category_color` comes from a nullable column, and a category created
        # before colours existed has none. It must serialize as null, not
        # refuse the whole summary.
        summary = AdminHoursSummary.model_validate(SERVICE_PAYLOAD)

        body = summary.model_dump(by_alias=True)

        assert body["byCategory"][1]["categoryColor"] is None
