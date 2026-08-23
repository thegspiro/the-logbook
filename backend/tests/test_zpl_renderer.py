"""
Tests for the native ZPL renderer (app/utils/zpl_renderer.py).

No printer and no database: the renderer is a pure function from label specs
to a ZPL string, so these assert on the emitted commands directly. The
properties that matter are the ones a person cannot check by looking at the
output — that dimensions track the printer's resolution, that a caret in an
item name cannot become a command, and that the barcode never gets narrower
than a scanner can read.
"""

import re

import pytest

from app.utils.label_renderer import LABEL_FORMATS, MIN_BAR_WIDTH_INCH, LabelSpec
from app.utils.zpl_renderer import (
    MAX_DARKNESS,
    SUPPORTED_DPI,
    code128_width_dots,
    render_zpl,
    resolve_label_size,
)


def _spec(**kwargs):
    base = {"name": "Helmet", "barcode_value": "INV-000123"}
    base.update(kwargs)
    return LabelSpec(**base)


def _field_data(zpl: str) -> list:
    """Every ^FD...^FS payload in the program, in order."""
    return re.findall(r"\^FD(.*?)\^FS", zpl)


class TestProgramStructure:
    def test_one_format_block_per_spec(self):
        zpl = render_zpl([_spec(), _spec(name="Boots", barcode_value="INV-2")])
        assert zpl.count("^XA") == 2
        assert zpl.count("^XZ") == 2

    def test_starts_and_ends_with_the_format_delimiters(self):
        zpl = render_zpl([_spec()])
        assert zpl.startswith("^XA")
        assert zpl.endswith("^XZ")

    def test_emits_a_code128_barcode_field(self):
        zpl = render_zpl([_spec()])
        assert "^BCN," in zpl
        assert "INV-000123" in zpl

    def test_name_is_printed(self):
        zpl = render_zpl([_spec(name="Ladder Belt")])
        assert "Ladder Belt" in zpl


class TestDimensions:
    def test_print_width_and_length_track_dpi(self):
        # zebra_2x1 is 2" x 1"; at 203 dpi that is 406 x 203 dots.
        zpl = render_zpl([_spec()], "zebra_2x1", dpi=203)
        assert "^PW406" in zpl
        assert "^LL203" in zpl

    def test_same_label_at_300_dpi_is_proportionally_larger(self):
        zpl = render_zpl([_spec()], "zebra_2x1", dpi=300)
        assert "^PW600" in zpl
        assert "^LL300" in zpl

    @pytest.mark.parametrize("dpi", SUPPORTED_DPI)
    def test_every_supported_dpi_renders(self, dpi):
        assert render_zpl([_spec()], "zebra_4x2", dpi=dpi).startswith("^XA")

    def test_unsupported_dpi_is_rejected(self):
        with pytest.raises(ValueError, match="Unsupported printer resolution"):
            render_zpl([_spec()], dpi=204)

    def test_custom_size_uses_the_given_inches(self):
        zpl = render_zpl(
            [_spec()], "custom", custom_width=3.0, custom_height=2.0, dpi=203
        )
        assert "^PW609" in zpl
        assert "^LL406" in zpl


class TestEscaping:
    """ZPL's control characters must never reach the parser as themselves."""

    def test_caret_in_a_name_is_hex_escaped(self):
        zpl = render_zpl([_spec(name="Ladder ^ Hook")])
        assert "Ladder _5E Hook" in zpl
        # The literal caret would have started a new command mid-field.
        assert "Ladder ^ Hook" not in zpl

    def test_tilde_in_a_name_is_hex_escaped(self):
        zpl = render_zpl([_spec(name="Hose ~ 50ft")])
        assert "Hose _7E 50ft" in zpl

    def test_underscore_is_escaped_before_the_others(self):
        # Escaping "^" to "_5E" first and only then escaping "_" would
        # double-encode the escape sequence itself.
        zpl = render_zpl([_spec(name="A_B")])
        assert "A_5FB" in zpl

    def test_escaped_fields_declare_the_hex_indicator(self):
        # ^FH is what makes _5E mean "^" rather than a literal underscore-5-E.
        zpl = render_zpl([_spec(name="A^B")])
        for match in re.finditer(r"\^FD", zpl):
            preceding = zpl[: match.start()]
            assert preceding.endswith("^FH"), "every ^FD field must be preceded by ^FH"

    def test_caret_in_a_barcode_value_is_escaped_too(self):
        # sanitize_barcode_value only strips non-ASCII, so a caret survives
        # into the barcode field and must be escaped there as well.
        zpl = render_zpl([_spec(barcode_value="AB^CD")])
        assert "AB_5ECD" in zpl

    def test_non_ascii_is_dropped_from_text(self):
        zpl = render_zpl([_spec(name="Hose 50° Nozzle")])
        assert "°" not in zpl
        assert "Hose 50 Nozzle" in zpl


class TestSubIdentifiers:
    def test_asset_tag_and_serial_are_shown(self):
        zpl = render_zpl([_spec(asset_tag="A-77", serial_number="SN9")])
        assert "Asset: A-77" in zpl
        assert "S/N: SN9" in zpl

    def test_asset_tag_equal_to_the_barcode_is_not_repeated(self):
        zpl = render_zpl([_spec(asset_tag="INV-000123")])
        assert "Asset:" not in zpl

    def test_extra_line_is_printed(self):
        zpl = render_zpl([_spec(extra="Station 1 | PPE")], "zebra_4x2")
        assert "Station 1 | PPE" in zpl


class TestBarcodeSizing:
    def test_module_width_never_drops_below_the_scannable_floor(self):
        # One dot at 203 dpi is 4.9 mil — the same physical floor the PDF
        # renderer enforces, and the narrowest a handheld scanner reads.
        zpl = render_zpl([_spec(barcode_value="A" * 12)], "zebra_2x1", dpi=203)
        module = int(re.search(r"\^BY(\d+),", zpl).group(1))
        assert module >= 1
        assert module / 203 >= MIN_BAR_WIDTH_INCH * 0.99

    def test_higher_resolution_raises_the_module_floor(self):
        # One dot at 600 dpi is 1.7 mil — unreadable. The floor is expressed in
        # inches, so it costs more dots on a finer printer.
        zpl = render_zpl([_spec(barcode_value="A" * 12)], "zebra_2x1", dpi=600)
        module = int(re.search(r"\^BY(\d+),", zpl).group(1))
        assert module / 600 >= MIN_BAR_WIDTH_INCH * 0.99

    def test_symbol_fits_inside_the_label(self):
        value = "INV-000123"
        zpl = render_zpl([_spec(barcode_value=value)], "zebra_2x1", dpi=203)
        module = int(re.search(r"\^BY(\d+),", zpl).group(1))
        width = code128_width_dots(value, module)
        # 406 dots wide less 12 dots of padding per side.
        assert width <= 406 - 24

    def test_value_too_long_for_the_label_is_rejected(self):
        with pytest.raises(ValueError, match="too long for the selected label size"):
            render_zpl([_spec(barcode_value="Y" * 80)], "thermal_1x1")

    def test_width_grows_with_the_value(self):
        assert code128_width_dots("AAAA", 2) > code128_width_dots("AA", 2)

    def test_barcode_is_horizontally_centred(self):
        value = "INV-1"
        zpl = render_zpl([_spec(barcode_value=value)], "zebra_4x2", dpi=203)
        module = int(re.search(r"\^BY(\d+),", zpl).group(1))
        x = int(re.search(r"\^FO(\d+),\d+\^BCN", zpl).group(1))
        content_width = 4 * 203 - 2 * 12
        expected = 12 + (content_width - code128_width_dots(value, module)) // 2
        assert x == expected


class TestPrinterOptions:
    def test_copies_emit_a_print_quantity(self):
        zpl = render_zpl([_spec()], copies=3)
        assert "^PQ3,0,0,N" in zpl

    def test_a_single_copy_omits_the_quantity_command(self):
        # ^PQ1 is the printer's default; emitting it adds noise, not behaviour.
        assert "^PQ" not in render_zpl([_spec()], copies=1)

    def test_darkness_is_emitted_when_set(self):
        assert "^MD7" in render_zpl([_spec()], darkness=7)

    def test_darkness_is_omitted_when_unset(self):
        # Null means "leave the printer's own setting alone".
        assert "^MD" not in render_zpl([_spec()], darkness=None)

    def test_darkness_out_of_range_is_rejected(self):
        with pytest.raises(ValueError, match="darkness must be between"):
            render_zpl([_spec()], darkness=MAX_DARKNESS + 1)

    def test_copies_out_of_range_is_rejected(self):
        with pytest.raises(ValueError, match="copies must be between"):
            render_zpl([_spec()], copies=0)


class TestFormatResolution:
    def test_sheet_layouts_cannot_be_sent_to_a_label_printer(self):
        # A roll-fed printer has no page to lay an Avery grid on; printing one
        # would burn 30 labels off the roll.
        with pytest.raises(ValueError, match="paper sheet layout"):
            resolve_label_size("letter")

    def test_unknown_format_is_rejected(self):
        with pytest.raises(ValueError, match="Unknown label format"):
            resolve_label_size("not_a_format")

    def test_custom_without_dimensions_is_rejected(self):
        with pytest.raises(ValueError, match="custom_width and custom_height"):
            resolve_label_size("custom")

    def test_custom_out_of_range_is_rejected(self):
        with pytest.raises(ValueError, match="0.5-8 inches"):
            resolve_label_size("custom", custom_width=20.0, custom_height=1.0)

    @pytest.mark.parametrize(
        "key", [k for k, v in LABEL_FORMATS.items() if v.get("type") == "thermal"]
    )
    def test_every_thermal_format_resolves_and_renders(self, key):
        width, height = resolve_label_size(key)
        assert width > 0
        assert height > 0
        assert render_zpl([_spec()], key).startswith("^XA")

    def test_the_zebra_presets_are_registered(self):
        for key in ("zebra_2x1", "zebra_3x1", "zebra_4x2", "zebra_4x6"):
            assert key in LABEL_FORMATS
            assert LABEL_FORMATS[key]["type"] == "thermal"


class TestValidation:
    def test_no_specs_is_rejected(self):
        with pytest.raises(ValueError, match="At least one label"):
            render_zpl([])

    def test_a_spec_with_no_scannable_value_is_rejected(self):
        with pytest.raises(ValueError, match="no Code128-compatible barcode value"):
            render_zpl([_spec(barcode_value="☃")])

    def test_content_too_tall_for_the_label_is_rejected(self):
        # A 1x1 square with three text lines above the barcode leaves no room
        # for bars a scanner could read; that is a rejection, not a squeeze.
        with pytest.raises(ValueError, match="too small for the selected content"):
            render_zpl(
                [
                    _spec(
                        barcode_value="A1",
                        asset_tag="A-1",
                        serial_number="S-1",
                        extra="Station 1",
                    )
                ],
                "custom",
                custom_width=1.4,
                custom_height=0.5,
            )

    def test_field_data_is_never_empty_for_a_rendered_label(self):
        assert all(_field_data(render_zpl([_spec()])))
