"""Fuzzy name matching: alike words, aliases, and what must never be "exact".

``match_score`` used to compare whole words only, so "Gauze Pad" against
"Gauze Pads" lost the shared word, "4 x 4" never met "4x4", and a manufacturer's
spelling of one word cost the whole name. The checklist builder proposes catalog
links from these scores, and its review screen pre-selects only an ``EXACT``
match, so two things have to hold however fuzzy the matching gets: a match that
merely resembles is never ``EXACT``, and a word that carries a number or a size
never matches a different one.
"""

import pytest

from app.utils.name_matching import (
    EXACT,
    STRONG,
    WEAK,
    best_matches,
    confidence_for,
    match_candidate,
    match_score,
)

pytestmark = pytest.mark.unit


class TestAlikeWords:
    def test_a_plural_matches_its_singular(self):
        assert match_score("Gauze Pad", "Gauze Pads") >= 0.75
        assert match_score("Tourniquet", "Tourniquets") >= 0.75

    def test_plurals_fold_in_the_forms_supply_names_use(self):
        # -es after a sibilant, -ies, and a plain -s all land on the singular.
        assert match_score("Storage Box", "Storage Boxes") >= 0.75
        assert match_score("Battery", "Batteries") >= 0.75
        assert match_score("Glove", "Gloves") >= 0.75

    def test_a_dimension_matches_however_it_is_spaced(self):
        score = match_score("4 x 4 Gauze", "Gauze Pads 4x4 Sterile")
        assert confidence_for(score) == STRONG

    def test_a_near_spelling_matches(self):
        score = match_score("Defibrillator Pads", "Defibrilator Pad")
        assert confidence_for(score) == STRONG
        assert score < 1.0

    def test_a_longer_form_of_a_word_matches(self):
        # Only "compress"/"compression" can account for the second word, so the
        # score has to clear what the single shared word would give on its own.
        score = match_score("Trauma Compress", "Trauma Compression Dressing")
        assert score > 0.5

    def test_exact_words_outrank_merely_alike_ones(self):
        spelled_alike = match_score("Defibrillator Pads", "Defibrilator Pads Adult")
        spelled_same = match_score("Defibrillator Pads", "Defibrillator Pads Adult")
        assert spelled_same > spelled_alike > 0


class TestWhatMustStayApart:
    @pytest.mark.parametrize(
        ("a", "b"),
        [
            ("Gauze Pads 4x4", "Gauze Pads 4x8"),
            ("Gauze Pads 4x4 Sterile", "Gauze Pads 2x2 Sterile"),
            ("Backboard Strap 3", "Backboard Strap 4"),
            ("Lidocaine 2%", "Lidocaine 4%"),
        ],
    )
    def test_a_word_with_a_number_must_match_exactly(self, a, b):
        assert confidence_for(match_score(a, b)) == WEAK

    def test_adult_and_pediatric_stay_siblings(self):
        score = match_score("Oxygen Mask Adult", "Oxygen Mask Pediatric")
        assert confidence_for(score) == WEAK

    @pytest.mark.parametrize(
        ("a", "b"), [("Small Gloves", "Smell Gloves"), ("Medium Gown", "Median Gown")]
    )
    def test_look_alike_sizes_and_words_are_not_pulled_together(self, a, b):
        assert confidence_for(match_score(a, b)) == WEAK

    def test_one_shared_common_word_is_still_not_a_match(self):
        assert match_score("Trauma Bag", "Bag Valve Mask") < 0.34

    def test_short_words_are_never_fuzzy_matched(self):
        # "XL" and "XS", or "L" and "S", differ by one letter and mean opposites.
        assert match_score("Gloves XL", "Gloves XS") < 0.75


class TestNothingFuzzyIsExact:
    """EXACT is what the review screen pre-selects, so it has to stay narrow."""

    @pytest.mark.parametrize(
        ("a", "b"),
        [
            ("Gauze Pad", "Gauze Pads"),
            ("Defibrillator Pads", "Defibrilator Pads"),
            ("4 x 4 Gauze", "4x4 Gauze"),
            ("Storage Box", "Storage Boxes"),
        ],
    )
    def test_resembling_is_not_identical(self, a, b):
        score = match_score(a, b)
        assert 0 < score < 1.0
        assert confidence_for(score) != EXACT

    def test_names_made_of_the_same_words_are_still_exact(self):
        # Pins existing behaviour: a reordering is the same name.
        assert match_score("Gauze 4x4", "4x4 Gauze") == 1.0
        assert match_score("4x4 Gauze", "4X4 GAUZE") == 1.0

    def test_scoring_is_symmetric_for_fuzzy_pairs_too(self):
        pairs = [
            ("Defibrillator Pads Adult", "Defibrilator Pad"),
            ("4 x 4 Gauze", "Gauze Pads 4x4 Sterile"),
            ("Nitrile Gloves Large", "Gloves, Nitrile, Lg"),
        ]
        for a, b in pairs:
            assert match_score(a, b) == match_score(b, a)


class TestAliases:
    def test_an_alias_makes_an_abbreviation_findable(self):
        score, alias = match_candidate("BVM", "Bag Valve Mask", ["BVM"])
        assert alias == "BVM"
        assert confidence_for(score) == STRONG

    def test_the_name_wins_when_it_matches_better(self):
        score, alias = match_candidate("Bag Valve Mask", "Bag Valve Mask", ["BVM"])
        assert alias is None
        assert score == 1.0

    def test_a_match_through_an_alias_is_never_exact(self):
        # Two items can carry the same alias, and a person typed it.
        score, _alias = match_candidate("BVM", "Bag Valve Mask", ["BVM"])
        assert score < 1.0
        assert confidence_for(score) != EXACT

    def test_aliases_are_matched_fuzzily_too(self):
        score, alias = match_candidate("Ambu Bags", "Bag Valve Mask", ["Ambu Bag"])
        assert alias == "Ambu Bag"
        assert score > 0

    @pytest.mark.parametrize("junk", [None, "BVM", 7, {"a": 1}, [None, 3, ""]])
    def test_a_stored_value_that_is_not_a_list_of_text_is_ignored(self, junk):
        # The column is untyped JSON; a search must not raise over bad data.
        score, alias = match_candidate("Trauma Shears", "Oxygen Cylinder", junk)
        assert (score, alias) == (0.0, None)


class TestBestMatchesWithAliases:
    CATALOG = [
        ("inv-1", "Bag Valve Mask", ["BVM", "Ambu bag"]),
        ("inv-2", "Bag Valve Mask Adult", None),
        ("inv-3", "Trauma Bag"),
    ]

    def test_two_and_three_part_candidates_can_be_mixed(self):
        results = best_matches("Trauma Bag", self.CATALOG)
        assert results[0]["id"] == "inv-3"
        assert results[0]["confidence"] == EXACT

    def test_the_alias_that_matched_is_reported(self):
        results = best_matches("BVM", self.CATALOG)
        assert results[0]["id"] == "inv-1"
        assert results[0]["matched_alias"] == "BVM"

    def test_a_name_match_reports_no_alias(self):
        results = best_matches("Bag Valve Mask Adult", self.CATALOG)
        assert results[0]["id"] == "inv-2"
        assert "matched_alias" not in results[0]

    def test_a_fuzzy_match_is_offered_but_never_as_exact(self):
        results = best_matches("Gauze Pad 4x4", [("g", "Gauze Pads 4x4")])
        assert results[0]["id"] == "g"
        assert results[0]["confidence"] != EXACT
