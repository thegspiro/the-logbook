"""Endpoint-level tests for backend/app/api/v1/endpoints/labels.py.

LBL-1: ``POST /labels/print`` is reachable by anyone holding just a module's
view permission (apparatus.view, facilities.view, members.view are all
baseline grants — see ``MODULE_LABELS`` in ``label_service.py``). Unlike the
printer-config routes above it (test/status/probe, gated on
settings.manage), a viewer here has no business learning the printer's
configured host/IP/port — the same class of leak the station-document print
path already closed (see test_print_documents.py's
``test_printer_unreachable_error_is_redacted``).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.utils.printer_transport import PrinterUnreachableError

ORG = "org-1"


def _viewer(user_id="viewer-1", permissions=("apparatus.view",)):
    return SimpleNamespace(
        id=user_id,
        organization_id=ORG,
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
        first_name="View",
        last_name="Er",
        username="viewer",
    )


class TestPrintLabelsPrinterErrorRedaction:
    async def test_printer_unreachable_error_is_redacted(self):
        from app.api.v1.endpoints.labels import LabelPrintBody, print_labels

        body = LabelPrintBody(module="apparatus", ids=["a-1"])
        with patch(
            "app.api.v1.endpoints.labels.LabelPrinterService.print_labels",
            AsyncMock(
                side_effect=PrinterUnreachableError(
                    "Could not connect to the printer at 10.0.0.7:9100."
                )
            ),
        ):
            with pytest.raises(HTTPException) as exc:
                await print_labels(
                    body,
                    db=MagicMock(),
                    current_user=_viewer(),
                    hidden_prospect_ids=set(),
                )

        assert exc.value.status_code == 502
        detail = str(exc.value.detail)
        assert "10.0.0.7" not in detail
        assert "9100" not in detail


class TestLabelPresetPrinterScoping:
    async def test_validates_remembered_printer_against_callers_organization(self):
        from app.api.v1.endpoints.labels import LabelPresetBody, set_label_preset

        user = _viewer(user_id=str(uuid4()))
        body = LabelPresetBody(preset="zebra_2x1", printer_id="printer-2")
        with (
            patch(
                "app.api.v1.endpoints.labels.LabelPrinterService.get_printer",
                AsyncMock(return_value=SimpleNamespace(id="printer-2")),
            ) as get_printer,
            patch(
                "app.api.v1.endpoints.labels.LabelService.set_preset",
                AsyncMock(
                    return_value={"preset": "zebra_2x1", "printer_id": "printer-2"}
                ),
            ) as set_preset,
        ):
            db = MagicMock()
            db.commit = AsyncMock()
            result = await set_label_preset("apparatus", body, db=db, current_user=user)

        get_printer.assert_awaited_once_with("printer-2", ORG)
        assert set_preset.await_args.kwargs["printer_id"] == "printer-2"
        assert result["printer_id"] == "printer-2"
