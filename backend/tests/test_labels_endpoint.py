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
