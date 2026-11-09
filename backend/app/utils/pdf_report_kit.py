"""
Shared layout for tabular operational reports (training, equipment checks).

The election documents have their own letterhead module
(:mod:`app.utils.election_pdf_style`); this kit reuses its palette, logo
handling and escaping, and adds what a *report* needs and a ballot does not:

* a parameter strip stating what the report covers (period, filters), so a
  printed page read weeks later still says what it is;
* a summary strip of headline figures above the detail;
* every page footed with the department, the report, when and by whom it
  was generated (in the department's time zone), a confidentiality notice,
  and "Page X of Y" — reports are handed round as loose pages;
* tables whose header row repeats on every page, whose cells wrap rather
  than truncate, and which split a matrix too wide for the page into column
  bands instead of dropping the columns that do not fit;
* document metadata (title, author, subject, language) and outline entries,
  which a screen reader and the reader's sidebar both use.

Grayscale throughout, for the reason the election module gives: these are
run off on whatever copier the station has.

Text placement rule — the one that keeps both injection and mojibake out:
a reportlab ``Paragraph`` parses its text as markup, so user text going into
one must be escaped; a bare string table cell prints literally, so text
going into one must *not* be. :func:`cell` and :func:`num` always produce an
escaped ``Paragraph``, and the table helpers here only take those, so a
caller never has to decide.
"""

from functools import lru_cache
from io import BytesIO
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.utils.election_pdf_style import (
    BAND,
    GRID,
    INK,
    LOGO_BOX,
    MUTED,
    PANEL,
    base_styles,
    esc,
    logo_flowable,
)

CONFIDENTIAL_MEMBER_RECORDS = (
    "Confidential: contains member records. Do not post or forward."
)

SIDE_MARGIN = 0.6 * inch
TOP_MARGIN = 0.6 * inch
# Room for the two footer lines under the frame.
BOTTOM_MARGIN = 0.75 * inch
# The frame's own padding, each side.
_FRAME_PAD = 6

# A Table cell's default 6pt side padding, used when sizing column bands.
_CELL_PAD = 6


def content_width(pagesize: Tuple[float, float]) -> float:
    return pagesize[0] - 2 * SIDE_MARGIN - 2 * _FRAME_PAD


@lru_cache(maxsize=1)
def report_styles() -> Dict[str, ParagraphStyle]:
    """The report paragraph styles. Built once and shared: a report renders
    thousands of cells, and rebuilding the stylesheet per cell dominated the
    render time. Treat the returned styles as read-only."""
    styles = base_styles("Report")
    styles["cell"] = ParagraphStyle(
        "ReportCell", parent=styles["panel"], fontSize=8.5, leading=10.5
    )
    styles["cell_bold"] = ParagraphStyle(
        "ReportCellBold", parent=styles["cell"], fontName="Helvetica-Bold"
    )
    styles["cell_muted"] = ParagraphStyle(
        "ReportCellMuted", parent=styles["cell"], fontSize=7.5, textColor=MUTED
    )
    styles["num"] = ParagraphStyle(
        "ReportNum", parent=styles["cell"], alignment=TA_RIGHT
    )
    styles["head"] = ParagraphStyle(
        "ReportHead", parent=styles["cell"], fontName="Helvetica-Bold"
    )
    styles["head_num"] = ParagraphStyle(
        "ReportHeadNum", parent=styles["head"], alignment=TA_RIGHT
    )
    styles["section"] = ParagraphStyle(
        "ReportSection",
        parent=styles["contest"],
        fontSize=11.5,
        leading=14,
        spaceBefore=4,
    )
    styles["kpi_value"] = ParagraphStyle(
        "ReportKpiValue",
        parent=styles["panel"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
    )
    styles["kpi_label"] = ParagraphStyle(
        "ReportKpiLabel",
        parent=styles["panel"],
        fontSize=8,
        leading=10,
        textColor=MUTED,
    )
    styles["body"] = ParagraphStyle(
        "ReportBody", parent=styles["panel"], fontSize=9.5, leading=13
    )
    return styles


def cell(value: Any, style: Optional[ParagraphStyle] = None) -> Paragraph:
    """User or record text for a table cell: escaped, wrapped, never cut."""
    text = esc(value).replace("\r\n", "\n").replace("\n", "<br/>")
    return Paragraph(text, style or report_styles()["cell"])


def num(value: Any, style: Optional[ParagraphStyle] = None) -> Paragraph:
    """A figure, right-aligned so its digits line up down the column."""
    return Paragraph(esc(value), style or report_styles()["num"])


class _Bookmark(Flowable):
    """An invisible marker adding an outline (sidebar) entry at its page."""

    def __init__(self, title: str, key: str, level: int = 0):
        super().__init__()
        self.title = title
        self.key = key
        self.level = level

    def wrap(self, availWidth: float, availHeight: float) -> Tuple[float, float]:
        return (0, 0)

    def draw(self) -> None:
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.title, self.key, level=self.level)
        self.canv.showOutline()


def bookmark(title: str, key: str, level: int = 0) -> Flowable:
    return _Bookmark(title, key, level)


def section_heading(text: str, styles: Dict[str, ParagraphStyle]) -> Paragraph:
    return Paragraph(esc(text), styles["section"])


def data_table(
    header: Sequence[str],
    rows: Sequence[Sequence[Any]],
    widths: Sequence[float],
    numeric_cols: Sequence[int] = (),
    emphasis_rows: Sequence[int] = (),
    zebra: bool = False,
) -> Table:
    """A ruled table whose header row repeats on every page.

    *widths* are absolute points. *numeric_cols* right-align their header to
    sit over the figures. *emphasis_rows* (data indexes, first data row is 0)
    get a pale band — the rows a reader is looking for, such as failures —
    which survives a black-and-white copy where a red tint would not.
    Light horizontal rules only: no vertical grid, no dark header fill.
    """
    styles = report_styles()
    head = [
        Paragraph(esc(h), styles["head_num"] if i in numeric_cols else styles["head"])
        for i, h in enumerate(header)
    ]
    commands: List[Any] = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 1, INK),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, GRID),
        ("LINEBELOW", (0, -1), (-1, -1), 1, INK),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LEFTPADDING", (0, 0), (-1, -1), _CELL_PAD),
        ("RIGHTPADDING", (0, 0), (-1, -1), _CELL_PAD),
    ]
    if zebra and len(rows) > 1:
        commands.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [None, PANEL]))
    for index in emphasis_rows:
        commands.append(("BACKGROUND", (0, index + 1), (-1, index + 1), BAND))
    return Table(
        [head, *[list(r) for r in rows]],
        colWidths=list(widths),
        repeatRows=1,
        hAlign="LEFT",
        style=TableStyle(commands),
    )


def column_bands(
    total_columns: int, available: float, fixed: float, column_width: float
) -> List[Tuple[int, int]]:
    """Split *total_columns* variable columns into page-width bands.

    Returns ``(start, stop)`` index ranges. Each band is printed as its own
    table repeating the fixed (identifying) columns, so a matrix wider than
    the page is printed in full across several tables rather than having its
    right-hand columns silently dropped.
    """
    per_band = max(1, int((available - fixed) // column_width))
    return [
        (start, min(start + per_band, total_columns))
        for start in range(0, total_columns, per_band)
    ] or [(0, 0)]


def kpi_strip(figures: Sequence[Tuple[str, Any]], width: float) -> Table:
    """Headline figures in a row of boxes, read before the detail tables."""
    styles = report_styles()
    count = max(1, len(figures))
    return Table(
        [
            [
                [
                    Paragraph(esc(value), styles["kpi_value"]),
                    Paragraph(esc(label), styles["kpi_label"]),
                ]
                for label, value in figures
            ]
        ],
        colWidths=[width / count] * count,
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PANEL),
                ("BOX", (0, 0), (-1, -1), 0.75, GRID),
                ("LINEAFTER", (0, 0), (-2, -1), 0.75, GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        ),
    )


class ReportMeta:
    """What a report says about itself, outside its body.

    ``generated_at`` arrives already formatted in the department's time
    zone, with the zone named: the server's clock is UTC and must not reach
    the page (CLAUDE.md, date/time handling).
    """

    def __init__(
        self,
        title: str,
        org_name: Optional[str],
        generated_at: str,
        *,
        logo: Optional[str] = None,
        generated_by: Optional[str] = None,
        parameters: Sequence[Tuple[str, Any]] = (),
        subtitle: Optional[str] = None,
        confidentiality: Optional[str] = CONFIDENTIAL_MEMBER_RECORDS,
        subject: Optional[str] = None,
        lang: str = "en-US",
        wide: bool = False,
    ):
        self.title = title
        self.org_name = org_name
        self.generated_at = generated_at
        self.logo = logo
        self.generated_by = generated_by
        self.parameters = list(parameters)
        self.subtitle = subtitle
        self.confidentiality = confidentiality
        self.subject = subject or title
        self.lang = lang
        self.pagesize = landscape(letter) if wide else letter

    @property
    def width(self) -> float:
        return content_width(self.pagesize)


def _letterhead(meta: ReportMeta, styles: Dict[str, ParagraphStyle]) -> List[Any]:
    text: List[Any] = [
        Paragraph(esc(meta.org_name) or "Report", styles["org"]),
        Spacer(1, 3),
        Paragraph(esc(meta.title).upper(), styles["kicker"]),
    ]
    if meta.subtitle:
        text.append(Paragraph(esc(meta.subtitle), styles["election"]))
    image = logo_flowable(meta.logo)
    if image is not None:
        head: Any = Table(
            [[image, text]],
            colWidths=[LOGO_BOX + 0.2 * inch, meta.width - LOGO_BOX - 0.2 * inch],
            style=TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ]
            ),
        )
    else:
        head = Table(
            [[text]],
            colWidths=[meta.width],
            style=TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0)]),
        )
    flowables: List[Any] = [head, Spacer(1, 8)]
    if meta.parameters:
        flowables.append(
            Table(
                [
                    [
                        Paragraph(
                            " &nbsp;·&nbsp; ".join(
                                f"<b>{esc(label)}:</b> {esc(value)}"
                                for label, value in meta.parameters
                            ),
                            styles["panel"],
                        )
                    ]
                ],
                colWidths=[meta.width],
                style=TableStyle(
                    [
                        ("LINEABOVE", (0, 0), (-1, 0), 1.5, INK),
                        ("LINEBELOW", (0, 0), (-1, 0), 0.5, GRID),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ]
                ),
            )
        )
        flowables.append(Spacer(1, 10))
    return flowables


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _footer(meta: ReportMeta, total_pages: int) -> Callable[[Any, Any], None]:
    page_w = meta.pagesize[0]
    left = SIDE_MARGIN + _FRAME_PAD
    right = page_w - SIDE_MARGIN - _FRAME_PAD
    # Footer text is drawn straight onto the canvas: no markup is parsed, so
    # it is not escaped. The org and title are clipped so a long name cannot
    # run under the page number.
    ident = _clip(" · ".join(p for p in (meta.org_name, meta.title) if p), 90)
    generated = f"Generated: {meta.generated_at}"
    if meta.generated_by:
        generated += f" by {meta.generated_by}"
    generated = _clip(generated, 110)

    def draw(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(GRID)
        canvas.setLineWidth(0.5)
        canvas.line(left, BOTTOM_MARGIN - 14, right, BOTTOM_MARGIN - 14)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(left, BOTTOM_MARGIN - 25, ident)
        canvas.drawRightString(
            right, BOTTOM_MARGIN - 25, f"Page {document.page} of {total_pages}"
        )
        canvas.drawString(left, BOTTOM_MARGIN - 35, generated)
        if meta.confidentiality:
            canvas.setFont("Helvetica-Bold", 7.5)
            canvas.setFillColor(INK)
            canvas.drawRightString(right, BOTTOM_MARGIN - 35, meta.confidentiality)
        canvas.restoreState()

    return draw


def render_report(
    meta: ReportMeta, body: Callable[[Dict[str, ParagraphStyle]], List[Any]]
) -> bytes:
    """Lay the report out and return the PDF bytes.

    *body* builds the flowables after the letterhead. It is called once per
    layout pass — platypus consumes flowables as it splits them — and the
    first pass only counts pages so every footer can say "of Y".
    """

    def build(on_page: Callable[[Any, Any], None]) -> bytes:
        styles = report_styles()
        buf = BytesIO()
        doc = SimpleDocTemplate(
            buf,
            pagesize=meta.pagesize,
            leftMargin=SIDE_MARGIN,
            rightMargin=SIDE_MARGIN,
            topMargin=TOP_MARGIN,
            bottomMargin=BOTTOM_MARGIN,
            title=meta.title,
            author=meta.org_name or "",
            subject=meta.subject,
            creator="The Logbook",
            lang=meta.lang,
            displayDocTitle=True,
        )
        story = [*_letterhead(meta, styles), *body(styles)]
        doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
        return buf.getvalue()

    pages = {"count": 0}

    def count(canvas: Any, document: Any) -> None:
        pages["count"] = document.page

    build(count)
    return build(_footer(meta, pages["count"]))


def keep(flowables: List[Any]) -> KeepTogether:
    """A heading and the start of what it introduces, on one page."""
    return KeepTogether(flowables)
