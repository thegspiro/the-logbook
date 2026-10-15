"""Rich text for meeting-minute sections.

A section is either plain text (``format == "text"``, what every set of minutes
had before the editor existed) or a small, fixed subset of HTML
(``format == "html"``). This module is the one definition of that subset and the
only place HTML is cleaned, measured or turned into something else, so the
editor, the stored record, the PDF and the published copy cannot disagree about
what a section may contain.

The subset is what the editor offers: paragraphs, line breaks, bold, italic,
underline, two heading levels, bulleted and numbered lists, block quotes and
links. Anything else is dropped on write, with the text inside it kept — except
``script`` and ``style``, whose contents go too.

``nh3`` (a binding to the Rust ``ammonia`` sanitizer) does the cleaning rather
than a hand-written parser: sanitizing HTML is the textbook way to ship an XSS
hole, and a maintained allowlist sanitizer is the narrowest thing that works.
"""

import html
import re
from html.parser import HTMLParser
from typing import Any, List, Optional, Tuple

import nh3

FORMAT_TEXT = "text"
FORMAT_HTML = "html"
FORMATS = (FORMAT_TEXT, FORMAT_HTML)

ALLOWED_TAGS = frozenset(
    {"p", "br", "strong", "em", "u", "h2", "h3", "ul", "ol", "li", "blockquote", "a"}
)
ALLOWED_ATTRIBUTES = {"a": {"href"}}
ALLOWED_URL_SCHEMES = frozenset({"http", "https", "mailto"})

# Roughly ten pages of text. The editor cannot produce more by accident, and a
# bound keeps one section from becoming a storage and rendering liability.
MAX_HTML_LENGTH = 100_000

_BLOCK_END = re.compile(r"</(?:p|h2|h3|li|blockquote)>|<br\s*/?>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]*>")


def normalize_format(value: Any) -> str:
    """``"html"`` only when asked for exactly; anything else is plain text."""
    return FORMAT_HTML if value == FORMAT_HTML else FORMAT_TEXT


def sanitize_html(value: Optional[str]) -> str:
    """The allowed subset of *value*, with every other tag and attribute gone."""
    if not value:
        return ""
    # nh3 ships no type information, so its return value is Any.
    cleaned: str = nh3.clean(
        value,
        tags=set(ALLOWED_TAGS),
        attributes={tag: set(attrs) for tag, attrs in ALLOWED_ATTRIBUTES.items()},
        url_schemes=set(ALLOWED_URL_SCHEMES),
        link_rel="noopener noreferrer",
        strip_comments=True,
    )
    return cleaned


def html_to_text(value: Optional[str]) -> str:
    """The words of *value* with paragraph and list boundaries kept as newlines."""
    if not value:
        return ""
    spaced = _BLOCK_END.sub("\n", sanitize_html(value))
    return html.unescape(_TAG.sub("", spaced)).strip()


def section_text(section: dict) -> str:
    """A section's content as plain text, whichever format it is stored in."""
    content = section.get("content") or ""
    if normalize_format(section.get("format")) == FORMAT_HTML:
        return html_to_text(content)
    return content.strip()


def section_is_blank(section: dict) -> bool:
    """True when a section holds no words (an empty ``<p></p>`` is blank)."""
    return not section_text(section)


class _PdfBlocks(HTMLParser):
    """Turn sanitized HTML into (kind, inline-markup) blocks for ReportLab.

    ReportLab's ``Paragraph`` understands ``<b>``, ``<i>``, ``<u>``, ``<br/>``
    and ``<a href>``, so inline formatting is mapped onto those and block
    structure (headings, list items, quotes) becomes separate blocks the layout
    styles individually.
    """

    _INLINE = {"strong": "b", "em": "i", "u": "u"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: List[Tuple[str, str]] = []
        self._kind = "p"
        self._buf: List[str] = []
        self._lists: List[dict] = []
        self._open_links = 0

    def _flush(self) -> None:
        text = "".join(self._buf).strip()
        self._buf = []
        if text:
            self.blocks.append((self._kind, text))

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "h2", "h3", "blockquote"):
            self._flush()
            self._kind = {"p": "p", "h2": "h2", "h3": "h3", "blockquote": "quote"}[tag]
        elif tag in ("ul", "ol"):
            self._flush()
            self._lists.append({"ordered": tag == "ol", "n": 0})
        elif tag == "li":
            self._flush()
            current = self._lists[-1] if self._lists else {"ordered": False, "n": 0}
            current["n"] += 1
            self._kind = "li"
            self._buf.append(f"{current['n']}. " if current["ordered"] else "• ")
        elif tag == "br":
            self._buf.append("<br/>")
        elif tag in self._INLINE:
            self._buf.append(f"<{self._INLINE[tag]}>")
        elif tag == "a":
            href = dict(attrs).get("href")
            if href:
                self._buf.append(f'<a href="{html.escape(href, quote=True)}">')
                self._open_links += 1

    def handle_endtag(self, tag):
        if tag in ("p", "h2", "h3", "blockquote", "li"):
            self._flush()
            self._kind = "p"
        elif tag in ("ul", "ol"):
            self._flush()
            if self._lists:
                self._lists.pop()
        elif tag in self._INLINE:
            self._buf.append(f"</{self._INLINE[tag]}>")
        elif tag == "a" and self._open_links:
            self._buf.append("</a>")
            self._open_links -= 1

    def handle_data(self, data):
        self._buf.append(html.escape(data))

    def close(self):
        super().close()
        self._flush()


def html_to_pdf_blocks(value: Optional[str]) -> List[Tuple[str, str]]:
    """``(kind, markup)`` blocks for *value*; kind is p, h2, h3, li or quote.

    The markup is safe to hand to ``reportlab.platypus.Paragraph``: text is
    escaped here and only the inline tags above are ever emitted.
    """
    parser = _PdfBlocks()
    parser.feed(sanitize_html(value))
    parser.close()
    return parser.blocks
