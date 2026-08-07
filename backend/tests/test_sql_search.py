"""
Tests for LIKE/ILIKE pattern escaping (app/utils/sql_search.py).

SQLAlchemy parameterizes the search value, so an unescaped term is not an
injection risk — but "%" and "_" are still wildcards *inside* the parameter.
A member typing "%" into the storefront product search would otherwise get the
whole catalog back, and the paginated CSV export built on the same filter would
scan far more than intended.
"""

from app.utils.sql_search import LIKE_ESCAPE_CHAR, escape_like, like_pattern


class TestEscapeLike:
    def test_percent_is_escaped(self):
        assert escape_like("%") == "\\%"

    def test_underscore_is_escaped(self):
        assert escape_like("a_c") == "a\\_c"

    def test_backslash_is_escaped_first(self):
        """Escaping the backslash last would double-escape our own output."""
        assert escape_like("\\") == "\\\\"

    def test_backslash_before_percent_stays_distinct(self):
        # Literal "\%" must not collapse into an escape of "%".
        assert escape_like("\\%") == "\\\\\\%"

    def test_ordinary_text_is_untouched(self):
        assert escape_like("Station 3 Helmet") == "Station 3 Helmet"

    def test_empty_string(self):
        assert escape_like("") == ""


class TestLikePattern:
    def test_wraps_in_wildcards(self):
        assert like_pattern("helmet") == "%helmet%"

    def test_escapes_before_wrapping(self):
        """The surrounding % are real wildcards; the inner one is a literal."""
        assert like_pattern("100%") == "%100\\%%"

    def test_prefix_mode_anchors_at_start(self):
        assert like_pattern("ORD-2026", prefix=True) == "ORD-2026%"

    def test_prefix_mode_still_escapes(self):
        assert like_pattern("a_b", prefix=True) == "a\\_b%"

    def test_a_bare_percent_search_cannot_match_everything(self):
        """The regression this exists to prevent."""
        assert like_pattern("%") == "%\\%%"
        assert "\\%" in like_pattern("%")


class TestEscapeChar:
    def test_is_a_single_backslash(self):
        """Must match what escape_like inserts, or the escaping is inert."""
        assert LIKE_ESCAPE_CHAR == "\\"
        assert len(LIKE_ESCAPE_CHAR) == 1
