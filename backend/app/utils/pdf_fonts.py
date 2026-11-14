"""
The typeface generated documents print in, embedded in every PDF.

ReportLab's built-in Helvetica is one of the 14 standard PDF fonts: it is
never embedded, and it covers Latin-1 only. A member named Łukasz, Nguyễn or
Ольга printed as empty boxes, and no document could conform to PDF/A, which
requires every font to be embedded. Documents instead print in Noto Sans,
bundled under ``app/assets/fonts/`` with its licence. ReportLab embeds only
the glyphs a document uses.

Label sheets and ID cards are deliberately left on Helvetica (owner decision,
2026-11-09). Their text is fitted to die-cut boxes and thermal printer dots,
and a change of metrics there is a reprint of physical stock rather than a
layout tweak.

Registering at import keeps registration ahead of first use: every module that
names one of these fonts imports it from here.
"""

from pathlib import Path
from typing import Any, Dict, Sequence

from reportlab.lib.styles import StyleSheet1, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import TableStyle

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

BODY_FONT = "LogbookSans"
BOLD_FONT = "LogbookSans-Bold"
ITALIC_FONT = "LogbookSans-Italic"
BOLD_ITALIC_FONT = "LogbookSans-BoldItalic"

_FILES: Dict[str, str] = {
    BODY_FONT: "NotoSans-Regular.ttf",
    BOLD_FONT: "NotoSans-Bold.ttf",
    ITALIC_FONT: "NotoSans-Italic.ttf",
    BOLD_ITALIC_FONT: "NotoSans-BoldItalic.ttf",
}

# ReportLab's sample stylesheet names the standard fonts; these are what each
# becomes.
_STANDARD_TO_BUNDLED = {
    "Helvetica": BODY_FONT,
    "Helvetica-Bold": BOLD_FONT,
    "Helvetica-Oblique": ITALIC_FONT,
    "Helvetica-BoldOblique": BOLD_ITALIC_FONT,
    # Only the sample sheet's unused "Code" style names Courier. No monospace
    # face is bundled, and an unembedded Courier would disqualify a PDF/A
    # document, so it maps to the body face rather than staying a trap.
    "Courier": BODY_FONT,
}


def _register() -> None:
    registered = set(pdfmetrics.getRegisteredFontNames())
    for name, filename in _FILES.items():
        if name in registered:
            continue
        path = FONT_DIR / filename
        if not path.is_file():
            # Fail at import, naming the file: a document rendered in a
            # fallback font would silently lose its non-Latin names.
            raise RuntimeError(f"Bundled PDF font missing: {path}")
        pdfmetrics.registerFont(TTFont(name, str(path)))
    # Lets <b> and <i> in Paragraph markup resolve to the bundled faces.
    pdfmetrics.registerFontFamily(
        BODY_FONT,
        normal=BODY_FONT,
        bold=BOLD_FONT,
        italic=ITALIC_FONT,
        boldItalic=BOLD_ITALIC_FONT,
    )


_register()


def document_stylesheet() -> StyleSheet1:
    """ReportLab's sample stylesheet with every style in the bundled faces."""
    sheet = getSampleStyleSheet()
    for style in sheet.byName.values():
        for attr in ("fontName", "bulletFontName"):
            font = getattr(style, attr, None)
            if font in _STANDARD_TO_BUNDLED:
                setattr(style, attr, _STANDARD_TO_BUNDLED[font])
    return sheet


def body_table_style(commands: Sequence[Any] = ()) -> TableStyle:
    """A ``TableStyle`` whose cells default to the bundled body face.

    A plain-string table cell is drawn in ReportLab's default cell font,
    Helvetica, unless the table names another; *commands* follow this one, so
    a bold header row still overrides it.
    """
    return TableStyle([("FONTNAME", (0, 0), (-1, -1), BODY_FONT), *commands])
