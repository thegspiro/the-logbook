"""
Tests for the label printer service (app/services/label_printer_service.py).

The DB session is mocked, so these need no MySQL. What they pin down is the
service's own logic: that a by-id fetch is org-scoped (a cross-tenant read of
another department's printer is the failure that matters most here), that a
stored printer can never hold a configuration that would only fail at print
time, and that the print path renders and sends rather than reporting success
on its own.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import label_printer_service as lps
from app.services.label_printer_service import (
    LANGUAGE_ESCPOS,
    LANGUAGE_ZPL,
    MAX_LABELS_PER_JOB,
    LabelPrinterService,
    _validate_printer_config,
)
from app.utils.label_renderer import SYMBOLOGY_QR, LabelSpec
from app.utils.printer_transport import PrinterUnreachableError

ORG = "org-1"


def _printer(**kwargs):
    base = {
        "id": "printer-1",
        "organization_id": ORG,
        "name": "Quartermaster Zebra",
        "location": None,
        "host": "192.168.1.50",
        "port": 9100,
        "dpi": 203,
        "label_format": "zebra_2x1",
        "custom_width": None,
        "custom_height": None,
        "darkness": None,
        "is_default": True,
        "is_active": True,
        "language": LANGUAGE_ZPL,
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


def _where(query) -> str:
    """The WHERE clause of a query, without the SELECT column list.

    Asserting against the whole statement gives false positives: every column
    is named in the SELECT list whether or not it is filtered on.
    """
    text = str(query)
    _, _, rest = text.partition("WHERE")
    return rest


def _service(scalar=None, scalars=None):
    db = MagicMock()
    db.scalar = AsyncMock(return_value=scalar)
    result = MagicMock()
    result.all = MagicMock(return_value=scalars or [])
    db.scalars = AsyncMock(return_value=result)
    db.flush = AsyncMock()
    db.delete = AsyncMock()
    db.add = MagicMock()
    return LabelPrinterService(db), db


class TestOrgScoping:
    """A printer is fetched by id from a path parameter. `settings.manage` in
    one organization must not reach another's row (CLAUDE.md pitfall 14a/14b)."""

    async def test_get_printer_filters_on_organization(self):
        svc, db = _service(scalar=_printer())
        await svc.get_printer("printer-1", ORG)
        criteria = _where(db.scalar.await_args.args[0])
        assert "organization_id" in criteria
        assert "label_printers.id" in criteria

    async def test_a_printer_in_another_org_is_not_found(self):
        # The org filter makes the query return nothing rather than the row.
        svc, _ = _service(scalar=None)
        with pytest.raises(ValueError, match="Printer not found"):
            await svc.get_printer("printer-1", "other-org")

    async def test_list_is_scoped_to_the_organization(self):
        svc, db = _service(scalars=[_printer()])
        await svc.list_printers(ORG)
        assert "organization_id" in _where(db.scalars.await_args.args[0])

    async def test_inactive_printers_are_hidden_by_default(self):
        svc, db = _service(scalars=[])
        await svc.list_printers(ORG)
        assert "is_active" in _where(db.scalars.await_args.args[0])

    async def test_inactive_printers_can_be_included(self):
        svc, db = _service(scalars=[])
        await svc.list_printers(ORG, include_inactive=True)
        # is_active still appears in the SELECT list; what must not appear is a
        # filter on it.
        assert "is_active" not in _where(db.scalars.await_args.args[0])


class TestConfigValidation:
    """Validated at write time so the person who can fix it is the one who
    hears about it, rather than whoever tries to print three weeks later."""

    def test_a_valid_configuration_passes(self):
        _validate_printer_config(
            host="192.168.1.50",
            port=9100,
            dpi=203,
            label_format="zebra_2x1",
            custom_width=None,
            custom_height=None,
            darkness=None,
        )

    def test_a_non_printer_port_is_rejected(self):
        with pytest.raises(ValueError, match="not a label-printer port"):
            _validate_printer_config(
                host="h",
                port=6379,
                dpi=203,
                label_format=None,
                custom_width=None,
                custom_height=None,
                darkness=None,
            )

    def test_an_unsupported_dpi_is_rejected(self):
        with pytest.raises(ValueError, match="Unsupported printer resolution"):
            _validate_printer_config(
                host="h",
                port=9100,
                dpi=150,
                label_format=None,
                custom_width=None,
                custom_height=None,
                darkness=None,
            )

    def test_a_sheet_format_is_rejected(self):
        # An Avery grid on a roll-fed printer would burn 30 labels off the roll.
        with pytest.raises(ValueError, match="paper sheet layout"):
            _validate_printer_config(
                host="h",
                port=9100,
                dpi=203,
                label_format="letter",
                custom_width=None,
                custom_height=None,
                darkness=None,
            )

    def test_custom_without_dimensions_is_rejected(self):
        with pytest.raises(ValueError, match="custom_width and custom_height"):
            _validate_printer_config(
                host="h",
                port=9100,
                dpi=203,
                label_format="custom",
                custom_width=None,
                custom_height=None,
                darkness=None,
            )

    def test_a_blank_host_is_rejected(self):
        with pytest.raises(ValueError, match="host is required"):
            _validate_printer_config(
                host="   ",
                port=9100,
                dpi=203,
                label_format=None,
                custom_width=None,
                custom_height=None,
                darkness=None,
            )

    def test_darkness_out_of_range_is_rejected(self):
        with pytest.raises(ValueError, match="darkness must be between"):
            _validate_printer_config(
                host="h",
                port=9100,
                dpi=203,
                label_format=None,
                custom_width=None,
                custom_height=None,
                darkness=99,
            )


class TestCreate:
    async def test_a_duplicate_name_is_rejected(self):
        svc, _ = _service(scalar=_printer())
        with pytest.raises(ValueError, match="already exists"):
            await svc.create_printer(
                ORG, "user-1", {"name": "Quartermaster Zebra", "host": "10.0.0.1"}
            )

    async def test_a_blank_name_is_rejected(self):
        svc, _ = _service()
        with pytest.raises(ValueError, match="name is required"):
            await svc.create_printer(ORG, "user-1", {"name": "  ", "host": "10.0.0.1"})

    async def test_the_first_printer_becomes_the_default(self):
        # An organization that registers exactly one printer should not also
        # have to mark it, or the print page opens with no destination.
        svc, db = _service(scalar=None)
        created = {}

        def capture(obj):
            created["obj"] = obj

        db.add = MagicMock(side_effect=capture)
        result = MagicMock()
        result.all = MagicMock(return_value=[_printer()])
        db.scalars = AsyncMock(return_value=result)

        printer = await svc.create_printer(
            ORG, "user-1", {"name": "New", "host": "10.0.0.1", "is_default": False}
        )
        assert printer.is_default is True


class TestUpdate:
    async def test_a_configuration_is_validated_against_merged_values(self):
        # Switching the format to "custom" without sending dimensions is only
        # detectable against the row's existing values.
        svc, _ = _service(scalar=_printer())
        with pytest.raises(ValueError, match="custom_width and custom_height"):
            await svc.update_printer("printer-1", ORG, {"label_format": "custom"})

    async def test_an_unchanged_field_is_taken_from_the_row(self):
        svc, _ = _service(scalar=_printer(dpi=300))
        printer = await svc.update_printer("printer-1", ORG, {"location": "Bay 2"})
        assert printer.dpi == 300
        assert printer.location == "Bay 2"

    async def test_an_explicit_null_clears_the_field(self):
        # An update payload's null means "clear this", not "ignore this"
        # (CLAUDE.md pitfall 1).
        svc, _ = _service(scalar=_printer(location="Old room"))
        printer = await svc.update_printer("printer-1", ORG, {"location": None})
        assert printer.location is None

    async def test_a_printer_in_another_org_cannot_be_updated(self):
        svc, _ = _service(scalar=None)
        with pytest.raises(ValueError, match="Printer not found"):
            await svc.update_printer("printer-1", "other-org", {"name": "Mine now"})


class TestPrinting:
    def _patched_send(self):
        """Patch the send *and* the follow-up status query.

        print_labels asks the printer how it is once the job is away. Leaving
        that unpatched makes every test here open a real socket to a LAN
        address that is not there and wait out the connect timeout.
        """
        return patch.multiple(
            lps,
            send_to_printer=AsyncMock(return_value=42),
            query_printer=AsyncMock(return_value=""),
        )

    async def test_renders_and_sends_to_the_printers_address(self):
        printer = _printer()
        svc, _ = _service(scalar=printer)
        builder = AsyncMock(return_value=([LabelSpec("Helmet", "INV-1")], 0))

        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            with self._patched_send():
                send = lps.send_to_printer
                result = await svc.print_labels(ORG, "inventory", ["id-1"], "printer-1")

        host, port, payload = send.await_args.args
        assert (host, port) == ("192.168.1.50", 9100)
        assert payload.startswith("^XA")
        assert result["labels_sent"] == 1
        assert result["printer_name"] == "Quartermaster Zebra"

    async def test_an_unknown_module_is_rejected(self):
        svc, _ = _service(scalar=_printer())
        with pytest.raises(ValueError, match="Labels are not available"):
            await svc.print_labels(ORG, "not_a_module", ["id-1"])

    async def test_no_matching_records_is_rejected(self):
        svc, _ = _service(scalar=_printer())
        builder = AsyncMock(return_value=([], 0))
        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            with pytest.raises(ValueError, match="No records found"):
                await svc.print_labels(ORG, "inventory", ["id-1"], "printer-1")

    async def test_an_oversized_job_is_rejected_before_sending(self):
        printer = _printer()
        svc, _ = _service(scalar=printer)
        specs = [LabelSpec(f"Item {i}", f"INV-{i}") for i in range(MAX_LABELS_PER_JOB)]
        builder = AsyncMock(return_value=(specs, 0))

        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            with self._patched_send():
                send = lps.send_to_printer
                with pytest.raises(ValueError, match="Print at most"):
                    await svc.print_labels(
                        ORG, "inventory", ["id"], "printer-1", copies=2
                    )
        send.assert_not_called()

    async def test_a_disabled_printer_is_rejected(self):
        svc, _ = _service(scalar=_printer(is_active=False))
        with pytest.raises(ValueError, match="is disabled"):
            await svc.print_labels(ORG, "inventory", ["id-1"], "printer-1")

    async def test_no_configured_printer_gives_an_actionable_message(self):
        svc, db = _service(scalar=None)
        result = MagicMock()
        result.all = MagicMock(return_value=[])
        db.scalars = AsyncMock(return_value=result)
        with pytest.raises(ValueError, match="No label printer is configured"):
            await svc.print_labels(ORG, "inventory", ["id-1"])

    async def test_the_job_format_overrides_the_printers_stock(self):
        printer = _printer(label_format="zebra_2x1")
        svc, _ = _service(scalar=printer)
        builder = AsyncMock(return_value=([LabelSpec("Helmet", "INV-1")], 0))

        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            with self._patched_send():
                send = lps.send_to_printer
                await svc.print_labels(
                    ORG, "inventory", ["id-1"], "printer-1", label_format="zebra_4x2"
                )
        # 4" x 2" at 203 dpi rather than the printer's default 2" x 1".
        assert "^PW812" in send.await_args.args[2]

    async def test_the_printers_stock_is_used_when_no_format_is_given(self):
        printer = _printer(label_format="zebra_4x2")
        svc, _ = _service(scalar=printer)
        builder = AsyncMock(return_value=([LabelSpec("Helmet", "INV-1")], 0))

        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            with self._patched_send():
                send = lps.send_to_printer
                await svc.print_labels(ORG, "inventory", ["id-1"], "printer-1")
        assert "^PW812" in send.await_args.args[2]

    async def test_the_printers_resolution_reaches_the_renderer(self):
        printer = _printer(dpi=300)
        svc, _ = _service(scalar=printer)
        builder = AsyncMock(return_value=([LabelSpec("Helmet", "INV-1")], 0))

        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            with self._patched_send():
                send = lps.send_to_printer
                await svc.print_labels(ORG, "inventory", ["id-1"], "printer-1")
        # 2" at 300 dpi is 600 dots; at 203 it would be 406.
        assert "^PW600" in send.await_args.args[2]


class TestTestLabel:
    async def test_sends_a_self_describing_label(self):
        svc, _ = _service(scalar=_printer())
        with patch.multiple(
            lps,
            send_to_printer=AsyncMock(),
            query_printer=AsyncMock(return_value=""),
        ):
            result = await svc.print_test_label("printer-1", ORG)
            send = lps.send_to_printer
        payload = send.await_args.args[2]
        assert "TEST-LABEL" in payload
        assert "Quartermaster Zebra" in payload
        assert result["printer_name"] == "Quartermaster Zebra"

    async def test_a_disabled_printer_is_rejected(self):
        svc, _ = _service(scalar=_printer(is_active=False))
        with pytest.raises(ValueError, match="is disabled"):
            await svc.print_test_label("printer-1", ORG)

    async def test_a_printer_in_another_org_is_not_found(self):
        svc, _ = _service(scalar=None)
        with pytest.raises(ValueError, match="Printer not found"):
            await svc.print_test_label("printer-1", "other-org")


_HEALTHY = (
    "\x02ZTC ZD420-203dpi ZPL,V93.20.15Z,8,4194304\x03\r\n"
    "\x02\r\nPRINTER STATUS\r\n"
    " ERRORS:         0 00000000 00000000\r\n"
    " WARNINGS:       0 00000000 00000000\r\n\x03"
)
_MEDIA_OUT = _HEALTHY.replace(
    "ERRORS:         0 00000000 00000000", "ERRORS:         1 00000000 00000001"
)


class TestStatusReporting:
    """Bytes reaching a socket is not a printed label. A printer that is out of
    stock accepts the job and prints nothing, so a bare success would be a lie."""

    def _patched(self, send=None, query=None):
        return patch.multiple(
            lps,
            send_to_printer=send or AsyncMock(),
            query_printer=query or AsyncMock(return_value=_HEALTHY),
        )

    async def _print(self, svc, **kwargs):
        builder = AsyncMock(return_value=([LabelSpec("Helmet", "INV-1")], 0))
        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            return await svc.print_labels(
                ORG, "inventory", ["id-1"], "printer-1", **kwargs
            )

    async def test_a_faulted_printer_is_reported_after_the_send(self):
        svc, _ = _service(scalar=_printer())
        with self._patched(query=AsyncMock(return_value=_MEDIA_OUT)):
            result = await self._print(svc)
        assert result["printer_errors"] == ["Out of labels"]
        assert result["status_known"] is True

    async def test_a_healthy_printer_reports_no_faults(self):
        svc, _ = _service(scalar=_printer())
        with self._patched():
            result = await self._print(svc)
        assert result["printer_errors"] == []
        assert result["labels_sent"] == 1

    async def test_a_failed_status_query_does_not_fail_the_print(self):
        # The labels are already on the wire. Turning a successful print into
        # a reported failure because the follow-up query timed out would be a
        # worse answer than admitting the status is unknown.
        svc, _ = _service(scalar=_printer())
        with self._patched(query=AsyncMock(side_effect=PrinterUnreachableError("x"))):
            result = await self._print(svc)
        assert result["labels_sent"] == 1
        assert result["status_known"] is False
        assert result["printer_errors"] == []

    async def test_the_test_label_reports_faults_too(self):
        svc, _ = _service(scalar=_printer())
        with self._patched(query=AsyncMock(return_value=_MEDIA_OUT)):
            result = await svc.print_test_label("printer-1", ORG)
        assert result["printer_errors"] == ["Out of labels"]

    async def test_get_status_is_org_scoped(self):
        svc, _ = _service(scalar=None)
        with patch.object(lps, "query_printer", AsyncMock(return_value=_HEALTHY)):
            with pytest.raises(ValueError, match="Printer not found"):
                await svc.get_status("printer-1", "other-org")

    async def test_get_status_reports_identity(self):
        svc, _ = _service(scalar=_printer())
        with patch.object(lps, "query_printer", AsyncMock(return_value=_HEALTHY)):
            result = await svc.get_status("printer-1", ORG)
        assert result["model"] == "ZTC ZD420-203dpi ZPL"
        assert result["reported_dpi"] == 203
        assert result["configured_dpi"] == 203

    async def test_probe_rejects_a_non_printer_port_before_querying(self):
        svc, _ = _service()
        with patch.object(lps, "query_printer", AsyncMock()) as query:
            with pytest.raises(ValueError, match="not a label-printer port"):
                await svc.probe_target("10.0.0.1", 6379)
        query.assert_not_called()

    async def test_probe_returns_identity_for_an_unsaved_target(self):
        svc, _ = _service()
        with patch.object(lps, "query_printer", AsyncMock(return_value=_HEALTHY)):
            result = await svc.probe_target("10.0.0.1", 9100)
        assert result["identified"] is True
        assert result["reported_dpi"] == 203


class TestSymbology:
    async def test_qr_is_sent_when_requested(self):
        svc, _ = _service(scalar=_printer())
        builder = AsyncMock(return_value=([LabelSpec("Helmet", "INV-1")], 0))
        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            with patch.multiple(
                lps,
                send_to_printer=AsyncMock(),
                query_printer=AsyncMock(return_value=_HEALTHY),
            ):
                await svc.print_labels(
                    ORG, "inventory", ["id-1"], "printer-1", symbology=SYMBOLOGY_QR
                )
                payload = lps.send_to_printer.await_args.args[2]
        assert "^BQN" in payload

    async def test_code128_is_the_default(self):
        svc, _ = _service(scalar=_printer())
        builder = AsyncMock(return_value=([LabelSpec("Helmet", "INV-1")], 0))
        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            with patch.multiple(
                lps,
                send_to_printer=AsyncMock(),
                query_printer=AsyncMock(return_value=_HEALTHY),
            ):
                await svc.print_labels(ORG, "inventory", ["id-1"], "printer-1")
                payload = lps.send_to_printer.await_args.args[2]
        assert "^BCN," in payload

    async def test_an_unknown_symbology_is_rejected(self):
        svc, _ = _service(scalar=_printer())
        with pytest.raises(ValueError, match="Unknown barcode symbology"):
            await svc.print_labels(
                ORG, "inventory", ["id-1"], "printer-1", symbology="datamatrix"
            )


def _receipt_printer(**kwargs):
    base = {"language": LANGUAGE_ESCPOS, "label_format": "escpos_80mm"}
    base.update(kwargs)
    return _printer(**base)


class TestPrinterLanguages:
    """A registered printer declares its language, and the renderer, the stock
    it accepts and the status query all branch on it. Sending one language's
    bytes to the other prints pages of garbage."""

    def _patched(self, zpl_reply="", escpos_replies=None):
        return patch.multiple(
            lps,
            send_to_printer=AsyncMock(),
            query_printer=AsyncMock(return_value=zpl_reply),
            query_printer_raw=AsyncMock(return_value=escpos_replies or [b"", b""]),
        )

    async def _print(self, svc, **kwargs):
        builder = AsyncMock(return_value=([LabelSpec("Helmet", "INV-1")], 0))
        with patch.dict(lps.MODULE_LABELS, {"inventory": ((), builder)}):
            return await svc.print_labels(
                ORG, "inventory", ["id-1"], "printer-1", **kwargs
            )

    async def test_a_zpl_printer_is_sent_text(self):
        svc, _ = _service(scalar=_printer())
        with self._patched():
            await self._print(svc)
            payload = lps.send_to_printer.await_args.args[2]
        assert isinstance(payload, str)
        assert payload.startswith("^XA")

    async def test_an_escpos_printer_is_sent_bytes(self):
        # Text-encoding ESC/POS would mangle every byte above 0x7F.
        svc, _ = _service(scalar=_receipt_printer())
        with self._patched():
            await self._print(svc)
            payload = lps.send_to_printer.await_args.args[2]
        assert isinstance(payload, bytes)
        assert payload.startswith(b"\x1b@")

    async def test_a_row_with_no_language_is_treated_as_zpl(self):
        # Rows written before the column existed are ZPL by fact: it was the
        # only language the feature had.
        legacy = SimpleNamespace(
            **{k: v for k, v in vars(_printer()).items() if k != "language"}
        )
        svc, _ = _service(scalar=legacy)
        with self._patched():
            await self._print(svc)
            payload = lps.send_to_printer.await_args.args[2]
        assert isinstance(payload, str)

    async def test_a_die_cut_size_does_not_reach_a_receipt_printer(self):
        # The print page offers one size control for both kinds of printer.
        # A Zebra size arriving for a receipt printer is not a mistake to
        # reject — it does not apply, and the loaded roll wins.
        svc, _ = _service(scalar=_receipt_printer())
        with self._patched():
            await self._print(svc, label_format="zebra_2x1")
            payload = lps.send_to_printer.await_args.args[2]
        assert payload.startswith(b"\x1b@")

    async def test_status_is_queried_in_the_printers_own_language(self):
        svc, _ = _service(scalar=_receipt_printer())
        ok = bytes([0b00010010])
        paper_end = bytes([0b01110010])
        with self._patched(escpos_replies=[ok, ok, paper_end]):
            result = await svc.get_status("printer-1", ORG)
            # Captured inside the block: outside it the patch is undone and
            # the name is the real function again.
            zpl_query = lps.query_printer
            sent = lps.query_printer_raw.await_args.args[2]
        assert result["errors"] == ["Out of paper"]
        assert result["language"] == LANGUAGE_ESCPOS
        zpl_query.assert_not_called()
        # The parser reads each reply by position, so the order the queries go
        # out in is part of the contract, not an implementation detail.
        assert sent == [b"\x10\x04\x02", b"\x10\x04\x03", b"\x10\x04\x04"]

    async def test_a_zpl_printer_uses_the_text_query(self):
        svc, _ = _service(scalar=_printer())
        identity = "\x02ZTC ZD420-203dpi ZPL,V93.20.15Z\x03"
        with self._patched(zpl_reply=identity):
            result = await svc.get_status("printer-1", ORG)
            escpos_query = lps.query_printer_raw
        assert result["model"] == "ZTC ZD420-203dpi ZPL"
        escpos_query.assert_not_called()

    async def test_probing_uses_the_requested_language(self):
        svc, _ = _service()
        ok = bytes([0b00010010])
        with self._patched(escpos_replies=[ok, ok]):
            result = await svc.probe_target("10.0.0.1", 9100, LANGUAGE_ESCPOS)
            zpl_query = lps.query_printer
        assert result["identified"] is True
        zpl_query.assert_not_called()

    def test_a_receipt_printer_rejects_a_die_cut_stock(self):
        with pytest.raises(ValueError, match="not a receipt paper size"):
            _validate_printer_config(
                host="h",
                port=9100,
                dpi=203,
                label_format="zebra_2x1",
                custom_width=None,
                custom_height=None,
                darkness=None,
                language=LANGUAGE_ESCPOS,
            )

    def test_a_zpl_printer_rejects_receipt_paper(self):
        with pytest.raises(ValueError, match="Unknown label format"):
            _validate_printer_config(
                host="h",
                port=9100,
                dpi=203,
                label_format="escpos_80mm",
                custom_width=None,
                custom_height=None,
                darkness=None,
                language=LANGUAGE_ZPL,
            )

    def test_an_unknown_language_is_rejected(self):
        with pytest.raises(ValueError, match="Unknown printer language"):
            _validate_printer_config(
                host="h",
                port=9100,
                dpi=203,
                label_format=None,
                custom_width=None,
                custom_height=None,
                darkness=None,
                language="epl2",
            )
