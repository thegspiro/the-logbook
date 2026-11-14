"""Markdown to HTML for archive text (history biographies, later articles).

One renderer for every place the text is shown — the screen, and in later
phases the PDF and Word exports — so they cannot disagree about what a
biography says.

Two layers, deliberately. ``markdown-it-py`` renders with raw HTML disabled
and images switched off (a biography that pulls an image from another site
would tell that site who read it). ``nh3`` then cleans the output against an
allowlist, so a renderer bug or a future plugin cannot put markup on the page
that the allowlist does not name. The browser sanitises again with DOMPurify.
"""

from typing import Optional

import nh3
from markdown_it import MarkdownIt

ALLOWED_TAGS = frozenset(
    {
        "p",
        "br",
        "hr",
        "strong",
        "em",
        "s",
        "h1",
        "h2",
        "h3",
        "h4",
        "ul",
        "ol",
        "li",
        "blockquote",
        "a",
        "code",
        "pre",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
    }
)
ALLOWED_ATTRIBUTES = {"a": {"href"}, "th": {"style"}, "td": {"style"}}
ALLOWED_URL_SCHEMES = frozenset({"http", "https", "mailto"})

_renderer = (
    MarkdownIt("commonmark", {"html": False, "linkify": False})
    .enable(["table", "strikethrough"])
    .disable("image")
)


def render_markdown(value: Optional[str]) -> str:
    """Safe HTML for *value*, or an empty string for nothing."""
    if not value or not value.strip():
        return ""
    rendered = _renderer.render(value)
    # nh3 ships no type information, so its return value is Any.
    cleaned: str = nh3.clean(
        rendered,
        tags=set(ALLOWED_TAGS),
        attributes={tag: set(attrs) for tag, attrs in ALLOWED_ATTRIBUTES.items()},
        url_schemes=set(ALLOWED_URL_SCHEMES),
        link_rel="noopener noreferrer",
        # Only the column alignment markdown-it writes for tables.
        filter_style_properties={"text-align"},
    )
    return cleaned
