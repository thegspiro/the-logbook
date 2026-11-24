"""The Reports page's export tables, built on the server, carry the columns
and values the page's browser-built exports did."""

import inspect

import pytest

from app.services import reports_service
from app.services.report_tables import (
    build_export_table,
    csv_value,
    display_value,
    export_spec,
    is_numeric_column,
    leave_periods_text,
)

pytestmark = pytest.mark.unit


def _headers(table):
    return [c.header for c in table.columns]


def test_the_contract_covers_exactly_the_reports_the_service_generates():
    source = inspect.getsource(reports_service.ReportsService.generate_report)
    generated = set(
        name for name in export_spec() if f'"{name}": self._generate_{name}' in source
    )
    assert generated == set(export_spec())
    assert len(export_spec()) == 14


def test_a_plain_report_takes_its_rows_and_columns_from_the_contract():
    table = build_export_table(
        "member_roster",
        {
            "total_members": 2,
            "active_members": 1,
            "inactive_members": 1,
            "members": [
                {
                    "first_name": "Pat",
                    "last_name": "O'Brien",
                    "email": "pat@example.org",
                    "rank": "Captain",
                    "status": "active",
                    "station": "1",
                    "membership_number": "M-1",
                    "roles": ["Officer", "EMT"],
                    "joined_date": "2020-01-02",
                }
            ],
        },
    )
    assert table.title == "Member Roster"
    assert _headers(table) == [
        "First Name",
        "Last Name",
        "Email",
        "Rank",
        "Status",
        "Station",
        "Member #",
        "Roles",
        "Joined",
    ]
    assert table.rows[0]["last_name"] == "O'Brien"
    assert table.kpis == [("Total Members", "2"), ("Active", "1"), ("Inactive", "1")]
    assert table.contains_member_data is True


def test_rows_that_are_not_a_list_export_as_an_empty_table():
    table = build_export_table("event_attendance", {"events": None})
    assert table.rows == []
    assert table.contains_member_data is False


def test_annual_training_spells_leave_as_the_page_does():
    table = build_export_table(
        "annual_training",
        {
            "summary": {
                "total_completions": 4,
                "total_calls_responded": 9,
                "avg_hours_per_member": 12.5,
            },
            "entries": [
                {
                    "member_name": "Pat",
                    "leave_months": None,
                    "leave_periods": [
                        {
                            "start_date": "2025-07-01",
                            "end_date": "2026-09-01",
                            "excuses_training": True,
                        },
                        {
                            "start_date": "2026-10-01",
                            "end_date": None,
                            "excuses_training": False,
                        },
                    ],
                }
            ],
        },
    )
    row = table.rows[0]
    assert row["leave_months"] == 0
    assert row["leave_periods_text"] == (
        "Jul 1, 2025 – Sep 1, 2026; "
        "Oct 1, 2026 – no end date (requirements stayed in force)"
    )
    assert ("Avg Hours/Member", "12.5") in table.kpis


def test_compliance_says_whether_a_member_is_on_leave_now():
    table = build_export_table(
        "compliance_status",
        {
            "total_members": 1,
            "entries": [{"member_name": "Pat", "on_leave": True}],
        },
    )
    assert table.rows[0]["on_leave_text"] == "Yes"
    assert table.rows[0]["leave_periods_text"] == ""
    assert table.title == "Program Requirement Progress"


def test_department_overview_is_a_metric_table():
    table = build_export_table(
        "department_overview",
        {
            "members": {"total": 10, "active": 8, "inactive": 2},
            "training": {
                "total_records": 5,
                "completed": 4,
                "completion_rate": 80,
                "total_hours": 12.5,
                "avg_hours_per_member": 1.25,
            },
            "events": {"total_events": 3, "total_checkins": 20},
            "action_items": {"open_from_meetings": 1, "open_from_minutes": 2},
        },
    )
    assert _headers(table) == ["Metric", "Value"]
    assert {"metric": "Training Completion Rate", "value": "80%"} in table.rows
    assert len(table.rows) == 12
    assert table.kpis == []


def test_call_volume_adds_a_labelled_column_per_call_type():
    table = build_export_table(
        "call_volume",
        {
            "counts_member_reports": True,
            "call_type_labels": {"ems": "EMS", "fire_alarm": "Fire Alarm"},
            "summary": {
                "total_calls": 5,
                "avg_calls_per_day": 2.5,
                "busiest_day": "2026-11-02",
                "busiest_day_count": 3,
            },
            "entries": [
                {"date": "2026-11-01", "total_calls": 2, "by_type": {"ems": 2}},
                {
                    "date": "2026-11-02",
                    "total_calls": 3,
                    "by_type": {"fire_alarm": 1, "mva_extrication": 2},
                },
            ],
        },
    )
    assert _headers(table) == [
        "Date",
        "Member-Reported Calls",
        "EMS",
        "Fire Alarm",
        "mva extrication",
    ]
    assert table.rows[0] == {
        "date": "2026-11-01",
        "total_calls": 2,
        "type_ems": 2,
        "type_fire_alarm": 0,
        "type_mva_extrication": 0,
    }
    assert table.kpis == [
        ("Member-Reported Calls", "5"),
        ("Avg Member-Reported/Day", "2.5"),
        ("Busiest Day", "Nov 2, 2026"),
        ("Peak Member-Reported", "3"),
    ]


def test_a_saved_report_exports_under_its_own_name():
    table = build_export_table("event_attendance", {"events": []}, title="Q3 Drills")
    assert table.title == "Q3 Drills"


def test_an_unknown_type_or_an_error_result_is_refused():
    with pytest.raises(ValueError, match="Unknown report type"):
        build_export_table("payroll", {})
    with pytest.raises(ValueError, match="no such pipeline"):
        build_export_table("pipeline_overview", {"error": "no such pipeline"})


@pytest.mark.parametrize(
    ("value", "csv", "shown"),
    [
        (None, "", "—"),
        (True, "true", "Yes"),
        (False, "false", "No"),
        (3, "3", "3"),
        (3.0, "3", "3"),
        (2.5, "2.5", "2.5"),
        (["Officer", "EMT"], "Officer; EMT", "Officer; EMT"),
        ("O'Brien & Sons", "O'Brien & Sons", "O'Brien & Sons"),
    ],
)
def test_cell_values_match_the_page_export(value, csv, shown):
    assert csv_value(value) == csv
    assert display_value(value) == shown


def test_numeric_columns_are_detected_for_alignment():
    rows = [{"a": 1, "b": "x", "c": True}, {"a": 2.5, "b": 3, "c": None}]
    assert is_numeric_column(rows, "a") is True
    assert is_numeric_column(rows, "b") is False
    assert is_numeric_column(rows, "c") is False
    assert is_numeric_column([], "a") is False


def test_a_malformed_leave_date_reads_not_available():
    assert (
        leave_periods_text(
            [{"start_date": "bad", "end_date": None, "excuses_training": True}]
        )
        == "N/A – no end date"
    )
