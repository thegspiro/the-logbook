"""Inventory label options: QR codes and a starting position on a sheet.

The inventory print page renders its own preview, so the PDF it downloads and
the label preset it remembers have to carry the same two choices the preview
shows — otherwise a member picks QR, sees QR, and prints a Code 128.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.inventory import LabelGenerateRequest, LabelPresetUpdate

pytestmark = pytest.mark.unit


class TestLabelGenerateRequest:
    def test_defaults_keep_existing_callers_on_code128_from_the_top(self):
        body = LabelGenerateRequest(item_ids=[uuid4()])
        assert body.symbology == "code128"
        assert body.start_position == 1

    @pytest.mark.parametrize("start_position", [0, 31])
    def test_rejects_a_position_off_an_avery_sheet(self, start_position):
        with pytest.raises(ValidationError):
            LabelGenerateRequest(item_ids=[uuid4()], start_position=start_position)

    def test_accepts_qr_and_the_last_position(self):
        body = LabelGenerateRequest(
            item_ids=[uuid4()], symbology="qr", start_position=30
        )
        assert (body.symbology, body.start_position) == ("qr", 30)


class TestLabelPresetSymbology:
    async def test_the_saved_preset_carries_the_symbology(self):
        from app.api.v1.endpoints.inventory import set_label_preset

        user = SimpleNamespace(id=str(uuid4()), organization_id="org-1")
        db = MagicMock()
        db.commit = AsyncMock()
        with patch(
            "app.api.v1.endpoints.inventory.LabelService.set_preset",
            AsyncMock(return_value={"preset": "letter", "symbology": "qr"}),
        ) as set_preset:
            await set_label_preset(
                LabelPresetUpdate(preset="letter", symbology="qr"),
                db=db,
                current_user=user,
            )

        assert set_preset.await_args.kwargs["symbology"] == "qr"
        assert set_preset.await_args.kwargs["module"] == "inventory"

    def test_a_body_without_one_is_code128(self):
        assert LabelPresetUpdate(preset="letter").symbology == "code128"
