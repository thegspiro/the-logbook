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


class TestLabelPresetLines:
    """What prints on the label is saved with the preset, under the update
    contract: omitted keeps the saved choice, null clears it."""

    async def _save(self, body):
        from app.api.v1.endpoints.inventory import set_label_preset

        user = SimpleNamespace(id=str(uuid4()), organization_id="org-1")
        db = MagicMock()
        db.commit = AsyncMock()
        with patch(
            "app.api.v1.endpoints.inventory.LabelService.set_preset",
            AsyncMock(return_value={"preset": "letter"}),
        ) as set_preset:
            await set_label_preset(body, db=db, current_user=user)
        return set_preset.await_args.kwargs["extra_lines"]

    async def test_omitted_leaves_the_saved_lines_alone(self):
        from app.services.label_service import UNSET

        assert await self._save(LabelPresetUpdate(preset="letter")) is UNSET

    async def test_a_list_is_saved(self):
        body = LabelPresetUpdate(preset="letter", extra_lines=["size", "storage_area"])
        assert await self._save(body) == ["size", "storage_area"]

    async def test_null_clears(self):
        body = LabelPresetUpdate(preset="letter", extra_lines=None)
        assert await self._save(body) is None

    def test_rejects_an_overlong_line(self):
        with pytest.raises(ValidationError):
            LabelPresetUpdate(preset="letter", extra_lines=["custom:" + "x" * 100])


class TestExtraLines:
    item = SimpleNamespace(
        location=None,
        location_id=None,
        category=None,
        category_id=None,
        condition=None,
        size="Large",
        storage_area_id="shelf-2",
    )

    def test_size_and_storage_area_print_in_the_order_asked(self):
        from app.services.inventory_service import _build_extra_lines

        line = _build_extra_lines(
            self.item, ["storage_area", "size"], {"shelf-2": "Rack A > Shelf 2"}
        )
        assert line == "Rack A > Shelf 2 | Large"

    def test_hide_directives_add_nothing_to_the_line(self):
        from app.services.inventory_service import _build_extra_lines

        assert _build_extra_lines(self.item, ["no_asset_tag", "size"]) == "Large"

    def test_an_area_the_org_does_not_hold_prints_nothing(self):
        from app.services.inventory_service import _build_extra_lines

        assert _build_extra_lines(self.item, ["storage_area"], {}) == ""


class TestStorageAreaPaths:
    def _area(self, id_, name, parent_id=None):
        return SimpleNamespace(id=id_, name=name, parent_id=parent_id)

    def test_walks_to_the_root(self):
        from app.services.inventory_service import storage_area_paths

        areas = [
            self._area("room", "Supply Room"),
            self._area("rack", "Rack A", "room"),
            self._area("shelf", "Shelf 2", "rack"),
        ]
        assert storage_area_paths(areas)["shelf"] == "Supply Room > Rack A > Shelf 2"

    def test_a_cycle_does_not_hang(self):
        from app.services.inventory_service import storage_area_paths

        areas = [self._area("a", "A", "b"), self._area("b", "B", "a")]
        assert storage_area_paths(areas) == {"a": "B > A", "b": "A > B"}
