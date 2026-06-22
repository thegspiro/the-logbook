"""
Inventory Impact Plan PDF renderer.

Renders the impact-planner analysis (summary, per-size purchase breakdown,
and the impacted-member list) to a print-ready PDF for procurement and
sharing. Kept separate from the service so the layout logic lives in one
place and can be unit-tested without a database.
"""

from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_HEADER_BG = colors.HexColor("#1f2937")
_ROW_ALT = colors.HexColor("#f3f4f6")
_GRID = colors.HexColor("#d1d5db")


def _money(value: Optional[float]) -> str:
    return f"${value:,.2f}" if value is not None else "—"


def _styled_table(data: List[List[Any]], col_widths: List[float]) -> Table:
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ROW_ALT]),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    return Table(data, colWidths=col_widths, repeatRows=1, style=TableStyle(style))


def _existing_status(member: Dict[str, Any]) -> str:
    if member.get("has_related_item"):
        return "Has item"
    if member.get("needs_replacement"):
        return "Replace"
    return "Needs item"


def render_impact_plan_pdf(
    data: Dict[str, Any], meta: Dict[str, Any]
) -> BytesIO:
    """Render the analysis *data* into a PDF, returning a BytesIO at pos 0.

    *meta* carries presentation context resolved by the service:
    ``org_name``, ``generated_at`` (datetime), ``parameters`` (list of
    label strings), and the ``show_size`` / ``show_existing`` /
    ``show_contact`` column toggles.
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        title="Inventory Impact Plan",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "PlanTitle", parent=styles["Title"], fontSize=18, spaceAfter=2
    )
    sub_style = ParagraphStyle(
        "PlanSub", parent=styles["Normal"], fontSize=9,
        textColor=colors.HexColor("#6b7280"),
    )
    section_style = ParagraphStyle(
        "Section", parent=styles["Heading2"], fontSize=12, spaceBefore=14,
        spaceAfter=6,
    )
    cell_style = ParagraphStyle(
        "Cell", parent=styles["Normal"], fontSize=8, leading=10
    )

    show_size = bool(meta.get("show_size"))
    show_existing = bool(meta.get("show_existing"))
    show_contact = bool(meta.get("show_contact"))

    story: List[Any] = []
    story.append(Paragraph("Inventory Impact Plan", title_style))

    generated_at: datetime = meta.get("generated_at") or datetime.utcnow()
    org_name = meta.get("org_name") or ""
    story.append(
        Paragraph(
            f"{org_name} &middot; Generated "
            f"{generated_at.strftime('%Y-%m-%d %H:%M UTC')}",
            sub_style,
        )
    )
    parameters: List[str] = meta.get("parameters") or []
    if parameters:
        story.append(Spacer(1, 4))
        story.append(Paragraph(" &nbsp;|&nbsp; ".join(parameters), sub_style))

    # ---- Summary ----
    story.append(Paragraph("Summary", section_style))
    summary_rows = [
        ["Members matched", str(data.get("total_members", 0))],
        ["Need the item", str(data.get("members_needing_item", 0))],
        ["Already have one", str(data.get("members_with_related_item", 0))],
    ]
    if data.get("replacement_aware"):
        summary_rows.append(
            ["Need replacement", str(data.get("members_needing_replacement", 0))]
        )
    if data.get("size_field"):
        summary_rows.append(
            ["Missing size info", str(data.get("members_missing_sizes", 0))]
        )
    if data.get("stock_checked"):
        summary_rows.append(
            ["Total to purchase", str(data.get("total_to_purchase", 0))]
        )
    if data.get("cost_estimated"):
        summary_rows.append(
            ["Estimated total cost", _money(data.get("estimated_total_cost"))]
        )
    story.append(_styled_table(summary_rows, [2.6 * inch, 1.4 * inch]))

    # ---- Size breakdown ----
    breakdown = data.get("size_breakdown") or []
    if breakdown:
        story.append(Paragraph("Sizes to purchase", section_style))
        header = ["Size", "Needed"]
        if data.get("stock_checked"):
            header += ["On hand", "Buy"]
        if data.get("cost_estimated"):
            header += ["Unit", "Est. cost"]
        rows = [header]
        for b in breakdown:
            row = [b.get("size", ""), str(b.get("needing", 0))]
            if data.get("stock_checked"):
                row += [str(b.get("on_hand", 0)), str(b.get("shortfall", 0))]
            if data.get("cost_estimated"):
                row += [_money(b.get("unit_cost")), _money(b.get("estimated_cost"))]
            rows.append(row)
        widths = [1.0 * inch] + [
            0.9 * inch for _ in range(len(header) - 1)
        ]
        story.append(_styled_table(rows, widths))

    # ---- Members ----
    members = data.get("members") or []
    story.append(
        Paragraph(f"Impacted Members ({len(members)})", section_style)
    )
    header = ["Member", "ID", "Rank", "Station"]
    if show_size:
        header.append("Size")
    if show_existing:
        header.append("Existing")
    if show_contact:
        header.append("Contact")
    rows = [header]
    for m in members:
        row = [
            Paragraph(m.get("full_name") or "Unknown", cell_style),
            m.get("membership_number") or "",
            m.get("rank") or "",
            m.get("station") or "",
        ]
        if show_size:
            row.append(m.get("needed_size") or "—")
        if show_existing:
            row.append(_existing_status(m))
        if show_contact:
            contact = m.get("email") or m.get("phone") or ""
            row.append(Paragraph(contact, cell_style))
        rows.append(row)

    # Distribute width across the visible columns.
    base_widths = {
        "Member": 1.5 * inch, "ID": 0.7 * inch, "Rank": 1.0 * inch,
        "Station": 0.9 * inch, "Size": 0.7 * inch, "Existing": 0.8 * inch,
        "Contact": 1.9 * inch,
    }
    widths = [base_widths[col] for col in header]
    story.append(_styled_table(rows, widths))

    doc.build(story)
    buf.seek(0)
    return buf
