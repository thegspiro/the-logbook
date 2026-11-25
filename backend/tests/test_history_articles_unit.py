"""History phase 6 without a database: the article's block and citation
cleaning, the export's file name and header, and the Word run parser."""

from datetime import date

import pytest

from app.api.v1.endpoints.history_articles import _disposition, export_filename
from app.models.history import ArticleBlockKind, ArticlePhotoSize
from app.services.history_article_export import inline_runs
from app.services.history_article_service import (
    MAX_BLOCKS,
    MAX_CITATIONS,
    HistoryArticleService,
    _clean_citations,
)
from app.utils.rich_text import html_to_pdf_blocks

pytestmark = pytest.mark.unit

_clean_blocks = HistoryArticleService._clean_blocks


class TestBlocks:
    def test_a_photo_block_needs_a_photo_and_defaults_to_full_width(self):
        with pytest.raises(ValueError, match="Choose a photo"):
            _clean_blocks([{"kind": "photo", "caption": "No photo"}])
        [block] = _clean_blocks([{"kind": "photo", "media_id": "m1", "caption": " "}])
        assert block == {
            "kind": ArticleBlockKind.PHOTO,
            "media_id": "m1",
            "caption": None,
            "size": ArticlePhotoSize.FULL,
        }

    def test_an_unknown_kind_and_too_many_blocks_are_refused(self):
        with pytest.raises(ValueError, match="either text or a photo"):
            _clean_blocks([{"kind": "video", "media_id": "m1"}])
        many = [{"kind": "text", "html": "<p>x</p>"}] * (MAX_BLOCKS + 1)
        with pytest.raises(ValueError, match="at most"):
            _clean_blocks(many)

    def test_a_caption_too_long_is_refused(self):
        with pytest.raises(ValueError, match="caption"):
            _clean_blocks([{"kind": "photo", "media_id": "m1", "caption": "c" * 501}])


class TestCitations:
    def test_blank_lines_go_and_order_stays(self):
        assert _clean_citations(["  Book  ", "", "Interview"]) == ["Book", "Interview"]
        assert _clean_citations(["   "]) is None

    def test_limits(self):
        with pytest.raises(ValueError, match="at most"):
            _clean_citations(["x"] * (MAX_CITATIONS + 1))
        with pytest.raises(ValueError, match="500"):
            _clean_citations(["x" * 501])


class TestFileName:
    def test_no_title_puts_a_separator_or_quote_in_the_name(self):
        name = export_filename('The "Big" fire / 1911', date(2026, 11, 23), "pdf")
        assert name == "the_big_fire_1911_2026-11-23.pdf"
        assert export_filename("///", date(2026, 11, 23), "docx") == (
            "article_2026-11-23.docx"
        )

    def test_a_name_outside_latin_1_is_encoded(self):
        assert _disposition("fire_2026-11-23.pdf") == (
            'attachment; filename="fire_2026-11-23.pdf"'
        )
        encoded = _disposition("feu_à_l_usine_2026-11-23.pdf")
        assert encoded.startswith("attachment; filename*=utf-8''")
        assert "à" not in encoded


class TestWordRuns:
    def test_runs_carry_bold_italic_links_and_breaks(self):
        [(_, markup)] = html_to_pdf_blocks(
            "<p>A <strong>bold <em>both</em></strong> line<br>and "
            '<a href="https://example.org">a link</a> &amp; more</p>'
        )
        runs = inline_runs(markup)
        assert [(r.text, r.bold, r.italic, r.href, r.line_break) for r in runs] == [
            ("A ", False, False, None, False),
            ("bold ", True, False, None, False),
            ("both", True, True, None, False),
            (" line", False, False, None, False),
            ("", False, False, None, True),
            ("and ", False, False, None, False),
            ("a link", False, False, "https://example.org", False),
            (" & more", False, False, None, False),
        ]
