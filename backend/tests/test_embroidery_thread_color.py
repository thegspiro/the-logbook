"""The embroidery thread color is a quartermaster setting, not a fixed gold."""

import pytest

from app.utils.embroidery import (
    DEFAULT_THREAD_COLOR,
    DEFAULT_THREAD_COLOR_HEX,
    EmbroideryThreadColor,
    normalize_thread_color,
    thread_color_hex,
    thread_color_label,
    thread_color_palette,
)


class TestNormalization:
    def test_missing_value_means_the_historical_gold(self):
        # A product predating the setting stores NULL, and must keep looking
        # exactly as it did before the setting existed.
        assert normalize_thread_color(None) is DEFAULT_THREAD_COLOR
        assert normalize_thread_color("") is DEFAULT_THREAD_COLOR
        assert DEFAULT_THREAD_COLOR is EmbroideryThreadColor.GOLD

    def test_an_enum_member_round_trips(self):
        # Regression: str() on a (str, Enum) member yields
        # "EmbroideryThreadColor.WHITE", not "white", so re-normalizing an
        # already-normalized value silently fell back to gold.
        for color in EmbroideryThreadColor:
            assert normalize_thread_color(color) is color
            assert thread_color_hex(color) == thread_color_hex(color.value)

    def test_casing_and_padding_are_tolerated(self):
        assert normalize_thread_color("  WHITE ") is EmbroideryThreadColor.WHITE

    def test_a_retired_value_degrades_rather_than_raising(self):
        # Read on every storefront render: an unrecognized value should cost a
        # shade of thread in a preview, not the whole store page.
        assert normalize_thread_color("chartreuse") is DEFAULT_THREAD_COLOR


class TestPalette:
    def test_every_color_has_a_distinct_renderable_hex(self):
        hexes = [thread_color_hex(c) for c in EmbroideryThreadColor]
        assert len(set(hexes)) == len(hexes)
        for value in hexes:
            assert value.startswith("#")
            assert len(value) == 7

    def test_every_color_has_a_label_for_the_vendor_sheet(self):
        for color in EmbroideryThreadColor:
            assert thread_color_label(color).strip()

    def test_default_hex_constant_is_derived_not_retyped(self):
        assert DEFAULT_THREAD_COLOR_HEX == thread_color_hex(DEFAULT_THREAD_COLOR)

    def test_palette_covers_the_whole_enum(self):
        assert [entry["value"] for entry in thread_color_palette()] == [
            color.value for color in EmbroideryThreadColor
        ]

    @pytest.mark.parametrize("color", list(EmbroideryThreadColor))
    def test_palette_entries_agree_with_the_lookup_helpers(self, color):
        entry = next(e for e in thread_color_palette() if e["value"] == color.value)
        assert entry["hex"] == thread_color_hex(color)
        assert entry["label"] == thread_color_label(color)
