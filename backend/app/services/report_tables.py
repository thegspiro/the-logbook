"""
The Reports page's export tables, built on the server.

Each report type returns its own JSON shape; this flattens one into the table
the page's CSV and PDF exports carry. The columns (keys, headers and order)
come from ``app/data/report_export_columns.json``, which the frontend's
``exportColumnsParity.test.ts`` holds equal to the on-screen renderers'
``get<X>ExportData``, so an export downloaded from the server has the same
columns the browser-built one had.

The headline figures above the PDF's table are the report's own summary
values under the same labels as the page's summary tiles. A tile the page
computes in the browser (admin hours' quarter-rounded total, event
attendance's summed check-ins) is left out rather than recomputed here, so a
printed figure can never disagree with the screen (CLAUDE.md Pitfall #29).
"""

import json
import re
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from app.services.saved_report_schedule import PII_REPORT_PERMISSIONS

_COLUMNS_FILE = (
    Path(__file__).resolve().parent.parent / "data" / "report_export_columns.json"
)


@dataclass(frozen=True)
class ExportColumn:
    key: str
    header: str


@dataclass
class ExportTable:
    report_type: str
    title: str
    columns: List[ExportColumn]
    rows: List[Dict[str, Any]]
    kpis: List[Tuple[str, str]] = field(default_factory=list)

    @property
    def contains_member_data(self) -> bool:
        # The same set that needs a permission beyond reports.view to run.
        return self.report_type in PII_REPORT_PERMISSIONS


@lru_cache(maxsize=1)
def export_spec() -> Dict[str, Dict[str, Any]]:
    """The column contract, keyed by report type."""
    with _COLUMNS_FILE.open(encoding="utf-8") as handle:
        spec = json.load(handle)
    return {key: value for key, value in spec.items() if not key.startswith("_")}


def report_title(report_type: str) -> str:
    spec = export_spec().get(report_type)
    if spec is None:
        raise ValueError(f"Unknown report type '{report_type}'")
    return str(spec["title"])


def _columns(report_type: str) -> List[ExportColumn]:
    return [
        ExportColumn(str(c["key"]), str(c["header"]))
        for c in export_spec()[report_type]["columns"]
    ]


def _records(data: Mapping[str, Any], key: str) -> List[Dict[str, Any]]:
    value = data.get(key)
    if not isinstance(value, list):
        return []
    return [dict(row) for row in value if isinstance(row, dict)]


_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def _calendar_date(value: Optional[str]) -> str:
    """ "Jul 1, 2025", as the page's formatCalendarDate spells a date."""
    match = _ISO_DATE.match(value or "")
    if not match:
        return "N/A"
    try:
        day = date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return "N/A"
    return f"{day:%b} {day.day}, {day.year}"


def leave_periods_text(periods: Any) -> str:
    """Every leave period as one line, as the page's leavePeriodsText does."""
    parts = []
    for period in periods or []:
        if not isinstance(period, dict):
            continue
        end = (
            _calendar_date(period.get("end_date"))
            if period.get("end_date")
            else "no end date"
        )
        span = f"{_calendar_date(period.get('start_date'))} – {end}"
        if not period.get("excuses_training"):
            span += " (requirements stayed in force)"
        parts.append(span)
    return "; ".join(parts)


def _pct(value: Any) -> str:
    return "N/A" if value is None else f"{value}%"


def _get(data: Mapping[str, Any], *path: str, default: Any = 0) -> Any:
    current: Any = data
    for key in path:
        if not isinstance(current, Mapping):
            return default
        current = current.get(key)
    return default if current is None else current


# ── Per-type row shaping, mirroring the renderers' get<X>ExportData ──────


def _annual_training_rows(data: Mapping[str, Any]) -> List[Dict[str, Any]]:
    rows = _records(data, "entries")
    for row in rows:
        row["leave_months"] = row.get("leave_months") or 0
        row["leave_periods_text"] = leave_periods_text(row.get("leave_periods"))
    return rows


def _compliance_status_rows(data: Mapping[str, Any]) -> List[Dict[str, Any]]:
    rows = _records(data, "entries")
    for row in rows:
        row["on_leave_text"] = "Yes" if row.get("on_leave") else "No"
        row["leave_periods_text"] = leave_periods_text(row.get("leave_periods"))
    return rows


def _department_overview_rows(data: Mapping[str, Any]) -> List[Dict[str, Any]]:
    return [
        {"metric": "Total Members", "value": _get(data, "members", "total")},
        {"metric": "Active Members", "value": _get(data, "members", "active")},
        {"metric": "Inactive Members", "value": _get(data, "members", "inactive")},
        {
            "metric": "Training Records",
            "value": _get(data, "training", "total_records"),
        },
        {"metric": "Training Completed", "value": _get(data, "training", "completed")},
        {
            "metric": "Training Completion Rate",
            "value": f"{_get(data, 'training', 'completion_rate')}%",
        },
        {
            "metric": "Total Training Hours",
            "value": _get(data, "training", "total_hours"),
        },
        {
            "metric": "Avg Hours/Member",
            "value": _get(data, "training", "avg_hours_per_member"),
        },
        {"metric": "Total Events", "value": _get(data, "events", "total_events")},
        {"metric": "Total Check-ins", "value": _get(data, "events", "total_checkins")},
        {
            "metric": "Open Action Items (Meetings)",
            "value": _get(data, "action_items", "open_from_meetings"),
        },
        {
            "metric": "Open Action Items (Minutes)",
            "value": _get(data, "action_items", "open_from_minutes"),
        },
    ]


def call_volume_labels(data: Mapping[str, Any]) -> Dict[str, str]:
    """The page's callVolumeLabels: never call unit responses "calls"."""
    if data.get("counts_unit_responses") is True:
        return {
            "total": "Unit Responses",
            "perDay": "Avg Responses/Day",
            "peak": "Peak Responses",
        }
    if data.get("counts_member_reports") is True:
        return {
            "total": "Member-Reported Calls",
            "perDay": "Avg Member-Reported/Day",
            "peak": "Peak Member-Reported",
        }
    return {"total": "Total Calls", "perDay": "Avg Calls/Day", "peak": "Peak Calls"}


def _call_volume_table(
    data: Mapping[str, Any],
) -> Tuple[List[ExportColumn], List[Dict[str, Any]]]:
    entries = _records(data, "entries")
    # Types in order of first appearance, as the page's Set iteration gives.
    types: Dict[str, None] = {}
    for entry in entries:
        by_type = entry.get("by_type")
        if isinstance(by_type, dict):
            for slug in by_type:
                types.setdefault(str(slug), None)
    raw_labels = data.get("call_type_labels")
    labels: Mapping[str, Any] = raw_labels if isinstance(raw_labels, dict) else {}
    columns = [
        ExportColumn("date", "Date"),
        ExportColumn("total_calls", call_volume_labels(data)["total"]),
        *[
            ExportColumn(
                f"type_{slug}", str(labels.get(slug) or slug.replace("_", " "))
            )
            for slug in types
        ],
    ]
    rows = []
    for entry in entries:
        raw_counts = entry.get("by_type")
        counts: Mapping[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
        row: Dict[str, Any] = {
            "date": entry.get("date"),
            "total_calls": entry.get("total_calls"),
        }
        for slug in types:
            row[f"type_{slug}"] = counts.get(slug, 0)
        rows.append(row)
    return columns, rows


# ── Headline figures, under the page's own tile labels ───────────────────


def _kpis(report_type: str, data: Mapping[str, Any]) -> List[Tuple[str, str]]:
    def v(*path: str) -> str:
        return str(_get(data, *path))

    if report_type == "member_roster":
        return [
            ("Total Members", v("total_members")),
            ("Active", v("active_members")),
            ("Inactive", v("inactive_members")),
        ]
    if report_type == "training_summary":
        return [
            ("Total Courses", v("total_courses")),
            ("Training Records", v("total_records")),
            ("Completion Rate", _pct(data.get("completion_rate"))),
        ]
    if report_type == "event_attendance":
        return [
            ("Total Events", v("total_events")),
            ("Avg Attendance Rate", _pct(data.get("average_attendance_rate"))),
        ]
    if report_type == "training_progress":
        return [
            ("Total Enrollments", v("total_enrollments")),
            ("Avg Progress", _pct(data.get("average_progress"))),
            ("Active", v("status_summary", "active")),
            ("Completed", v("status_summary", "completed")),
        ]
    if report_type == "annual_training":
        return [
            ("Completions", v("summary", "total_completions")),
            ("Calls Responded", v("summary", "total_calls_responded")),
            ("Avg Hours/Member", v("summary", "avg_hours_per_member")),
        ]
    if report_type == "admin_hours":
        return [
            ("Entries", v("summary", "total_entries")),
            ("Members", v("summary", "unique_members")),
        ]
    if report_type == "position_hours":
        return [
            ("Total Hours", v("summary", "total_hours")),
            ("Shifts", v("summary", "total_shifts")),
            ("Calls", v("summary", "total_calls")),
            ("Members", v("summary", "members")),
        ]
    if report_type == "certification_expiration":
        return [
            ("Total Certifications", v("total_certifications")),
            ("Expired", v("expired_count")),
            ("Expiring Soon", v("expiring_soon_count")),
            ("Valid", v("valid_count")),
        ]
    if report_type == "compliance_status":
        return [
            ("Total Members", v("total_members")),
            ("All Requirements Met", v("fully_compliant_count")),
            ("Some Met", v("partially_compliant_count")),
            ("None Met", v("non_compliant_count")),
        ]
    if report_type == "apparatus_status":
        return [
            ("Total Apparatus", v("total_apparatus")),
            ("In Service", v("in_service_count")),
            ("Out of Service", v("out_of_service_count")),
            ("Maintenance Due", v("maintenance_due_count")),
        ]
    if report_type == "inventory_status":
        figures = [
            ("Total Items", v("total_items")),
            ("Low Stock", v("low_stock_count")),
            ("Assigned", v("assigned_count")),
        ]
        if data.get("total_value") is not None:
            figures.append(("Total Value", f"${float(data['total_value']):,.2f}"))
        return figures
    if report_type == "call_volume":
        labels = call_volume_labels(data)
        busiest = _get(data, "summary", "busiest_day", default="")
        return [
            (labels["total"], v("summary", "total_calls")),
            (
                labels["perDay"],
                f"{float(_get(data, 'summary', 'avg_calls_per_day')):.1f}",
            ),
            ("Busiest Day", _calendar_date(busiest) if busiest else "-"),
            (labels["peak"], v("summary", "busiest_day_count")),
        ]
    if report_type == "pipeline_overview":
        return [
            ("Total Applicants", v("total_applicants")),
            ("Active", v("active_applicants")),
            ("Converted", v("converted_count")),
            ("Decision Conversion", _pct(data.get("conversion_rate"))),
        ]
    # department_overview: the table itself is the headline figures.
    return []


_ROW_BUILDERS: Dict[str, Callable[[Mapping[str, Any]], List[Dict[str, Any]]]] = {
    "annual_training": _annual_training_rows,
    "compliance_status": _compliance_status_rows,
    "department_overview": _department_overview_rows,
}


def build_export_table(
    report_type: str, data: Mapping[str, Any], title: Optional[str] = None
) -> ExportTable:
    """Flatten a generated report into its export table.

    *title* overrides the report type's title, for a saved report exported
    under its own name. Raises ``ValueError`` for an unknown type or a result
    carrying an ``error``.
    """
    spec = export_spec().get(report_type)
    if spec is None:
        raise ValueError(f"Unknown report type '{report_type}'")
    if "error" in data:
        raise ValueError(str(data["error"]))

    if report_type == "call_volume":
        columns, rows = _call_volume_table(data)
    else:
        columns = _columns(report_type)
        builder = _ROW_BUILDERS.get(report_type)
        rows = builder(data) if builder else _records(data, str(spec["rows"]))

    return ExportTable(
        report_type=report_type,
        title=title or str(spec["title"]),
        columns=columns,
        rows=rows,
        kpis=_kpis(report_type, data),
    )


def csv_value(value: Any) -> str:
    """A cell as the page's browser export wrote it (toCsvValue), before the
    CSV writer's formula neutralisation: blank for none, ``true``/``false``,
    whole numbers without a trailing ``.0``, lists joined by ``; ``."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (int, float, str)):
        return str(value)
    if isinstance(value, (list, tuple)):
        return "; ".join(csv_value(item) for item in value)
    return json.dumps(value, separators=(",", ":"), default=str)


def display_value(value: Any) -> str:
    """A cell as the PDF prints it: like the CSV, but booleans read Yes/No and
    an empty cell shows a dash, since a printed blank looks like a mistake."""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    text = csv_value(value)
    return text if text else "—"


def is_numeric_column(rows: Sequence[Mapping[str, Any]], key: str) -> bool:
    """True when every present value is a number, so the PDF right-aligns it."""
    seen = False
    for row in rows:
        value = row.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        seen = True
    return seen
