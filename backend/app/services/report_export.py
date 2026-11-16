"""
The Reports page's downloads: an export table rendered as PDF or CSV.

The PDF is laid out on the shared report kit (letterhead, parameter strip,
headline figures, a table whose header repeats on every page, and a footer
with the department, "Page X of Y", who generated it and when, in the
department's time zone). The CSV keeps the columns, order and cell spelling the
page's browser export used, so a spreadsheet built on it keeps working; it is
written through ``SafeCsvWriter``, which neutralises formula cells.
"""

import io
import re
from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple

from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Paragraph, Spacer

from app.services.report_tables import (
    ExportColumn,
    ExportTable,
    csv_value,
    display_value,
    is_numeric_column,
)
from app.utils.csv_export import SafeCsvWriter
from app.utils.pdf_fonts import BODY_FONT, BOLD_FONT
from app.utils.pdf_report_kit import (
    CONFIDENTIAL_MEMBER_RECORDS,
    ReportMeta,
    cell,
    column_bands,
    data_table,
    kpi_strip,
    num,
    render_report,
    section_heading,
)

# Above this many columns a portrait page cannot hold the table legibly.
_LANDSCAPE_FROM = 7
# Call volume's leading columns (date and total); its call types follow, and
# a department with many types is printed in bands rather than cramped.
_CALL_VOLUME_FIXED = 2
_TYPE_COLUMN_WIDTH = 0.9 * inch


def export_filename(title: str, today: date, extension: str) -> str:
    """``member_roster_2026-11-15.pdf``: the page's browser-export naming."""
    stem = re.sub(r"\s+", "_", title).lower()
    return f"{stem}_{today.isoformat()}.{extension}"


def _csv_cell(value: Any) -> Any:
    # Numbers go to the writer as numbers: SafeCsvWriter neutralises a string
    # starting with "-", which would turn "-5 days until expiry" into "'-5".
    if isinstance(value, bool):
        return csv_value(value)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, (int, float)):
        return value
    return csv_value(value)


def render_report_csv(table: ExportTable) -> bytes:
    out = io.StringIO()
    writer = SafeCsvWriter(out, lineterminator="\n")
    writer.writerow([c.header for c in table.columns])
    for row in table.rows:
        writer.writerow([_csv_cell(row.get(c.key)) for c in table.columns])
    return out.getvalue().encode("utf-8")


# A column's natural width: its longest header word (bold) or its typical
# value, measured in the table's own 8.5pt faces, plus the cell's 6pt padding
# each side. Bounded so one long note cannot take the page.
_FONT_SIZE = 8.5
_CELL_PADDING = 12
_MIN_WIDTH = 0.45 * inch
_MAX_WIDTH = 2.4 * inch
_SAMPLE_ROWS = 200


def _natural_width(column: ExportColumn, sample: Sequence[Dict[str, Any]]) -> float:
    header = max(
        (stringWidth(word, BOLD_FONT, _FONT_SIZE) for word in column.header.split()),
        default=0.0,
    )
    widths = sorted(
        stringWidth(display_value(row.get(column.key)), BODY_FONT, _FONT_SIZE)
        for row in sample
    )
    # The 90th percentile, so one outlier does not set the width.
    typical = widths[int(len(widths) * 0.9)] if widths else 0.0
    return min(_MAX_WIDTH, max(_MIN_WIDTH, header, typical)) + _CELL_PADDING


def _widths(
    columns: Sequence[ExportColumn],
    rows: Sequence[Dict[str, Any]],
    total: float,
) -> List[float]:
    """Each column at its natural width; when they do not fit, only the widest
    are narrowed, to a common cap, so a status or a date keeps its line while
    an email address wraps."""
    natural = [_natural_width(c, rows[:_SAMPLE_ROWS]) for c in columns]
    if sum(natural) <= total:
        scale = total / sum(natural)
        return [n * scale for n in natural]
    low, high = 0.0, max(natural)
    for _ in range(40):
        cap = (low + high) / 2
        if sum(min(n, cap) for n in natural) > total:
            high = cap
        else:
            low = cap
    return [min(n, low) for n in natural]


def _table_flowable(
    columns: Sequence[ExportColumn],
    rows: Sequence[Dict[str, Any]],
    width: float,
    widths: Optional[Sequence[float]] = None,
) -> Any:
    numeric = [is_numeric_column(rows, c.key) for c in columns]
    body = [
        [
            (
                num(display_value(row.get(c.key)))
                if is_num
                else cell(display_value(row.get(c.key)))
            )
            for c, is_num in zip(columns, numeric)
        ]
        for row in rows
    ]
    return data_table(
        [c.header for c in columns],
        body,
        list(widths) if widths else _widths(columns, rows, width),
        numeric_cols=tuple(i for i, is_num in enumerate(numeric) if is_num),
        zebra=True,
    )


def render_report_pdf(
    table: ExportTable,
    *,
    org_name: Optional[str],
    logo: Optional[str],
    generated_at: str,
    generated_by: Optional[str],
    parameters: Sequence[Tuple[str, str]],
) -> bytes:
    banded = table.report_type == "call_volume" and len(table.columns) > _LANDSCAPE_FROM
    meta = ReportMeta(
        table.title,
        org_name,
        generated_at,
        logo=logo,
        generated_by=generated_by,
        parameters=list(parameters),
        subject=f"{table.title} report",
        # Aggregate operational reports carry no member records to warn about.
        confidentiality=(
            CONFIDENTIAL_MEMBER_RECORDS if table.contains_member_data else None
        ),
        wide=banded or len(table.columns) >= _LANDSCAPE_FROM,
    )
    width = meta.width

    def body(styles: Dict[str, Any]) -> List[Any]:
        story: List[Any] = []
        if table.kpis:
            story += [kpi_strip(table.kpis, width), Spacer(1, 12)]
        if not table.rows:
            story.append(
                Paragraph("Nothing to report for these settings.", styles["body"])
            )
            return story
        if not banded:
            story.append(_table_flowable(table.columns, table.rows, width))
            return story
        fixed = list(table.columns[:_CALL_VOLUME_FIXED])
        types = list(table.columns[_CALL_VOLUME_FIXED:])
        fixed_width = 1.6 * inch
        bands = column_bands(len(types), width, fixed_width, _TYPE_COLUMN_WIDTH)
        for start, stop in bands:
            band = fixed + types[start:stop]
            story.append(
                section_heading(
                    f"Call types {start + 1}–{stop} of {len(types)}", styles
                )
            )
            widths = [fixed_width / 2, fixed_width / 2] + [_TYPE_COLUMN_WIDTH] * (
                stop - start
            )
            story.append(_table_flowable(band, table.rows, width, widths))
            story.append(Spacer(1, 12))
        return story

    return render_report(meta, body)
