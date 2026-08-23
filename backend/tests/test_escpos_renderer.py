"""
Tests for the ESC/POS renderer (app/utils/escpos_renderer.py).

ESC/POS is binary, so these assert on bytes rather than on readable commands.
The two properties worth the most here are the ones that fail silently on real
hardware: a payload that is text-encoded somewhere along the way (which mangles
every byte above 0x7F), and a barcode value containing a brace (which the
Code 128 code-set selector would otherwise swallow).
"""

import pytest

from app.utils.escpos_renderer import (
    ESCPOS_PAPER,
    is_escpos_paper,
    paper_width_dots,
    render_escpos,
)
from app.utils.label_renderer import SYMBOLOGY_QR, LabelSpec

_GS = b"\x1d"
_ESC = b"\x1b"


def _spec(**kwargs):
    base = {"name": "Helmet", "barcode_value": "INV-000123"}
    base.update(kwargs)
    return LabelSpec(**base)


class TestOutputShape:
    def test_returns_bytes_not_text(self):
        # The whole reason this renderer exists separately: encoding ESC/POS
        # as UTF-8 turns every byte above 0x7F into two and corrupts the job.
        assert isinstance(render_escpos([_spec()]), bytes)

    def test_starts_by_resetting_the_printer(self):
        # Without ESC @ the job inherits whatever mode the last one left set.
        assert render_escpos([_spec()]).startswith(_ESC + b"@")

    def test_ends_with_a_cut(self):
        assert render_escpos([_spec()]).endswith(_GS + b"VB\x00")

    def test_cutting_can_be_turned_off(self):
        out = render_escpos([_spec()], cut=False)
        assert not out.endswith(_GS + b"VB\x00")

    def test_one_block_per_label(self):
        out = render_escpos([_spec(), _spec(name="Boots", barcode_value="INV-2")])
        assert out.count(_ESC + b"@") == 2

    def test_copies_repeat_the_block(self):
        # A receipt printer has no print-quantity command, so copies are
        # repeated blocks rather than a counter.
        assert render_escpos([_spec()], copies=3).count(_ESC + b"@") == 3

    def test_the_name_is_printed(self):
        assert b"Helmet" in render_escpos([_spec()])


class TestPaperSizes:
    @pytest.mark.parametrize("paper", list(ESCPOS_PAPER))
    def test_every_paper_size_renders(self, paper):
        assert render_escpos([_spec()], paper).startswith(_ESC + b"@")

    def test_the_two_common_rolls_are_registered(self):
        assert is_escpos_paper("escpos_58mm")
        assert is_escpos_paper("escpos_80mm")

    def test_80mm_is_wider_than_58mm(self):
        assert paper_width_dots("escpos_80mm") > paper_width_dots("escpos_58mm")

    def test_a_die_cut_label_size_is_not_receipt_paper(self):
        # Receipt stock is continuous; a Zebra die-cut size means nothing here.
        assert not is_escpos_paper("zebra_2x1")
        with pytest.raises(
            ValueError, match="not a receipt paper size|Unknown receipt"
        ):
            render_escpos([_spec()], "zebra_2x1")


class TestCode128:
    def test_emits_the_barcode_command(self):
        out = render_escpos([_spec()])
        # GS k 73 — Code 128 in the length-prefixed form.
        assert _GS + b"kI" in out

    def test_the_payload_carries_a_code_set_selector(self):
        assert b"{BINV-000123" in render_escpos([_spec()])

    def test_a_brace_in_the_value_is_doubled(self):
        # "{" starts a code-set selector, so a bare one would change the
        # encoded value rather than appear in it.
        assert b"{BA{{B" in render_escpos([_spec(barcode_value="A{B")])

    def test_the_declared_length_matches_the_payload(self):
        out = render_escpos([_spec(barcode_value="INV-1")])
        index = out.index(_GS + b"kI")
        declared = out[index + 3]
        payload = out[index + 4 : index + 4 + declared]
        assert payload == b"{BINV-1"

    def test_a_value_too_wide_for_the_paper_is_rejected(self):
        with pytest.raises(ValueError, match="too long for"):
            render_escpos([_spec(barcode_value="Y" * 60)], "escpos_58mm")

    def test_wider_paper_accepts_a_longer_value(self):
        # 58mm holds about 12 characters of Code 128 at a scannable module
        # width and 80mm about 21 — narrow receipt stock is genuinely tight,
        # which is why QR is the better choice on it.
        value = "Y" * 15
        with pytest.raises(ValueError, match="too long for"):
            render_escpos([_spec(barcode_value=value)], "escpos_58mm")
        assert render_escpos([_spec(barcode_value=value)], "escpos_80mm")

    def test_qr_holds_what_code128_cannot_on_narrow_paper(self):
        value = "INV-000123456789"
        with pytest.raises(ValueError, match="too long for"):
            render_escpos([_spec(barcode_value=value)], "escpos_58mm")
        assert render_escpos(
            [_spec(barcode_value=value)], "escpos_58mm", symbology=SYMBOLOGY_QR
        )


class TestQr:
    def test_emits_the_2d_function_group(self):
        assert _GS + b"(k" in render_escpos([_spec()], symbology=SYMBOLOGY_QR)

    def test_does_not_emit_a_linear_barcode(self):
        assert _GS + b"kI" not in render_escpos([_spec()], symbology=SYMBOLOGY_QR)

    def test_the_value_is_stored_and_printed(self):
        out = render_escpos([_spec(barcode_value="INV-1")], symbology=SYMBOLOGY_QR)
        assert b"1P0INV-1" in out  # store
        assert _GS + b"(k\x03\x001Q0" in out  # print

    def test_a_human_readable_line_accompanies_it(self):
        # A QR has no interpretation line of its own.
        out = render_escpos([_spec(barcode_value="INV-000123")], symbology=SYMBOLOGY_QR)
        assert b"INV-000123" in out.split(b"1P0")[-1]

    def test_the_store_length_prefix_is_two_bytes(self):
        out = render_escpos([_spec(barcode_value="INV-1")], symbology=SYMBOLOGY_QR)
        index = out.index(b"1P0")
        low, high = out[index - 2], out[index - 1]
        assert low + (high << 8) == len(b"INV-1") + 3


class TestSubIdentifiers:
    def test_asset_tag_and_serial_are_shown(self):
        out = render_escpos([_spec(asset_tag="A-77", serial_number="SN9")])
        assert b"Asset: A-77" in out
        assert b"S/N: SN9" in out

    def test_an_asset_tag_equal_to_the_barcode_is_not_repeated(self):
        assert b"Asset:" not in render_escpos([_spec(asset_tag="INV-000123")])

    def test_non_ascii_is_dropped(self):
        out = render_escpos([_spec(name="Hose 50° Nozzle")])
        assert b"Hose 50 Nozzle" in out


class TestValidation:
    def test_no_specs_is_rejected(self):
        with pytest.raises(ValueError, match="At least one label"):
            render_escpos([])

    def test_a_value_with_no_scannable_characters_is_rejected(self):
        with pytest.raises(ValueError, match="no Code128-compatible"):
            render_escpos([_spec(barcode_value="☃")])

    def test_an_unknown_symbology_is_rejected(self):
        with pytest.raises(ValueError, match="Unknown barcode symbology"):
            render_escpos([_spec()], symbology="datamatrix")

    def test_copies_out_of_range_is_rejected(self):
        with pytest.raises(ValueError, match="copies must be between"):
            render_escpos([_spec()], copies=0)
