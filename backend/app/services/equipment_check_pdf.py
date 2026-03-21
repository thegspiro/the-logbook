"""
Equipment Check PDF Report Generator

Produces downloadable PDF reports using reportlab:
- Compliance summary (per-apparatus stats)
- Deficiency / failure log (table)
- Individual check report (compartment-by-compartment)
"""

import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_styles = getSampleStyleSheet()

TITLE_STYLE = ParagraphStyle(
    "ReportTitle",
    parent=_styles["Title"],
    fontSize=16,
    spaceAfter=6,
)

SUBTITLE_STYLE = ParagraphStyle(
    "ReportSubtitle",
    parent=_styles["Normal"],
    fontSize=10,
    textColor=colors.grey,
    spaceAfter=14,
)

SECTION_STYLE = ParagraphStyle(
    "SectionHeader",
    parent=_styles["Heading2"],
    fontSize=12,
    spaceBefore=14,
    spaceAfter=6,
)

BODY_STYLE = ParagraphStyle(
    "BodyText",
    parent=_styles["Normal"],
    fontSize=9,
    leading=12,
)

SMALL_STYLE = ParagraphStyle(
    "SmallText",
    parent=_styles["Normal"],
    fontSize=8,
    leading=10,
    textColor=colors.Color(0.4, 0.4, 0.4),
)


# Shared table style
_BASE_TABLE_STYLE = TableStyle(
    [
        ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.15, 0.15, 0.2)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.8, 0.8, 0.8)),
        (
            "ROWBACKGROUNDS",
            (0, 1),
            (-1, -1),
            [colors.white, colors.Color(0.96, 0.96, 0.96)],
        ),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
)


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def generate_compliance_pdf(
    data: Dict[str, Any],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> bytes:
    """Generate a compliance summary PDF."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
    )
    elements: List[Any] = []

    elements.append(Paragraph("Equipment Check Compliance Report", TITLE_STYLE))
    period = ""
    if date_from and date_to:
        period = f"{date_from} to {date_to}"
    elif date_from:
        period = f"From {date_from}"
    elif date_to:
        period = f"Through {date_to}"
    elements.append(
        Paragraph(
            f"Period: {period or 'Last 30 days'}  |  Generated: {_now_str()}",
            SUBTITLE_STYLE,
        )
    )

    # Summary stats
    total = data.get("total_checks", 0)
    rate = data.get("pass_rate", 0)
    avg_items = data.get("avg_items_per_check", 0)
    elements.append(Paragraph("Summary", SECTION_STYLE))
    summary_data = [
        ["Total Checks", "Pass Rate", "Avg Items / Check"],
        [str(total), f"{rate}%", str(avg_items)],
    ]
    summary_table = Table(summary_data, colWidths=[2.2 * inch] * 3)
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.15, 0.15, 0.2)),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.8, 0.8, 0.8)),
            ]
        )
    )
    elements.append(summary_table)
    elements.append(Spacer(1, 12))

    # Apparatus table
    apparatus_list = data.get("apparatus", [])
    if apparatus_list:
        elements.append(Paragraph("Apparatus Compliance", SECTION_STYLE))
        header = [
            "Apparatus",
            "Checks",
            "Pass",
            "Fail",
            "Last Check",
            "Deficiency",
        ]
        rows = [header]
        for a in apparatus_list:
            last_dt = a.get("last_check_date", "")
            if last_dt and isinstance(last_dt, str) and len(last_dt) > 10:
                last_dt = last_dt[:10]
            rows.append(
                [
                    str(a.get("apparatus_name", "")),
                    str(a.get("checks_completed", 0)),
                    str(a.get("pass_count", 0)),
                    str(a.get("fail_count", 0)),
                    str(last_dt or "-"),
                    "Yes" if a.get("has_deficiency") else "No",
                ]
            )
        col_widths = [
            2 * inch,
            0.8 * inch,
            0.7 * inch,
            0.7 * inch,
            1.2 * inch,
            1 * inch,
        ]
        t = Table(rows, colWidths=col_widths)
        t.setStyle(_BASE_TABLE_STYLE)
        elements.append(t)
        elements.append(Spacer(1, 12))

    # Member table
    members = data.get("members", [])
    if members:
        elements.append(Paragraph("Member Completion", SECTION_STYLE))
        header = ["Member", "Checks", "Pass", "Fail", "Rate"]
        rows = [header]
        for m in members:
            done = m.get("checks_completed", 0)
            p = m.get("pass_count", 0)
            rate_val = f"{round(p / done * 100)}%" if done > 0 else "-"
            rows.append(
                [
                    str(m.get("user_name", "")),
                    str(done),
                    str(p),
                    str(m.get("fail_count", 0)),
                    rate_val,
                ]
            )
        col_widths = [2.5 * inch, 1 * inch, 0.8 * inch, 0.8 * inch, 1 * inch]
        t = Table(rows, colWidths=col_widths)
        t.setStyle(_BASE_TABLE_STYLE)
        elements.append(t)

    doc.build(elements)
    return buf.getvalue()


def generate_failure_log_pdf(
    data: Dict[str, Any],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> bytes:
    """Generate a failure/deficiency log PDF."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
    )
    elements: List[Any] = []

    elements.append(Paragraph("Equipment Check Failure Log", TITLE_STYLE))
    period = ""
    if date_from and date_to:
        period = f"{date_from} to {date_to}"
    elements.append(
        Paragraph(
            f"Period: {period or 'Last 30 days'}  |  "
            f"Total failures: {data.get('total', 0)}  |  "
            f"Generated: {_now_str()}",
            SUBTITLE_STYLE,
        )
    )

    items = data.get("items", [])
    if not items:
        elements.append(
            Paragraph(
                "No failures recorded in this period.",
                BODY_STYLE,
            )
        )
    else:
        header = [
            "Date",
            "Apparatus",
            "Compartment",
            "Item",
            "Checked By",
            "Notes",
        ]
        rows = [header]
        for f in items:
            dt = f.get("checked_at", "")
            if dt and isinstance(dt, str) and len(dt) > 10:
                dt = dt[:10]
            notes = str(f.get("notes", "") or "")
            if len(notes) > 60:
                notes = notes[:57] + "..."
            rows.append(
                [
                    str(dt or "-"),
                    str(f.get("apparatus_name", "-")),
                    str(f.get("compartment_name", "")),
                    str(f.get("item_name", "")),
                    str(f.get("checked_by_name", "-")),
                    notes,
                ]
            )
        col_widths = [
            0.9 * inch,
            1.1 * inch,
            1.1 * inch,
            1.3 * inch,
            1.1 * inch,
            1.5 * inch,
        ]
        t = Table(rows, colWidths=col_widths)
        t.setStyle(_BASE_TABLE_STYLE)
        elements.append(t)

    doc.build(elements)
    return buf.getvalue()


def generate_check_detail_pdf(
    check: Dict[str, Any],
) -> bytes:
    """Generate an individual check report PDF
    (compartment-by-compartment results)."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
    )
    elements: List[Any] = []

    overall = check.get("overall_status", "unknown")
    status_label = "PASS" if overall == "pass" else "FAIL"
    elements.append(
        Paragraph(
            f"Equipment Check Report — {status_label}",
            TITLE_STYLE,
        )
    )

    checked_at = check.get("checked_at", "")
    if checked_at and isinstance(checked_at, str) and len(checked_at) > 19:
        checked_at = checked_at[:19]
    elements.append(
        Paragraph(
            f"Checked by: {check.get('checked_by_name', 'Unknown')}  |  "
            f"Date: {checked_at or '-'}  |  "
            f"Timing: {check.get('check_timing', '-')}",
            SUBTITLE_STYLE,
        )
    )
    elements.append(
        Paragraph(
            f"Total items: {check.get('total_items', 0)}  |  "
            f"Completed: {check.get('completed_items', 0)}  |  "
            f"Failed: {check.get('failed_items', 0)}",
            BODY_STYLE,
        )
    )
    elements.append(Spacer(1, 8))

    # Group items by compartment
    items = check.get("items", [])
    compartments: Dict[str, List[Dict[str, Any]]] = {}
    for item in items:
        comp = item.get("compartment_name", "General")
        compartments.setdefault(comp, []).append(item)

    for comp_name, comp_items in compartments.items():
        elements.append(Paragraph(comp_name, SECTION_STYLE))
        header = ["Item", "Type", "Status", "Notes"]
        rows = [header]
        for it in comp_items:
            status = it.get("status", "")
            notes = str(it.get("notes", "") or "")
            if len(notes) > 50:
                notes = notes[:47] + "..."
            rows.append(
                [
                    str(it.get("item_name", "")),
                    str(it.get("check_type", "")),
                    status.upper() if status else "-",
                    notes,
                ]
            )
        col_widths = [
            2.5 * inch,
            1.2 * inch,
            1 * inch,
            2 * inch,
        ]
        t = Table(rows, colWidths=col_widths)
        style = TableStyle(list(_BASE_TABLE_STYLE.getCommands()))
        # Highlight failed rows in red
        for i, it in enumerate(comp_items, start=1):
            if it.get("status") == "fail":
                style.add(
                    "BACKGROUND",
                    (0, i),
                    (-1, i),
                    colors.Color(1, 0.92, 0.92),
                )
        t.setStyle(style)
        elements.append(t)
        elements.append(Spacer(1, 6))

    # Notes
    if check.get("notes"):
        elements.append(Paragraph("Overall Notes", SECTION_STYLE))
        elements.append(Paragraph(str(check["notes"]), BODY_STYLE))

    doc.build(elements)
    return buf.getvalue()
