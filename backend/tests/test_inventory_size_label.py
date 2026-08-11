"""
Variant items are named from the size *code* the picker submits ("l", "xxl"),
so the name builder has to render the display form or the department ends up
with a "Structural Coat — l" on every shelf, label and pick list. Pure
function; no DB.
"""

from app.services.inventory_service import _size_label


class TestSizeLabel:
    def test_letter_sizes_upper_case(self):
        assert _size_label("s") == "S"
        assert _size_label("l") == "L"
        assert _size_label("xl") == "XL"

    def test_multi_letter_sizes_use_their_short_form(self):
        # XXXL reads as 3XL on the picker, so the item name should match.
        assert _size_label("xxl") == "XXL"
        assert _size_label("xxxl") == "3XL"
        assert _size_label("xxxxl") == "4XL"

    def test_word_sizes_are_title_cased(self):
        assert _size_label("one_size") == "One Size"
        assert _size_label("custom") == "Custom"

    def test_numeric_sizes_pass_through(self):
        # Boot and waist sizes; upper-casing is a no-op but half sizes must
        # keep their decimal point.
        assert _size_label("10") == "10"
        assert _size_label("10.5") == "10.5"
        assert _size_label("34") == "34"

    def test_blank_size_is_blank(self):
        assert _size_label("") == ""
        assert _size_label(None) == ""

    def test_already_display_form_is_left_alone(self):
        assert _size_label("L") == "L"
        assert _size_label("One Size") == "One Size"
