"""
Equipment Check PDF Report Generator

Produces downloadable PDF reports on the shared report layout
(:mod:`app.utils.pdf_report_kit`):

- Compliance summary (per-apparatus and per-member stats)
- Deficiency / failure log
- Individual check report (compartment by compartment)

Every value goes through ``cell``/``num``, which escape and wrap: notes and
item names print in full rather than being cut at a character count, and a
``<`` or ``&`` a member typed can neither break the build nor inject markup.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Spacer

from app.models.user import Organization
from app.utils.check_types import describe_count, describe_status
from app.utils.org_timezone import format_in_org_timezone
from app.utils.pdf_report_kit import (
    ReportMeta,
    bookmark,
    cell,
    data_table,
    kpi_strip,
    num,
    render_report,
    section_heading,
)


def _now_str(organization: Optional[Organization]) -> str:
    return format_in_org_timezone(
        datetime.now(timezone.utc), organization, "%Y-%m-%d %H:%M %Z"
    )


def _local(value: Any, organization: Optional[Organization], fmt: str) -> str:
    """A check timestamp as the department's wall-clock time.

    The report services hand back datetimes and the check-detail endpoint an
    ISO string; both are UTC. A calendar ``date`` has no zone to convert.
    """
    if not value:
        return ""
    if isinstance(value, str):
        text = value
        try:
            value = datetime.fromisoformat(text)
        except ValueError:
            return text
    if isinstance(value, datetime):
        return format_in_org_timezone(value, organization, fmt)
    return str(value)


def _period(date_from: Optional[str], date_to: Optional[str]) -> str:
    if date_from and date_to:
        return f"{date_from} to {date_to}"
    if date_from:
        return f"From {date_from}"
    if date_to:
        return f"Through {date_to}"
    return "Last 30 days"


def _meta(
    title: str,
    organization: Optional[Organization],
    generated_by: Optional[str],
    parameters: List[Any],
    subtitle: Optional[str] = None,
) -> ReportMeta:
    return ReportMeta(
        title,
        getattr(organization, "name", None),
        _now_str(organization),
        logo=getattr(organization, "logo", None),
        generated_by=generated_by,
        parameters=parameters,
        subtitle=subtitle,
        subject="Equipment check report",
    )


def generate_compliance_pdf(
    data: Dict[str, Any],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    organization: Optional[Organization] = None,
    generated_by: Optional[str] = None,
) -> bytes:
    """Generate a compliance summary PDF."""
    meta = _meta(
        "Equipment Check Compliance Report",
        organization,
        generated_by,
        [("Period", _period(date_from, date_to))],
    )
    width = meta.width

    def body(styles: Dict[str, Any]) -> List[Any]:
        story: List[Any] = [
            kpi_strip(
                [
                    ("Total checks", data.get("total_checks", 0)),
                    ("Missed", data.get("overdue_count", 0)),
                    ("Pass rate", f"{data.get('pass_rate', 0)}%"),
                    ("Avg items / check", data.get("avg_items_per_check", 0)),
                ],
                width,
            ),
            Spacer(1, 14),
        ]

        apparatus_list = data.get("apparatus", [])
        if apparatus_list:
            # Apparatus with a deficiency first: they are what the reader
            # needs to act on.
            ordered = sorted(apparatus_list, key=lambda a: not a.get("has_deficiency"))
            rows = []
            emphasis = []
            for index, a in enumerate(ordered):
                last = _local(a.get("last_check_date"), organization, "%Y-%m-%d")
                if a.get("has_deficiency"):
                    emphasis.append(index)
                rows.append(
                    [
                        cell(a.get("apparatus_name", "")),
                        num(a.get("checks_expected", 0)),
                        num(a.get("checks_completed", 0)),
                        num(a.get("checks_missed", 0)),
                        num(a.get("pass_count", 0)),
                        num(a.get("fail_count", 0)),
                        cell(last or "-"),
                        cell(
                            "Yes" if a.get("has_deficiency") else "No",
                            styles["cell_bold"] if a.get("has_deficiency") else None,
                        ),
                    ]
                )
            fixed = 0.75 * inch * 5 + 1.0 * inch + 0.9 * inch
            story += [
                bookmark("Apparatus compliance", "apparatus"),
                section_heading("Apparatus Compliance", styles),
                data_table(
                    [
                        "Apparatus",
                        "Expected",
                        "Checks",
                        "Missed",
                        "Pass",
                        "Fail",
                        "Last check",
                        "Deficiency",
                    ],
                    rows,
                    [width - fixed] + [0.75 * inch] * 5 + [1.0 * inch, 0.9 * inch],
                    numeric_cols=(1, 2, 3, 4, 5),
                    emphasis_rows=emphasis,
                ),
                Spacer(1, 14),
            ]

        members = data.get("members", [])
        if members:
            rows = []
            for m in members:
                done = m.get("checks_completed", 0)
                passed = m.get("pass_count", 0)
                rows.append(
                    [
                        cell(m.get("user_name", "")),
                        num(done),
                        num(passed),
                        num(m.get("fail_count", 0)),
                        num(f"{round(passed / done * 100)}%" if done > 0 else "-"),
                    ]
                )
            story += [
                bookmark("Member completion", "members"),
                section_heading("Member Completion", styles),
                data_table(
                    ["Member", "Checks", "Pass", "Fail", "Rate"],
                    rows,
                    [width - 4 * 0.9 * inch] + [0.9 * inch] * 4,
                    numeric_cols=(1, 2, 3, 4),
                    zebra=True,
                ),
            ]
        return story

    return render_report(meta, body)


def _item_with_count(record: Dict[str, Any]) -> str:
    """The item name, followed by its count when the failure was a count."""
    name = str(record.get("item_name", ""))
    count = describe_count(
        record.get("quantity_found"),
        record.get("target_quantity"),
        record.get("count_unit"),
    )
    if count:
        return f"{name} ({count})"
    # A presence line failed because the thing is missing; say so, the way a
    # count says how many were short.
    if describe_status(record.get("check_type"), record.get("status")) == "absent":
        return f"{name} (absent)"
    return name


def generate_failure_log_pdf(
    data: Dict[str, Any],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    organization: Optional[Organization] = None,
    generated_by: Optional[str] = None,
) -> bytes:
    """Generate a failure/deficiency log PDF."""
    meta = _meta(
        "Equipment Check Failure Log",
        organization,
        generated_by,
        [
            ("Period", _period(date_from, date_to)),
            ("Total failures", data.get("total", 0)),
        ],
    )
    width = meta.width

    def body(styles: Dict[str, Any]) -> List[Any]:
        items = data.get("items", [])
        if not items:
            return [Paragraph("No failures recorded in this period.", styles["body"])]
        rows = [
            [
                cell(_local(f.get("checked_at"), organization, "%Y-%m-%d") or "-"),
                cell(f.get("apparatus_name") or "-"),
                cell(f.get("compartment_name") or ""),
                cell(_item_with_count(f)),
                cell(f.get("checked_by_name") or "-"),
                cell(f.get("notes") or ""),
            ]
            for f in items
        ]
        fixed = 0.85 * inch + 1.1 * inch + 1.1 * inch + 1.4 * inch + 1.1 * inch
        return [
            data_table(
                ["Date", "Apparatus", "Compartment", "Item", "Checked by", "Notes"],
                rows,
                [0.85 * inch, 1.1 * inch, 1.1 * inch, 1.4 * inch, 1.1 * inch]
                + [width - fixed],
                zebra=True,
            )
        ]

    return render_report(meta, body)


def generate_check_detail_pdf(
    check: Dict[str, Any],
    organization: Optional[Organization] = None,
    generated_by: Optional[str] = None,
) -> bytes:
    """Generate an individual check report PDF
    (compartment-by-compartment results)."""
    overall = check.get("overall_status", "unknown")
    status_label = "PASS" if overall == "pass" else "FAIL"
    checked_at = _local(check.get("checked_at"), organization, "%Y-%m-%d %H:%M %Z")
    meta = _meta(
        "Equipment Check Report",
        organization,
        generated_by,
        [
            ("Checked by", check.get("checked_by_name") or "Unknown"),
            ("Date", checked_at or "-"),
            ("Timing", check.get("check_timing") or "-"),
        ],
        subtitle=f"Result: {status_label}",
    )
    width = meta.width

    def body(styles: Dict[str, Any]) -> List[Any]:
        story: List[Any] = [
            kpi_strip(
                [
                    ("Result", status_label),
                    ("Total items", check.get("total_items", 0)),
                    ("Completed", check.get("completed_items", 0)),
                    ("Failed", check.get("failed_items", 0)),
                ],
                width,
            ),
            Spacer(1, 12),
        ]

        compartments: Dict[str, List[Dict[str, Any]]] = {}
        for item in check.get("items", []):
            compartments.setdefault(item.get("compartment_name", "General"), []).append(
                item
            )

        fixed = 0.9 * inch + 0.9 * inch + 1.4 * inch
        for index, (comp_name, comp_items) in enumerate(compartments.items()):
            # Items placed directly on the checklist snapshot no location, and
            # print without a heading of their own, as the crew saw them.
            if comp_name:
                story.append(bookmark(str(comp_name), f"compartment-{index}"))
                story.append(section_heading(str(comp_name), styles))
            rows = []
            failed = []
            for row_index, it in enumerate(comp_items):
                status = describe_status(it.get("check_type"), it.get("status", ""))
                if it.get("status") == "fail":
                    failed.append(row_index)
                rows.append(
                    [
                        cell(it.get("item_name", "")),
                        cell(it.get("check_type", "")),
                        cell(
                            status.upper() if status else "-",
                            styles["cell_bold"] if row_index in failed else None,
                        ),
                        cell(
                            describe_count(
                                it.get("quantity_found"),
                                it.get("expected_quantity"),
                                it.get("count_unit"),
                            )
                            or "-"
                        ),
                        cell(it.get("notes") or ""),
                    ]
                )
            name_width = (width - fixed) * 0.55
            story.append(
                data_table(
                    ["Item", "Type", "Status", "Count", "Notes"],
                    rows,
                    [name_width, 0.9 * inch, 0.9 * inch, 1.4 * inch]
                    + [width - fixed - name_width],
                    emphasis_rows=failed,
                )
            )
            story.append(Spacer(1, 10))

        if check.get("notes"):
            story.append(section_heading("Overall Notes", styles))
            story.append(cell(check["notes"], styles["body"]))
        return story

    return render_report(meta, body)
