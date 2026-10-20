"""Matching the words of minutes: the query, the rules, the snippets."""

import pytest

from app.utils.minutes_search import (
    MAX_MATCHES_PER_MINUTES,
    MAX_TERMS,
    Source,
    compile_terms,
    normalize_whitespace,
    parse_query,
    search_sources,
    snippet_parts,
)

pytestmark = [pytest.mark.unit]


def _search(query: str, *sources: Source):
    return search_sources(compile_terms(parse_query(query)), list(sources))


def _section(text: str, label: str = "New business") -> Source:
    return Source("section", label, text)


class TestParseQuery:
    def test_words_are_lower_cased_and_kept_in_order(self):
        assert parse_query("Budget  HOSE") == ["budget", "hose"]

    def test_a_quoted_phrase_is_one_term(self):
        assert parse_query('"fire  prevention week" budget') == [
            "fire prevention week",
            "budget",
        ]

    def test_repeats_one_character_words_and_bare_punctuation_are_left_out(self):
        assert parse_query("hose HOSE a -- ?? hose") == ["hose"]

    def test_an_unclosed_quote_still_yields_its_words(self):
        assert parse_query('"fire prevention') == ["fire", "prevention"]

    def test_the_number_of_terms_is_capped(self):
        words = " ".join(f"word{n}" for n in range(MAX_TERMS + 5))

        assert len(parse_query(words)) == MAX_TERMS

    def test_nothing_usable_gives_no_terms(self):
        assert parse_query("  a  ") == []
        assert compile_terms([]) == []


class TestMatching:
    def test_every_word_must_appear_but_not_in_the_same_place(self):
        found = _search(
            "budget hose",
            _section("The budget was read.", "Treasurer"),
            _section("Station 2 needs hose.", "New business"),
        )

        assert found is not None
        assert [m["label"] for m in found["matches"]] == ["Treasurer", "New business"]

    def test_one_missing_word_is_no_match(self):
        assert _search("budget ladder", _section("The budget and hose.")) is None

    def test_a_word_matches_where_a_word_starts(self):
        assert _search("hose", _section("Four hoses were tested.")) is not None
        assert _search("urchase", _section("A purchase was made.")) is None

    def test_case_does_not_matter(self):
        assert _search("TREASURER", _section("the treasurer reported")) is not None

    def test_a_phrase_must_appear_as_typed_across_line_breaks(self):
        text = "Fire\nprevention   week was planned."

        assert _search('"fire prevention week"', _section(text)) is not None
        assert _search('"prevention fire"', _section(text)) is None

    def test_regular_expression_characters_are_just_characters(self):
        assert _search("(boom", _section("Said (boom) twice")) is not None
        assert _search(".*", _section("anything at all")) is None

    def test_no_terms_matches_nothing(self):
        assert search_sources([], [_section("text")]) is None

    def test_empty_sources_are_ignored(self):
        assert (
            _search("hose", Source("motion", "Motion", ""), _section("hose"))
            is not None
        )


class TestSnippets:
    def test_hits_are_marked_and_the_rest_is_plain(self):
        found = _search("hose", _section("We bought hose today."))

        assert found is not None
        assert found["matches"][0]["parts"] == [
            {"text": "We bought ", "hit": False},
            {"text": "hose", "hit": True},
            {"text": " today.", "hit": False},
        ]

    def test_a_long_text_is_cut_around_the_first_hit_with_ellipses(self):
        text = "alpha " * 60 + "hose" + " omega" * 60

        parts = snippet_parts(
            normalize_whitespace(text), [(len("alpha ") * 60, len("alpha ") * 60 + 4)]
        )

        assert parts[0]["text"].startswith("…")
        assert parts[-1]["text"].endswith("…")
        assert sum(p["hit"] for p in parts) == 1
        assert len("".join(p["text"] for p in parts)) < 200

    def test_every_hit_inside_the_window_is_marked(self):
        found = _search("hose budget", _section("Hose budget: hose and more."))

        assert found is not None
        marked = [p["text"] for p in found["matches"][0]["parts"] if p["hit"]]
        assert marked == ["Hose", "budget", "hose"]

    def test_html_is_never_interpreted_in_a_snippet(self):
        found = _search("hose", _section("<b>hose</b>"))

        assert found is not None
        assert "".join(p["text"] for p in found["matches"][0]["parts"]) == "<b>hose</b>"

    def test_the_places_shown_are_capped_but_all_are_counted(self):
        sources = [
            _section("hose", f"Section {n}") for n in range(MAX_MATCHES_PER_MINUTES + 3)
        ]

        found = search_sources(compile_terms(["hose"]), sources)

        assert found is not None
        assert len(found["matches"]) == MAX_MATCHES_PER_MINUTES
        assert found["match_count"] == MAX_MATCHES_PER_MINUTES + 3
