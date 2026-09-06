"""The garment style axes, and the canonical shape they settle attributes into.

The ten ``GarmentStyle`` values are four orthogonal descriptors, not ten
alternatives. Variant generation did not know that and took a flat cartesian
product over them, so a quartermaster describing one men's long-sleeve polo got
three items — one "Long Sleeve", one "Men's", one "Polo". These pin the rule
that replaced it, including the partition the whole thing rests on.
"""

import pytest

from app.utils.garment_styles import (
    GARMENT_STYLE_AXES,
    assert_axes_cover_enum,
    first_conflicting_axis,
    format_style_attributes,
    normalize_style_attributes,
    primary_style,
    style_combinations,
    style_label,
)

pytestmark = [pytest.mark.unit]


class TestTheTaxonomy:
    def test_the_axes_are_a_partition_of_the_enum(self):
        """A value in no axis silently drops out of the product; one in two
        axes multiplies against itself. Neither may happen."""
        assert_axes_cover_enum()

    def test_closure_is_its_own_axis(self):
        """A quarter-zip has a neckline too. Folding closure into neckline
        would make "crew neck quarter zip" two garments instead of one."""
        axes = {key: values for key, _label, values in GARMENT_STYLE_AXES}
        assert axes["closure"] == ("quarter_zip",)
        assert "quarter_zip" not in axes["neckline"]


class TestNormalization:
    def test_orders_canonically_regardless_of_click_order(self):
        assert normalize_style_attributes(["polo", "mens", "long_sleeve"]) == [
            "long_sleeve",
            "mens",
            "polo",
        ]

    def test_is_idempotent(self):
        once = normalize_style_attributes(["polo", "mens", "long_sleeve"])
        assert normalize_style_attributes(once) == once

    def test_dedupes_and_trims_and_lowercases(self):
        assert normalize_style_attributes([" Polo ", "polo"]) == ["polo"]

    def test_empty_becomes_none_not_an_empty_list(self):
        """ "No style" needs one representation: NULL. An empty list would be a
        second one that compares unequal to it (CLAUDE.md pitfall #20)."""
        assert normalize_style_attributes([]) is None
        assert normalize_style_attributes(None) is None
        assert normalize_style_attributes([None, ""]) is None

    def test_rejects_an_unknown_value(self):
        with pytest.raises(ValueError, match="Unknown garment style"):
            normalize_style_attributes(["cardigan"])

    def test_rejects_two_values_from_one_axis(self):
        """Silently keeping one would store a garment nobody described."""
        with pytest.raises(ValueError, match="Conflicting sleeve"):
            normalize_style_attributes(["short_sleeve", "long_sleeve"])


class TestPrimaryStyle:
    def test_the_screenshot_case_resolves_to_polo(self):
        """A quartermaster calls it a polo before a men's or a long-sleeve."""
        assert primary_style(["long_sleeve", "mens", "polo"]) == "polo"

    @pytest.mark.parametrize(
        "attributes,expected",
        [
            (["long_sleeve", "mens"], "long_sleeve"),
            (["mens"], "mens"),
            (["quarter_zip", "long_sleeve"], "quarter_zip"),
            (["crew_neck", "quarter_zip"], "crew_neck"),
            ([], None),
            (None, None),
        ],
    )
    def test_priority_is_by_axis(self, attributes, expected):
        assert primary_style(attributes) == expected


class TestLabels:
    def test_reads_as_english_not_as_storage_order(self):
        """Fit precedes sleeve in a name, though storage order is the reverse."""
        assert (
            format_style_attributes(["long_sleeve", "mens", "polo"])
            == "Men's Long Sleeve Polo"
        )

    def test_labels_are_proper_not_humanised_slugs(self):
        """`value.replace("_", " ").title()` — what the item namer used to
        do — yields "Mens" and "V Neck"."""
        assert style_label("mens") == "Men's"
        assert style_label("v_neck") == "V-Neck"

    def test_nothing_labels_as_nothing(self):
        assert format_style_attributes(None) is None
        assert format_style_attributes([]) is None


class TestCombinations:
    def test_one_pick_per_axis_is_one_garment(self):
        """The reported bug: this used to yield three combinations."""
        assert style_combinations(["long_sleeve", "mens", "polo"]) == [
            ["long_sleeve", "mens", "polo"]
        ]

    def test_two_picks_within_one_axis_still_multiply(self):
        assert style_combinations(["long_sleeve", "mens", "womens", "polo"]) == [
            ["long_sleeve", "mens", "polo"],
            ["long_sleeve", "womens", "polo"],
        ]

    def test_a_crew_neck_quarter_zip_is_one_garment(self):
        """The four-axis decision, stated as a test so it cannot be folded
        back into three without someone noticing."""
        assert style_combinations(["crew_neck", "quarter_zip"]) == [
            ["crew_neck", "quarter_zip"]
        ]

    def test_multiplies_across_several_axes_at_once(self):
        combos = style_combinations(
            ["short_sleeve", "long_sleeve", "mens", "womens", "polo"]
        )
        assert len(combos) == 4
        assert all(c is not None and "polo" in c for c in combos)

    def test_no_selection_is_one_style_less_garment(self):
        """[None], not [], so callers loop uniformly and get one item."""
        assert style_combinations([]) == [None]
        assert style_combinations(None) == [None]

    def test_every_combination_is_already_canonical(self):
        for combo in style_combinations(["polo", "mens", "short_sleeve"]):
            assert normalize_style_attributes(combo) == combo

    def test_rejects_an_unknown_value(self):
        with pytest.raises(ValueError, match="Unknown garment style"):
            style_combinations(["long_sleeve", "cardigan"])


class TestConflictDetection:
    def test_names_the_offending_axis(self):
        assert first_conflicting_axis(["mens", "womens"]) == "fit"
        assert first_conflicting_axis(["short_sleeve", "long_sleeve"]) == "sleeve"

    def test_a_legal_selection_has_no_conflict(self):
        assert first_conflicting_axis(["long_sleeve", "mens", "polo"]) is None
        assert first_conflicting_axis(None) is None
