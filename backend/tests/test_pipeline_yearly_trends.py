"""Calendar-year semantics for the membership pipeline report."""

from app.services.reports_service import _include_empty_calendar_years


def test_missing_calendar_year_is_emitted_as_an_empty_cohort():
    yearly = {
        2024: {"year": 2024, "applicants": 5},
        2026: {"year": 2026, "applicants": 7},
    }

    _include_empty_calendar_years(yearly)

    assert sorted(yearly) == [2024, 2025, 2026]
    assert yearly[2025] == {
        "year": 2025,
        "applicants": 0,
        "converted": 0,
        "rejected": 0,
        "withdrawn": 0,
        "conversion_days": [],
    }


def test_empty_report_stays_empty():
    yearly = {}

    _include_empty_calendar_years(yearly)

    assert yearly == {}
