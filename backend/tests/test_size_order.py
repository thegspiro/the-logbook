"""Size labels sort smallest-to-largest, not alphabetically."""

from app.utils.size_order import size_sort_key, sort_by_size


def _order(labels):
    return sort_by_size(labels, lambda label: label)


class TestAlphaSizes:
    def test_standard_run_sorts_by_size_not_alphabet(self):
        # Alphabetically this is L, M, S, XL, XS — the bug being fixed.
        assert _order(["XL", "S", "M", "XS", "L"]) == ["XS", "S", "M", "L", "XL"]

    def test_extended_sizes_extend_past_xl(self):
        assert _order(["3XL", "XL", "2XL", "L"]) == ["L", "XL", "2XL", "3XL"]

    def test_repeated_x_spelling_matches_numeric_spelling(self):
        assert size_sort_key("XXL", 0) == size_sort_key("2XL", 0)
        assert size_sort_key("XXXL", 0) == size_sort_key("3XL", 0)

    def test_small_end_extends_downward(self):
        assert _order(["S", "XS", "2XS", "3XS"]) == ["3XS", "2XS", "XS", "S"]

    def test_spelled_and_abbreviated_spellings_interleave(self):
        assert _order(["X-Large", "Small", "Medium", "Large", "Extra Small"]) == [
            "Extra Small",
            "Small",
            "Medium",
            "Large",
            "X-Large",
        ]

    def test_case_and_separators_are_ignored(self):
        for spelling in ("x large", "X-LARGE", "x_large", "XLarge"):
            assert size_sort_key(spelling, 0) == size_sort_key("XL", 0), spelling

    def test_length_modifier_sorts_within_its_base_size(self):
        assert _order(["LT", "M", "L", "MT", "S"]) == ["S", "M", "MT", "L", "LT"]


class TestNumericSizes:
    def test_boot_sizes_sort_numerically(self):
        assert _order(["12", "9", "8", "11"]) == ["8", "9", "11", "12"]

    def test_half_sizes_land_between_whole_sizes(self):
        # Regression: stripping the decimal point turned 10.5 into 105, which
        # sorted past every other size on the product.
        assert _order(["11", "10", "10.5"]) == ["10", "10.5", "11"]

    def test_waist_by_inseam_sorts_by_waist_then_inseam(self):
        assert _order(["34x32", "32x30", "34x30", "30x30"]) == [
            "30x30",
            "32x30",
            "34x30",
            "34x32",
        ]

    def test_numeric_sizes_group_after_alpha_sizes(self):
        assert _order(["32", "L", "S"]) == ["S", "L", "32"]


class TestNonSizeLabels:
    def test_colors_keep_their_entered_order(self):
        # A variant list is not always sizes; inventing an order for colors
        # would scramble a deliberate one.
        assert _order(["Navy", "Red", "Black"]) == ["Navy", "Red", "Black"]

    def test_colors_sort_after_real_sizes(self):
        assert _order(["Navy", "L", "S", "Red", "M"]) == [
            "S",
            "M",
            "L",
            "Navy",
            "Red",
        ]

    def test_compound_label_is_sized_by_its_first_segment(self):
        assert _order(["L / Navy", "S / Navy", "M / Navy"]) == [
            "S / Navy",
            "M / Navy",
            "L / Navy",
        ]

    def test_blank_and_missing_labels_do_not_raise(self):
        assert _order(["", "M", "S", None]) == ["S", "M", "", None]

    def test_sort_is_stable_for_equal_ranks(self):
        assert _order(["2XL", "XXL"]) == ["2XL", "XXL"]
        assert _order(["XXL", "2XL"]) == ["XXL", "2XL"]


class TestExtendedSizesUseTheSameScale:
    """Computed ranks must land on the same scale as the spelled-out ones.

    ``2XS`` and ``3XS`` are explicit entries at 20 and 10. Stepping the
    extension rule by 1 instead of by ``_SIZE_STEP`` put ``4XS`` at 27 —
    between 2XS and XS rather than below every one of them.
    """

    def test_four_extra_small_sorts_below_the_spelled_out_ranks(self):
        assert _order(["XS", "2XS", "3XS", "4XS"]) == ["4XS", "3XS", "2XS", "XS"]

    def test_the_small_end_keeps_descending(self):
        assert _order(["S", "XS", "2XS", "3XS", "4XS", "5XS"]) == [
            "5XS",
            "4XS",
            "3XS",
            "2XS",
            "XS",
            "S",
        ]

    def test_the_large_end_keeps_ascending(self):
        assert _order(["4XL", "XL", "2XL", "L", "3XL"]) == [
            "L",
            "XL",
            "2XL",
            "3XL",
            "4XL",
        ]

    def test_computed_rank_agrees_with_the_explicit_entry(self):
        # 2XS/3XS are in the table; XXS/XXXS take the computed path. They must
        # not disagree, or the same size sorts two ways depending on spelling.
        assert size_sort_key("XXS", 0) == size_sort_key("2XS", 0)
        assert size_sort_key("XXXS", 0) == size_sort_key("3XS", 0)

    def test_a_length_modifier_still_sorts_inside_an_extended_size(self):
        assert _order(["3XL", "2XLT", "2XL"]) == ["2XL", "2XLT", "3XL"]
