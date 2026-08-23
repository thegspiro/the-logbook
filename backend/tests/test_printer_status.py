"""
Tests for the printer status parsers (app/utils/printer_status.py).

The governing rule these lock in: **a wrong specific diagnosis is worse than no
diagnosis.** Telling a quartermaster a direct-thermal printer is out of ribbon
sends them looking for a part it does not have. So the cases that matter most
here are the ones where the parser must decline to guess — an unrecognised
fault bit, firmware that does not answer the query, and a reply from something
that is not a printer at all.
"""

from app.utils.printer_status import (
    is_escpos_status_byte,
    parse_error_status,
    parse_host_identification,
    summarize,
    summarize_escpos,
)

IDENTITY = "\x02ZTC ZD420-203dpi ZPL,V93.20.15Z,8,4194304\x03\r\n"


def _status(errors: str = "0 00000000 00000000", warnings: str = "0 00000000 00000000"):
    return (
        "\x02\r\nPRINTER STATUS\r\n"
        f" ERRORS:         {errors}\r\n"
        f" WARNINGS:       {warnings}\r\n"
        "\x03"
    )


class TestHostIdentification:
    def test_reads_model_firmware_and_resolution(self):
        result = parse_host_identification(IDENTITY)
        assert result is not None
        assert result["model"] == "ZTC ZD420-203dpi ZPL"
        assert result["firmware"] == "V93.20.15Z"
        assert result["dpi"] == 203

    def test_reads_a_300_dpi_printer(self):
        result = parse_host_identification(
            "\x02ZTC ZD620-300dpi ZPL,V93.20.15Z,16,8388608\x03"
        )
        assert result is not None
        assert result["dpi"] == 300

    def test_a_non_printer_banner_is_not_identified(self):
        # Port 9100 can be held by anything. Reporting an SSH banner as a
        # printer model would turn a wrong-address mistake into a confident
        # wrong answer.
        assert parse_host_identification("SSH-2.0-OpenSSH_8.9\r\n") is None

    def test_silence_is_not_identified(self):
        assert parse_host_identification("") is None

    def test_missing_resolution_is_reported_as_unknown(self):
        # Rather than defaulting to 203, which would silently print every
        # label at the wrong physical size on a 300 dpi unit.
        result = parse_host_identification("\x02SOME ZPL PRINTER,V1.0.0\x03")
        assert result is not None
        assert result["dpi"] is None


class TestErrorStatus:
    def test_a_healthy_printer_reports_nothing(self):
        result = parse_error_status(_status())
        assert result == {"errors": [], "warnings": []}

    def test_media_out_is_named(self):
        result = parse_error_status(_status(errors="1 00000000 00000001"))
        assert result is not None
        assert result["errors"] == ["Out of labels"]

    def test_multiple_faults_are_all_named(self):
        result = parse_error_status(_status(errors="1 00000000 00000005"))
        assert result is not None
        assert result["errors"] == ["Out of labels", "Printhead open"]

    def test_a_warning_is_separated_from_an_error(self):
        result = parse_error_status(_status(warnings="1 00000000 00000002"))
        assert result is not None
        assert result["errors"] == []
        assert result["warnings"] == ["Printhead needs cleaning"]

    def test_an_unrecognised_fault_bit_is_reported_generically(self):
        # The flag says something is wrong. Dropping it because the bit is not
        # in the table would report a faulted printer as healthy — the exact
        # failure this whole feature exists to stop.
        result = parse_error_status(_status(errors="1 00000000 00008000"))
        assert result is not None
        assert result["errors"] == ["Printer reports an error"]

    def test_firmware_without_the_query_reports_unknown_not_healthy(self):
        # ~HQES is absent on older firmware. None means "it did not tell us",
        # which must not be rendered as "no faults".
        assert parse_error_status(IDENTITY) is None

    def test_silence_reports_unknown(self):
        assert parse_error_status("") is None


class TestSummarize:
    def test_a_healthy_printer(self):
        result = summarize(IDENTITY + _status())
        assert result["responded"] is True
        assert result["identified"] is True
        assert result["model"] == "ZTC ZD420-203dpi ZPL"
        assert result["reported_dpi"] == 203
        assert result["errors"] == []
        assert result["status_available"] is True

    def test_a_printer_that_cannot_print(self):
        result = summarize(IDENTITY + _status(errors="1 00000000 00000001"))
        assert result["errors"] == ["Out of labels"]

    def test_a_device_that_never_answers(self):
        result = summarize("")
        assert result["responded"] is False
        assert result["identified"] is False
        assert result["status_available"] is False

    def test_something_that_is_not_a_printer(self):
        result = summarize("SSH-2.0-OpenSSH_8.9\r\n")
        assert result["responded"] is True
        assert result["identified"] is False

    def test_old_firmware_identifies_but_reports_no_status(self):
        result = summarize(IDENTITY)
        assert result["identified"] is True
        assert result["status_available"] is False
        assert result["errors"] == []

    def test_the_raw_reply_is_never_returned(self):
        # The transport reads from an administrator-supplied address; echoing
        # the bytes back to a client is the banner grab this must not become.
        result = summarize("\x02SECRET-INTERNAL-BANNER dpi\x03")
        assert "SECRET-INTERNAL-BANNER" not in str(result.get("errors"))
        assert "raw" not in result


# DLE EOT replies. Bits 1 and 4 are always set, bits 0 and 7 always clear —
# that fixed pattern is what makes a real status byte recognisable.
_OK = bytes([0b00010010])
_PAPER_END = bytes([0b01110010])
_PAPER_NEAR_END = bytes([0b00011110])
_COVER_OPEN = bytes([0b00010110])


class TestEscposStatusByte:
    def test_a_valid_status_byte_is_recognised(self):
        assert is_escpos_status_byte(_OK)

    def test_a_byte_with_the_wrong_fixed_bits_is_rejected(self):
        # 0xFF is what a device that is not an ESC/POS printer might send;
        # decoding it would report several faults that do not exist.
        assert not is_escpos_status_byte(b"\xff")

    def test_an_empty_reply_is_rejected(self):
        assert not is_escpos_status_byte(b"")

    def test_a_multi_byte_reply_is_rejected(self):
        assert not is_escpos_status_byte(b"\x12\x12")


class TestSummarizeEscpos:
    def test_a_healthy_printer(self):
        result = summarize_escpos([_OK, _OK])
        assert result["errors"] == []
        assert result["warnings"] == []
        assert result["identified"] is True
        assert result["status_available"] is True

    def test_out_of_paper_is_an_error(self):
        assert summarize_escpos([_OK, _PAPER_END])["errors"] == ["Out of paper"]

    def test_nearly_out_of_paper_is_a_warning(self):
        result = summarize_escpos([_OK, _PAPER_NEAR_END])
        assert result["errors"] == []
        assert result["warnings"] == ["Paper is nearly out"]

    def test_a_cover_open_is_an_error(self):
        assert summarize_escpos([_COVER_OPEN, _OK])["errors"] == ["Cover is open"]

    def test_a_device_that_never_answers(self):
        result = summarize_escpos([b"", b""])
        assert result["responded"] is False
        assert result["identified"] is False
        assert result["status_available"] is False

    def test_a_reply_that_is_not_a_status_byte_is_not_decoded(self):
        # Reported as "did not identify itself", never as a list of faults
        # invented from bits that mean nothing in this protocol.
        result = summarize_escpos([b"\xff", b"\xff"])
        assert result["responded"] is True
        assert result["identified"] is False
        assert result["errors"] == []

    def test_no_model_is_claimed(self):
        # ESC/POS has no equivalent of ZPL's ~HI, so a model name would have
        # to be invented.
        assert summarize_escpos([_OK, _OK])["model"] is None

    def test_a_missing_second_reply_does_not_shift_the_first(self):
        # The paper answer must not be read out of the offline slot.
        result = summarize_escpos([_PAPER_END])
        assert result["errors"] != ["Out of paper"]
