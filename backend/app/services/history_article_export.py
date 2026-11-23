"""
A History article as a PDF or a Word file.

Both are built from the article's *export view*: the page the reader could
read, never the research notes, and never a photo the reader could not see
(``HistoryArticleService.export_view``). So a member's file holds what the
member could read, and a public article's file is no wider than its page.

Archive photos are stored as WebP, which neither ReportLab nor python-docx
embeds, so each one is read from its display copy (already stripped of
location and camera data, and smaller than the original) and re-encoded as
JPEG in memory. A photo whose stored file cannot be read prints as a note
rather than failing the whole file.

Both files carry the department's name and logo at the head and "Prepared by
the department historian", the date and the page number at the foot
(owner-approved spec, 2026-11-22).
"""

import html
from dataclasses import dataclass, field
from html.parser import HTMLParser
from io import BytesIO
from typing import Any, Callable, Optional

from docx import Document as WordDocument
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.opc.constants import RELATIONSHIP_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from loguru import logger
from PIL import Image, UnidentifiedImageError
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Image as PdfImage
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer

from app.models.history import HistoryArticle, HistoryMedia, MediaFileRole
from app.services import file_storage_service as file_storage
from app.utils.election_pdf_style import (
    BOTTOM_MARGIN,
    CONTENT_WIDTH,
    FOOTER_BASELINE,
    INK,
    MUTED,
    SIDE_MARGIN,
    VERTICAL_MARGIN,
    base_styles,
    beside_logo,
    esc,
    flattened_logo,
)
from app.utils.pdf_fonts import BODY_FONT, BOLD_FONT, ITALIC_FONT
from app.utils.rich_text import html_to_pdf_blocks

PREPARED_BY = "Prepared by the department historian"

#: The longest side a photo is printed from. A letter page is 8.5" wide, so
#: this is ~200 dpi across the full text width: sharp on paper, and it keeps a
#: forty-photo article's file a size that can be emailed.
PHOTO_MAX_PIXELS = 1600
PHOTO_JPEG_QUALITY = 85
#: The tallest a photo may print, so a portrait photo leaves room on its page
#: for its caption.
PHOTO_MAX_HEIGHT = 6.5 * inch

_SOURCE_LABELS = {"document": "Document", "event": "Event", "photo": "Photo"}


@dataclass
class ExportMeta:
    org_name: Optional[str]
    logo: Optional[str]
    #: The day the file was made, already written out for the department.
    generated_on: str
    photos: dict[str, bytes] = field(default_factory=dict)


def footer_label(generated_on: str) -> str:
    return f"{PREPARED_BY} · {generated_on}"


# ----------------------------------------------------------------------
# Photos
# ----------------------------------------------------------------------


def _as_jpeg(content: bytes) -> bytes:
    with Image.open(BytesIO(content)) as image:
        image.load()
        flat = image.convert("RGB")
    flat.thumbnail((PHOTO_MAX_PIXELS, PHOTO_MAX_PIXELS))
    out = BytesIO()
    flat.save(out, format="JPEG", quality=PHOTO_JPEG_QUALITY, optimize=True)
    return out.getvalue()


def _shown_media(item: HistoryArticle) -> dict[str, HistoryMedia]:
    shown: dict[str, HistoryMedia] = {}
    for media in [item.cover_media, *(b.media for b in item.blocks)]:
        if media is not None:
            shown.setdefault(media.id, media)
    return shown


async def load_photos(item: HistoryArticle, view: dict[str, Any]) -> dict[str, bytes]:
    """JPEG bytes for every photo *view* shows, keyed by media id. Only photos
    already in the view are read, so nothing the reader may not see is ever
    loaded."""
    wanted = {view["cover"]["id"]} if view.get("cover") else set()
    wanted |= {b["media"]["id"] for b in view["blocks"] if b.get("media")}
    media = _shown_media(item)
    photos: dict[str, bytes] = {}
    for media_id in wanted:
        stored = next(
            (f for f in media[media_id].files if f.role == MediaFileRole.DISPLAY),
            None,
        )
        if stored is None:
            continue
        try:
            photos[media_id] = _as_jpeg(await file_storage.read_bytes(stored.file_path))
        except (OSError, UnidentifiedImageError, ValueError) as exc:
            logger.warning(
                "Article {} export: photo {} could not be read: {}",
                item.id,
                media_id,
                type(exc).__name__,
            )
    return photos


def _photo_size(content: bytes, max_width: float) -> tuple[float, float]:
    with Image.open(BytesIO(content)) as image:
        width, height = image.size
    scale = min(max_width / width, PHOTO_MAX_HEIGHT / height)
    return width * scale, height * scale


# ----------------------------------------------------------------------
# PDF
# ----------------------------------------------------------------------


def _pdf_styles() -> dict[str, ParagraphStyle]:
    base = base_styles("Article")
    body = ParagraphStyle(
        "ArticleBody",
        fontName=BODY_FONT,
        fontSize=10.5,
        leading=15,
        textColor=INK,
        spaceAfter=7,
    )
    return {
        **base,
        "title": ParagraphStyle(
            "ArticleTitle",
            fontName=BOLD_FONT,
            fontSize=22,
            leading=27,
            textColor=INK,
            spaceBefore=10,
            spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "ArticleSubtitle",
            fontName=BODY_FONT,
            fontSize=13,
            leading=17,
            textColor=MUTED,
            spaceAfter=4,
        ),
        "byline": ParagraphStyle(
            "ArticleByline",
            fontName=ITALIC_FONT,
            fontSize=10,
            leading=13,
            textColor=MUTED,
            spaceAfter=10,
        ),
        "summary": ParagraphStyle(
            "ArticleSummary", parent=body, fontName=ITALIC_FONT, spaceAfter=12
        ),
        "p": body,
        "h2": ParagraphStyle(
            "ArticleH2",
            parent=body,
            fontName=BOLD_FONT,
            fontSize=15,
            leading=19,
            spaceBefore=10,
            spaceAfter=5,
        ),
        "h3": ParagraphStyle(
            "ArticleH3",
            parent=body,
            fontName=BOLD_FONT,
            fontSize=12,
            leading=16,
            spaceBefore=8,
            spaceAfter=4,
        ),
        "li": ParagraphStyle("ArticleItem", parent=body, leftIndent=16, spaceAfter=3),
        "quote": ParagraphStyle(
            "ArticleQuote",
            parent=body,
            fontName=ITALIC_FONT,
            leftIndent=22,
            rightIndent=22,
            textColor=MUTED,
        ),
        "caption": ParagraphStyle(
            "ArticleCaption",
            fontName=ITALIC_FONT,
            fontSize=9,
            leading=12,
            textColor=MUTED,
            spaceBefore=3,
            spaceAfter=12,
        ),
        "section": ParagraphStyle(
            "ArticleSection",
            fontName=BOLD_FONT,
            fontSize=12,
            leading=16,
            textColor=INK,
            spaceBefore=14,
            spaceAfter=5,
        ),
        "source": ParagraphStyle(
            "ArticleSource", parent=body, fontSize=9.5, leading=13, spaceAfter=2
        ),
    }


def _pdf_photo(
    content: Optional[bytes],
    caption: Optional[str],
    half: bool,
    styles: dict[str, ParagraphStyle],
) -> list[Any]:
    parts: list[Any] = []
    if content is None:
        parts.append(Paragraph("(Photo not available)", styles["caption"]))
    else:
        width, height = _photo_size(
            content, CONTENT_WIDTH / 2 if half else CONTENT_WIDTH
        )
        image = PdfImage(BytesIO(content), width=width, height=height)
        image.hAlign = "LEFT"
        parts.append(image)
    if caption:
        parts.append(Paragraph(esc(caption), styles["caption"]))
    elif content is not None:
        parts.append(Spacer(1, 10))
    return [KeepTogether(parts)]


def _pdf_story(view: dict[str, Any], meta: ExportMeta) -> list[Any]:
    styles = _pdf_styles()
    story: list[Any] = []
    if meta.org_name or meta.logo:
        story += beside_logo(
            [Paragraph(esc(meta.org_name or ""), styles["org"])],
            meta.logo,
            CONTENT_WIDTH,
        )
    story.append(Paragraph(esc(view["title"]), styles["title"]))
    if view.get("subtitle"):
        story.append(Paragraph(esc(view["subtitle"]), styles["subtitle"]))
    if view.get("byline"):
        story.append(Paragraph(f"By {esc(view['byline'])}", styles["byline"]))
    if view.get("summary"):
        story.append(Paragraph(esc(view["summary"]), styles["summary"]))
    if view.get("cover"):
        story += _pdf_photo(meta.photos.get(view["cover"]["id"]), None, False, styles)
    for block in view["blocks"]:
        if block["kind"] == "text":
            for kind, markup in html_to_pdf_blocks(block["html"]):
                story.append(Paragraph(markup, styles[kind]))
        else:
            story += _pdf_photo(
                meta.photos.get(block["media"]["id"]),
                block.get("caption"),
                block.get("size") == "half",
                styles,
            )
    people = ", ".join(m["display_name"] for m in view["members"])
    apparatus = ", ".join(a["name"] for a in view["apparatus"])
    if people or apparatus:
        story.append(Paragraph("In this article", styles["section"]))
        if people:
            story.append(Paragraph(f"<b>People:</b> {esc(people)}", styles["source"]))
        if apparatus:
            story.append(
                Paragraph(f"<b>Apparatus:</b> {esc(apparatus)}", styles["source"])
            )
    if view["sources"] or view["citations"]:
        story.append(Paragraph("Sources", styles["section"]))
        for source in view["sources"]:
            label = _SOURCE_LABELS[source["kind"]]
            story.append(
                Paragraph(
                    f"<b>{label}:</b> {esc(source['title'])} (department archive)",
                    styles["source"],
                )
            )
        for citation in view["citations"]:
            story.append(Paragraph(esc(citation), styles["source"]))
    return story


def _pdf_footer(label: str, total: Optional[int]) -> Callable[[Any, Any], None]:
    def draw(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setFont(BODY_FONT, 8)
        canvas.setFillColor(MUTED)
        page = f"Page {document.page}" + (f" of {total}" if total else "")
        canvas.drawCentredString(letter[0] / 2, FOOTER_BASELINE, f"{label} · {page}")
        canvas.restoreState()

    return draw


def _pdf_pass(
    view: dict[str, Any], meta: ExportMeta, total: Optional[int]
) -> tuple[bytes, int]:
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=SIDE_MARGIN,
        rightMargin=SIDE_MARGIN,
        topMargin=VERTICAL_MARGIN,
        bottomMargin=BOTTOM_MARGIN,
        title=view["title"],
        author=view.get("byline") or meta.org_name or "",
        subject="Department history",
        initialFontName=BODY_FONT,
    )
    footer = _pdf_footer(footer_label(meta.generated_on), total)
    document.build(_pdf_story(view, meta), onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue(), document.page


def render_article_pdf(view: dict[str, Any], meta: ExportMeta) -> bytes:
    """Laid out twice: once to count the pages, then with "Page N of Y", as
    the department's other printed documents are."""
    _, pages = _pdf_pass(view, meta, None)
    content, _ = _pdf_pass(view, meta, pages)
    return content


# ----------------------------------------------------------------------
# Word
# ----------------------------------------------------------------------


@dataclass
class _Run:
    text: str
    bold: bool = False
    italic: bool = False
    underline: bool = False
    href: Optional[str] = None
    line_break: bool = False


class _InlineRuns(HTMLParser):
    """Split the inline markup ``html_to_pdf_blocks`` emits (``<b>``, ``<i>``,
    ``<u>``, ``<br/>``, ``<a href>``, escaped text) into Word runs."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.runs: list[_Run] = []
        self._bold = self._italic = self._underline = 0
        self._href: Optional[str] = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]):
        if tag == "b":
            self._bold += 1
        elif tag == "i":
            self._italic += 1
        elif tag == "u":
            self._underline += 1
        elif tag == "a":
            self._href = dict(attrs).get("href")
        elif tag == "br":
            self.runs.append(_Run("", line_break=True))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, Optional[str]]]):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str):
        if tag == "b":
            self._bold = max(0, self._bold - 1)
        elif tag == "i":
            self._italic = max(0, self._italic - 1)
        elif tag == "u":
            self._underline = max(0, self._underline - 1)
        elif tag == "a":
            self._href = None

    def handle_data(self, data: str):
        if data:
            self.runs.append(
                _Run(
                    data,
                    bold=bool(self._bold),
                    italic=bool(self._italic),
                    underline=bool(self._underline),
                    href=self._href,
                )
            )


def inline_runs(markup: str) -> list[_Run]:
    parser = _InlineRuns()
    parser.feed(markup)
    parser.close()
    return parser.runs


def _hyperlink(paragraph: Any, run: _Run) -> None:
    """python-docx has no hyperlink API; this is the documented OOXML shape.
    Only an http(s) or mailto href reaches here (the sanitizer's allowlist)."""
    rel_id = paragraph.part.relate_to(
        run.href, RELATIONSHIP_TYPE.HYPERLINK, is_external=True
    )
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), rel_id)
    element = OxmlElement("w:r")
    properties = OxmlElement("w:rPr")
    for tag, value in (("w:color", "1F4E79"), ("w:u", "single")):
        child = OxmlElement(tag)
        child.set(qn("w:val"), value)
        properties.append(child)
    for flag, tag in ((run.bold, "w:b"), (run.italic, "w:i")):
        if flag:
            properties.append(OxmlElement(tag))
    element.append(properties)
    text = OxmlElement("w:t")
    text.set(qn("xml:space"), "preserve")
    text.text = run.text
    element.append(text)
    link.append(element)
    paragraph._p.append(link)


def _word_paragraph(document: Any, markup: str, style: Optional[str] = None) -> Any:
    paragraph = document.add_paragraph(style=style)
    for run in inline_runs(markup):
        if run.line_break:
            paragraph.add_run().add_break()
        elif run.href:
            _hyperlink(paragraph, run)
        else:
            added = paragraph.add_run(run.text)
            added.bold = run.bold or None
            added.italic = run.italic or None
            added.underline = run.underline or None
    return paragraph


def _page_field(paragraph: Any) -> None:
    run = paragraph.add_run()
    for kind, text in (("begin", None), (None, "PAGE"), ("end", None)):
        if kind:
            char = OxmlElement("w:fldChar")
            char.set(qn("w:fldCharType"), kind)
            run._r.append(char)
        else:
            instruction = OxmlElement("w:instrText")
            instruction.set(qn("xml:space"), "preserve")
            instruction.text = text
            run._r.append(instruction)


def _word_photo(
    document: Any, content: Optional[bytes], caption: Optional[str], half: bool
) -> None:
    if content is None:
        note = document.add_paragraph()
        note.add_run("(Photo not available)").italic = True
    else:
        width, _ = _photo_size(content, (CONTENT_WIDTH / 2) if half else CONTENT_WIDTH)
        document.add_picture(BytesIO(content), width=Inches(width / inch))
    if caption:
        para = document.add_paragraph()
        added = para.add_run(caption)
        added.italic = True
        added.font.size = Pt(9)
        added.font.color.rgb = RGBColor(0x4B, 0x55, 0x63)


def render_article_docx(view: dict[str, Any], meta: ExportMeta) -> bytes:
    document = WordDocument()
    section = document.sections[0]
    for side in ("left_margin", "right_margin"):
        setattr(section, side, Inches(1))

    header = section.header.paragraphs[0]
    logo = flattened_logo(meta.logo)
    if logo is not None:
        png = BytesIO()
        logo.save(png, format="PNG")
        png.seek(0)
        header.add_run().add_picture(png, height=Inches(0.55))
        header.add_run("  ")
    if meta.org_name:
        header.add_run(meta.org_name).bold = True

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.add_run(f"{footer_label(meta.generated_on)} · Page ")
    _page_field(footer)

    document.add_heading(view["title"], level=0)
    if view.get("subtitle"):
        document.add_paragraph(view["subtitle"], style="Subtitle")
    if view.get("byline"):
        document.add_paragraph().add_run(f"By {view['byline']}").italic = True
    if view.get("summary"):
        document.add_paragraph().add_run(view["summary"]).italic = True
    if view.get("cover"):
        _word_photo(document, meta.photos.get(view["cover"]["id"]), None, False)

    styles = {"p": None, "h2": "Heading 2", "h3": "Heading 3", "quote": "Quote"}
    for block in view["blocks"]:
        if block["kind"] == "text":
            for kind, markup in html_to_pdf_blocks(block["html"]):
                if kind in ("h2", "h3"):
                    # A heading is one run of plain text in Word's own style.
                    text = "".join(r.text for r in inline_runs(markup))
                    document.add_heading(text, level=2 if kind == "h2" else 3)
                    continue
                paragraph = _word_paragraph(document, markup, styles.get(kind))
                if kind == "li":
                    paragraph.paragraph_format.left_indent = Inches(0.3)
        else:
            _word_photo(
                document,
                meta.photos.get(block["media"]["id"]),
                block.get("caption"),
                block.get("size") == "half",
            )

    people = ", ".join(m["display_name"] for m in view["members"])
    apparatus = ", ".join(a["name"] for a in view["apparatus"])
    if people or apparatus:
        document.add_heading("In this article", level=2)
        if people:
            _word_paragraph(document, f"<b>People:</b> {html.escape(people)}")
        if apparatus:
            _word_paragraph(document, f"<b>Apparatus:</b> {html.escape(apparatus)}")
    if view["sources"] or view["citations"]:
        document.add_heading("Sources", level=2)
        for source in view["sources"]:
            label = _SOURCE_LABELS[source["kind"]]
            _word_paragraph(
                document,
                f"<b>{label}:</b> {html.escape(source['title'])} (department archive)",
            )
        for citation in view["citations"]:
            document.add_paragraph(citation)

    document.core_properties.title = view["title"]
    document.core_properties.author = view.get("byline") or meta.org_name or ""
    out = BytesIO()
    document.save(out)
    return out.getvalue()
