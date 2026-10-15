"""Tracked changes between two versions of a rich-text section (no database)."""

import random

import pytest

from app.utils.redline import (
    apply_changes,
    compute_changes,
    describe_change,
    plain_to_html,
    tokenize,
)

pytestmark = pytest.mark.unit

BASE = (
    "<h2>Hose</h2><p>The committee reported <strong>three bids</strong> today.</p>"
    "<ul><li>Vendor A — $4,200</li><li>Vendor B — $3,900</li></ul>"
)
EDITED = (
    "<h2>Hose</h2><p>The committee reported <strong>four quotes</strong> today.</p>"
    "<ul><li>Vendor A — $4,200</li><li>Vendor B — $3,950</li></ul>"
)


def _all(changes):
    return {c["id"] for c in changes}


class TestPlainToHtml:
    def test_blank_lines_make_paragraphs_and_single_breaks_stay(self):
        assert (
            plain_to_html("One\nstill one\n\nTwo")
            == "<p>One<br>still one</p><p>Two</p>"
        )

    def test_text_is_escaped_never_read_as_markup(self):
        assert (
            plain_to_html("a < b & <b>x</b>")
            == "<p>a &lt; b &amp; &lt;b&gt;x&lt;/b&gt;</p>"
        )

    def test_nothing_in_nothing_out(self):
        assert plain_to_html("") == ""
        assert plain_to_html(None) == ""
        assert plain_to_html("  \n\n ") == ""


class TestTokenize:
    def test_joining_the_tokens_restores_the_text(self):
        assert "".join(tokenize(BASE)) == BASE

    def test_tags_whitespace_and_words_are_separate_tokens(self):
        assert tokenize("<p>Hi  there</p>") == ["<p>", "Hi", "  ", "there", "</p>"]


class TestComputeChanges:
    def test_no_difference_is_no_changes(self):
        assert compute_changes(BASE, BASE) == []

    def test_each_edit_is_its_own_change_and_adjacent_words_are_one(self):
        changes = compute_changes(BASE, EDITED)
        assert [c["id"] for c in changes] == ["c1", "c2"]
        first, second = (describe_change(c) for c in changes)
        assert (first["kind"], first["deleted"], first["inserted"]) == (
            "replace",
            "three bids",
            "four quotes",
        )
        assert (second["deleted"], second["inserted"]) == ("$3,900", "$3,950")

    def test_context_is_the_words_around_the_change(self):
        first = describe_change(compute_changes(BASE, EDITED)[0])
        assert first["before"].endswith("reported")
        assert first["after"].startswith("today.")

    def test_kinds(self):
        insert = describe_change(compute_changes("<p>A B</p>", "<p>A new B</p>")[0])
        delete = describe_change(compute_changes("<p>A old B</p>", "<p>A B</p>")[0])
        fmt = describe_change(
            compute_changes("<p>A B</p>", "<p>A <strong>B</strong></p>")[0]
        )
        assert (insert["kind"], insert["inserted"]) == ("insert", "new")
        assert (delete["kind"], delete["deleted"]) == ("delete", "old")
        assert fmt["kind"] == "format"

    def test_an_added_paragraph_is_an_insertion(self):
        change = describe_change(
            compute_changes("<p>One</p>", "<p>One</p><p>Two</p>")[0]
        )
        assert (change["kind"], change["inserted"]) == ("insert", "Two")


class TestApply:
    def test_nothing_accepted_changes_nothing(self):
        changes = compute_changes(BASE, EDITED)
        assert apply_changes(BASE, BASE, changes, set()) == (BASE, [])

    def test_everything_accepted_is_the_reviewers_text(self):
        changes = compute_changes(BASE, EDITED)
        assert apply_changes(BASE, BASE, changes, _all(changes)) == (EDITED, [])

    def test_a_subset_applies_only_those_changes(self):
        changes = compute_changes(BASE, EDITED)
        text, failed = apply_changes(BASE, BASE, changes, {"c2"})
        assert failed == []
        assert "three bids" in text
        assert "$3,950" in text
        assert "$3,900" not in text

    def test_entities_and_markup_in_the_text_survive(self):
        base = "<p>Fish &amp; chips <em>and</em> more</p>"
        edited = "<p>Fish &amp; chips <em>and</em> less &lt;5</p>"
        changes = compute_changes(base, edited)
        assert apply_changes(base, base, changes, _all(changes))[0] == edited

    def test_randomized_edits_always_round_trip(self):
        rng = random.Random(20261014)
        vocabulary = [
            "moved",
            "second",
            "budget",
            "hose",
            "<b>bold</b>",
            "$4,200",
            "—",
            "and",
        ]
        for _ in range(300):
            base = (
                "<p>" + " ".join(rng.choices(vocabulary, k=rng.randint(0, 14))) + "</p>"
            )
            edited = (
                "<p>" + " ".join(rng.choices(vocabulary, k=rng.randint(0, 14))) + "</p>"
            )
            changes = compute_changes(base, edited)
            assert apply_changes(base, base, changes, _all(changes)) == (edited, [])
            assert apply_changes(base, base, changes, set()) == (base, [])


class TestApplyToASectionThatChanged:
    def test_a_change_lands_where_its_surrounding_text_still_is(self):
        changes = compute_changes(BASE, EDITED)
        edited_since = BASE.replace("Hose", "Hoses and tools")
        text, failed = apply_changes(BASE, edited_since, changes, _all(changes))
        assert failed == []
        assert "Hoses and tools" in text
        assert "four quotes" in text
        assert "$3,950" in text

    def test_a_change_whose_text_was_edited_away_is_reported_and_nothing_is_applied(
        self,
    ):
        changes = compute_changes(BASE, EDITED)
        edited_since = BASE.replace("three bids", "five bids")
        text, failed = apply_changes(BASE, edited_since, changes, _all(changes))
        assert failed == ["c1"]
        assert text == edited_since

    def test_a_change_that_would_be_ambiguous_is_not_guessed(self):
        base = "<p>the vote was 5-1</p><p>the vote was 5-1</p>"
        edited = "<p>the vote was 5-1</p><p>the vote was 6-0</p>"
        changes = compute_changes(base, edited)
        assert len(changes) == 1
        edited_since = base + "<p>the vote was 5-1</p>"
        text, failed = apply_changes(base, edited_since, changes, _all(changes))
        assert failed == ["c1"]
        assert text == edited_since

    def test_unaccepted_changes_are_not_looked_for(self):
        changes = compute_changes(BASE, EDITED)
        edited_since = BASE.replace("three bids", "five bids")
        text, failed = apply_changes(BASE, edited_since, changes, {"c2"})
        assert failed == []
        assert "five bids" in text
        assert "$3,950" in text


class TestReanchoringIsConservative:
    def test_a_change_does_not_drift_to_a_look_alike_elsewhere(self):
        base = (
            "<p>The vote was 5-1 on the budget.</p><p>Later, another vote was 5-1.</p>"
        )
        edited = (
            "<p>The vote was 6-0 on the budget.</p><p>Later, another vote was 5-1.</p>"
        )
        changes = compute_changes(base, edited)
        # The paragraph the change was made to has since been deleted; the same
        # words now appear exactly once, in the other paragraph.
        edited_since = "<p>Later, another vote was 5-1.</p>"
        text, failed = apply_changes(base, edited_since, changes, _all(changes))
        assert failed == ["c1"]
        assert text == edited_since

    def test_a_change_with_context_that_has_moved_still_lands(self):
        changes = compute_changes(BASE, EDITED)
        moved = "<p>Intro sentence.</p>" + BASE
        text, failed = apply_changes(BASE, moved, changes, _all(changes))
        assert failed == []
        assert text.startswith("<p>Intro sentence.</p>")
        assert "four quotes" in text
