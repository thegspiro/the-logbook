"""
Shared look for the election PDFs: the paper ballot and the certified
results.

Both documents go to the same people and often sit in the same folder, so
they share one letterhead (department logo, name, document kind, election
title), one grayscale palette and one shaded heading band. Keeping those in
one place is what keeps the two from drifting apart.

The palette is grayscale on purpose: these pages are run off on whatever
office printer or copier the department has, often in black and white, and
a colour tint — or a dark filled header row — that looks fine on screen
turns into a muddy block or vanishes on a copy.
"""

import html
from io import BytesIO
from typing import Any, Dict, List, Optional

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image as PdfImage
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

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
