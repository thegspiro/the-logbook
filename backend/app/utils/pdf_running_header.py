"""
A compact header at the top of every page after the first.

Page 1 of a document carries its letterhead. The pages after it used to start
with the body, so a page separated from the rest (a copier tray, a binder
pulled apart, a table handed round at a meeting) said nothing about whose it
was or what it belonged to. :class:`HeadedDocTemplate` gives those pages a
slim band instead: the department's logo, its name, and what the document is,
over a hairline rule (owner decision, 2026-11-16).

It is a drop-in for ``SimpleDocTemplate``. That class already switches to
its "Later" page template after page 1; this one shortens that template's
frame by :data:`HEADER_BAND` and draws the band in the space freed, so the
page-1 layout and every document's story are untouched. The band sits inside
the document's own top margin line, so it inherits the margins each document
already keeps clear of the printer's edge and the binding
(:mod:`app.utils.print_geometry`).
"""

from typing import Any, Callable, List, Optional, Tuple, Union

from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Frame, PageTemplate, SimpleDocTemplate

from app.utils.election_pdf_style import GRID, INK, MUTED, flattened_logo
from app.utils.pdf_fonts import BODY_FONT, BOLD_FONT

# A Frame's default padding; the band lines up with the frame's inner edge,
# where the body's own first ink falls.
_FRAME_PAD = 6
_LOGO_HEIGHT = 0.3 * inch
_LOGO_GAP = 6
_NAME_SIZE = 8.5
_DETAIL_SIZE = 8
_RULE_GAP = 4
# Space the band takes from the top of the frame on later pages: the logo,
# the rule under it, and a gap before the body.
HEADER_BAND = _LOGO_HEIGHT + _RULE_GAP + 10
_BANNER_SIZE = 8
# Space a handling banner takes from the top of the frame on every page.
BANNER_BAND = _BANNER_SIZE + 9

_SEPARATOR = " · "


class RunningHeader:
    """What the band on pages 2 onward says.

    *detail* narrows *title* to this copy: the election, the meeting, the
    member, the period. *reference* is the copy's report number
    (:mod:`app.utils.report_number`), set at the right so a page found on
    its own can be traced to the export that made it. The logo is the stored
    data URI; anything that will not decode leaves a text-only band rather
    than failing the document.
    """

    def __init__(
        self,
        org_name: Optional[str],
        title: str,
        detail: Optional[str] = None,
        logo: Optional[str] = None,
        reference: Optional[str] = None,
    ):
        self.org_name = (org_name or "").strip()
        self.title = title
        self.detail = (detail or "").strip()
        self.logo = logo
        self.reference = (reference or "").strip()


def _clip_to(text: str, font: str, size: float, width: float) -> str:
    if stringWidth(text, font, size) <= width:
        return text
    ellipsis = "…"
    while text and stringWidth(text + ellipsis, font, size) > width:
        text = text[:-1]
    return text.rstrip() + ellipsis if text else ""


def header_painter(
    header: RunningHeader, drop: float = 0.0
) -> Callable[[Any, Any], None]:
    """A page callback that draws *header* above the document's frame,
    *drop* points below the top margin (to clear a handling banner)."""
    image = flattened_logo(header.logo)
    reader = ImageReader(image) if image is not None else None
    logo_w = image.width * _LOGO_HEIGHT / image.height if image is not None else 0.0
    # Text is drawn straight onto the canvas: no markup is parsed, so it is
    # not escaped.
    rest = _SEPARATOR.join(p for p in (header.title, header.detail) if p)

    def draw(canvas: Any, doc: Any) -> None:
        page_w, page_h = doc.pagesize
        left = doc.leftMargin + _FRAME_PAD
        right = page_w - doc.rightMargin - _FRAME_PAD
        top = page_h - doc.topMargin - _FRAME_PAD - drop
        bottom = top - _LOGO_HEIGHT
        x = left
        canvas.saveState()
        baseline = bottom + (_LOGO_HEIGHT - _NAME_SIZE) / 2 + 1
        if header.reference:
            canvas.setFillColor(INK)
            canvas.setFont(BODY_FONT, _DETAIL_SIZE)
            canvas.drawRightString(right, baseline, header.reference)
            right -= stringWidth(header.reference, BODY_FONT, _DETAIL_SIZE) + 12
        if reader is not None:
            canvas.drawImage(
                reader, x, bottom, width=logo_w, height=_LOGO_HEIGHT, mask=None
            )
            x += logo_w + _LOGO_GAP
        room = right - x
        name = _clip_to(header.org_name, BOLD_FONT, _NAME_SIZE, room)
        canvas.setFillColor(INK)
        canvas.setFont(BOLD_FONT, _NAME_SIZE)
        canvas.drawString(x, baseline, name)
        used = stringWidth(name, BOLD_FONT, _NAME_SIZE)
        if rest:
            tail = (_SEPARATOR if name else "") + rest
            tail = _clip_to(tail, BODY_FONT, _DETAIL_SIZE, room - used)
            canvas.setFillColor(MUTED)
            canvas.setFont(BODY_FONT, _DETAIL_SIZE)
            canvas.drawString(x + used, baseline, tail)
        canvas.setStrokeColor(GRID)
        canvas.setLineWidth(0.5)
        rule = bottom - _RULE_GAP
        canvas.line(left, rule, page_w - doc.rightMargin - _FRAME_PAD, rule)
        canvas.restoreState()

    return draw


def banner_painter(banner: str) -> Callable[[Any, Any], None]:
    """A page callback that sets *banner* centred at the top of the frame.

    Federal handling-marking guidance puts a document's handling marking at
    the top and bottom of every page; the footers already carry the bottom
    one (owner decision, 2026-11-21).
    """

    def draw(canvas: Any, doc: Any) -> None:
        page_w, page_h = doc.pagesize
        left = doc.leftMargin + _FRAME_PAD
        right = page_w - doc.rightMargin - _FRAME_PAD
        baseline = page_h - doc.topMargin - _FRAME_PAD - _BANNER_SIZE
        text = _clip_to(banner, BOLD_FONT, _BANNER_SIZE, right - left)
        canvas.saveState()
        canvas.setFillColor(INK)
        canvas.setFont(BOLD_FONT, _BANNER_SIZE)
        canvas.drawCentredString((left + right) / 2, baseline, text)
        canvas.restoreState()

    return draw


class HeadedDocTemplate(SimpleDocTemplate):
    """``SimpleDocTemplate`` with a :class:`RunningHeader` on pages 2 onward,
    an optional handling *banner* atop every page, and an optional *overlay*
    painted on every page after its content, so table fills cannot hide it.

    With none of them it behaves exactly as ``SimpleDocTemplate``.
    """

    def __init__(
        self,
        filename: Any,
        running_header: Optional[RunningHeader] = None,
        banner: Optional[str] = None,
        overlay: Optional[Callable[[Any], None]] = None,
        **kw: Any,
    ):
        self.running_header = running_header
        self.banner = (banner or "").strip()
        self.overlay = overlay
        super().__init__(filename, **kw)

    def addPageTemplates(
        self,
        pageTemplates: Union[
            List[PageTemplate], Tuple[PageTemplate, ...], PageTemplate
        ],
    ) -> None:
        # SimpleDocTemplate.build hands its "First" and "Later" templates to
        # this method, after settling the margins, and switches to "Later"
        # after page 1. Swapping "Later" here leaves page 1, and everything
        # else build does, exactly as SimpleDocTemplate has it.
        templates = (
            list(pageTemplates)
            if isinstance(pageTemplates, (list, tuple))
            else [pageTemplates]
        )
        if self.running_header is not None or self.banner or self.overlay:
            templates = [self._dressed(t) for t in templates]
        super().addPageTemplates(templates)

    def _dressed(self, template: PageTemplate) -> PageTemplate:
        later = template.id == "Later"
        band = BANNER_BAND if self.banner else 0.0
        painters: List[Callable[[Any, Any], None]] = []
        if self.banner:
            painters.append(banner_painter(self.banner))
        if later and self.running_header is not None:
            painters.append(header_painter(self.running_header, band))
            band += HEADER_BAND
        if not painters and self.overlay is None:
            return template
        footer = template.onPage
        overlay = self.overlay

        def on_page_end(canvas: Any, _doc: Any) -> None:
            if overlay is not None:
                overlay(canvas)

        def on_page(canvas: Any, doc: Any) -> None:
            for paint in painters:
                paint(canvas, doc)
            footer(canvas, doc)

        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height - band,
            id="normal",
        )
        return PageTemplate(
            id=template.id,
            frames=[frame],
            onPage=on_page,
            onPageEnd=on_page_end,
            pagesize=self.pagesize,
        )
