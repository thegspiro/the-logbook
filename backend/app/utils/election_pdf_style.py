"""
Shared look for the election PDFs: the pre-meeting package, the paper
ballot and the certified results.

All three go to the same people and are filed together with the minutes,
so they share one letterhead (department logo, name, document kind,
election title), one grayscale palette, one shaded heading band, one table
style and one page footer. Keeping those in one place is what keeps the
documents from drifting apart.

The palette is grayscale on purpose: these pages are run off on whatever
office printer or copier the department has, often in black and white, and
a colour tint — or a dark filled header row — that looks fine on screen
turns into a muddy block or vanishes on a copy.
"""

import html
from io import BytesIO
from typing import Any, Callable, Dict, List, Optional

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image as PdfImage
from reportlab.platypus import KeepTogether, Paragraph, Spacer, Table, TableStyle

from app.utils.app_icons import decode_logo

INK = colors.HexColor("#111827")
GRID = colors.HexColor("#9ca3af")
MUTED = colors.HexColor("#4b5563")
# Light enough to stay a pale band on a copier, dark enough to survive one.
BAND = colors.HexColor("#e5e7eb")
PANEL = colors.HexColor("#f3f4f6")

SIDE_MARGIN = 0.7 * inch
VERTICAL_MARGIN = 0.6 * inch
# Page width less the side margins and the frame's own 6pt padding each side.
CONTENT_WIDTH = letter[0] - 2 * SIDE_MARGIN - 12
LOGO_BOX = 0.9 * inch


def esc(value: Any) -> str:
    return html.escape(str(value)) if value is not None else ""


def base_styles(prefix: str) -> Dict[str, ParagraphStyle]:
    """The paragraph styles both documents draw from.

    *prefix* keeps the style names distinct per document; reportlab does
    not require it, but it keeps a style dump readable.
    """
    base = getSampleStyleSheet()
    return {
        "org": ParagraphStyle(
            f"{prefix}Org",
            parent=base["Title"],
            fontSize=17,
            leading=21,
            alignment=0,
            spaceAfter=0,
            textColor=INK,
        ),
        "kicker": ParagraphStyle(
            f"{prefix}Kicker",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=INK,
        ),
        "election": ParagraphStyle(
            f"{prefix}Election",
            parent=base["Normal"],
            fontSize=12,
            leading=15,
            textColor=MUTED,
        ),
        "contest": ParagraphStyle(
            f"{prefix}Contest",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=INK,
        ),
        "note": ParagraphStyle(
            f"{prefix}Note",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9,
            leading=12,
            textColor=INK,
        ),
        "panel": ParagraphStyle(
            f"{prefix}Panel",
            parent=base["Normal"],
            fontSize=9.5,
            leading=13,
            textColor=INK,
        ),
        "footer": ParagraphStyle(
            f"{prefix}Footer",
            parent=base["Normal"],
            fontSize=8,
            leading=11,
            textColor=MUTED,
            alignment=1,
        ),
    }


def logo_flowable(stored: Optional[str]) -> Optional[PdfImage]:
    """The department logo sized for the letterhead, or ``None``.

    ``decode_logo`` reads only ``data:`` URIs (never fetches a URL) and
    returns ``None`` for anything it cannot render, so a missing or broken
    logo leaves a text-only letterhead rather than failing the print.
    """
    logo = decode_logo(stored)
    if logo is None:
        return None
    # Transparent pixels are composited onto white: left transparent they
    # print black on some PDF viewers and drivers.
    flat = Image.new("RGB", logo.size, (255, 255, 255))
    flat.paste(logo, mask=logo.split()[-1])
    scale = LOGO_BOX / max(flat.width, flat.height)
    png = BytesIO()
    flat.save(png, format="PNG")
    png.seek(0)
    return PdfImage(
        png,
        width=flat.width * scale,
        height=flat.height * scale,
    )


def letterhead(
    org_name: Any,
    kicker: str,
    lines: List[Paragraph],
    logo: Optional[str],
    styles: Dict[str, ParagraphStyle],
    fallback_title: str,
) -> Table:
    """Logo beside the department name, the document kind and *lines*.

    Without a usable logo the text takes the full width.
    """
    heading_text: List[Any] = [
        Paragraph(esc(org_name) or fallback_title, styles["org"]),
        Spacer(1, 3),
        Paragraph(kicker, styles["kicker"]),
        *lines,
    ]
    image = logo_flowable(logo)
    if image is not None:
        return Table(
            [[image, heading_text]],
            colWidths=[LOGO_BOX + 0.2 * inch, CONTENT_WIDTH - LOGO_BOX - 0.2 * inch],
            style=TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ]
            ),
        )
    return Table(
        [[heading_text]],
        colWidths=[CONTENT_WIDTH],
        style=TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0)]),
    )


def heading_band(
    heading: str, notes: List[str], styles: Dict[str, ParagraphStyle]
) -> Table:
    """A shaded band under a heavy rule: *heading* in bold, *notes* below."""
    cells: List[List[Any]] = [[Paragraph(heading, styles["contest"])]]
    cells.extend([[Paragraph(note, styles["note"])] for note in notes])
    return Table(
        cells,
        colWidths=[CONTENT_WIDTH],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BAND),
                ("LINEABOVE", (0, 0), (-1, 0), 1.5, INK),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, 0), 6),
                ("TOPPADDING", (0, 1), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 6),
            ]
        ),
    )


def panel(paragraphs: List[Paragraph]) -> Table:
    """A pale boxed panel, for instructions and notices."""
    return Table(
        [[p] for p in paragraphs],
        colWidths=[CONTENT_WIDTH],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PANEL),
                ("BOX", (0, 0), (-1, -1), 0.75, GRID),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        ),
    )


def ruled_table(
    data: List[List[Any]], fractions: List[float], bold_rows: List[int]
) -> Table:
    """A ruled table under a bold header row, columns sized as fractions.

    No dark header fill and no vertical grid: both print as heavy blocks on
    a black-and-white copier. The section's gray band sits directly above,
    so the header row itself stays white to read as separate from it.
    *bold_rows* (data indexes, header is 0) mark the rows a reader is
    looking for, such as the winners.
    """
    commands: List[Any] = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, 0), 1, INK),
        ("LINEBELOW", (0, 1), (-1, -2), 0.5, GRID),
        ("LINEBELOW", (0, -1), (-1, -1), 1, INK),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]
    for row in bold_rows:
        commands.append(("FONTNAME", (0, row), (-1, row), "Helvetica-Bold"))
    return Table(
        data,
        colWidths=[CONTENT_WIDTH * f for f in fractions],
        repeatRows=1,
        style=TableStyle(commands),
    )


def key_value_table(rows: List[List[Any]], label_fraction: float = 0.35) -> Table:
    """Bold labels beside their values, ruled like :func:`ruled_table`."""
    return Table(
        rows,
        colWidths=[
            CONTENT_WIDTH * label_fraction,
            CONTENT_WIDTH * (1 - label_fraction),
        ],
        style=TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -2), 0.5, GRID),
                ("LINEBELOW", (0, -1), (-1, -1), 1, INK),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ]
        ),
    )


def padded(paragraphs: List[Paragraph]) -> Table:
    """Body text inset to line up with the heading and table text above."""
    return Table(
        [[p] for p in paragraphs],
        colWidths=[CONTENT_WIDTH],
        style=TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
            ]
        ),
    )


def section(
    heading: str, body: List[Any], styles: Dict[str, ParagraphStyle]
) -> KeepTogether:
    """A heading band and what follows it, never split from each other."""
    return KeepTogether([heading_band(heading, [], styles), *body, Spacer(1, 14)])


def page_footer(label: str) -> Callable[[Any, Any], None]:
    """A page callback printing "*label* · Page N" at the foot of each page.

    These documents are filed and handed round as loose pages, so each page
    names what it belongs to and where it falls in the set.
    """

    def draw(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawCentredString(
            letter[0] / 2,
            VERTICAL_MARGIN / 2,
            f"{label} · Page {document.page}",
        )
        canvas.restoreState()

    return draw


def page_of_footer(
    label: str, total_pages: int, continued_note: str
) -> Callable[[Any, Any], None]:
    """A page callback printing "*label* · Page X of Y".

    The caller lays the document out once to learn *total_pages*, then again
    with this footer. On every page but the last it also prints
    *continued_note*: a voter handed a two-page ballot must not fold it after
    the first page and leave the second unmarked.
    """

    def draw(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawCentredString(
            letter[0] / 2,
            VERTICAL_MARGIN / 2,
            f"{label} · Page {document.page} of {total_pages}",
        )
        if document.page < total_pages:
            canvas.setFont("Helvetica-Bold", 9)
            canvas.setFillColor(INK)
            canvas.drawCentredString(
                letter[0] / 2, VERTICAL_MARGIN / 2 + 12, continued_note
            )
        canvas.restoreState()

    return draw
