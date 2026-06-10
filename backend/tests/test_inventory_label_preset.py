"""
Tests for the per-position, per-module label-printer preference
(app/services/inventory_service.py).

A position's label printer/size is remembered so whoever fills the role gets
the same printer on any computer, and it is namespaced by module
(Position.settings["label_presets"][module]) so a role's printer can differ
per module — e.g. the Quartermaster's inventory printer vs the apparatus
team's apparatus printer. The DB session is mocked, so the suite needs no
MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.inventory_service import InventoryService


def _service(primary_position_id, position):
    """Service whose _get_primary_role_id returns the given id and whose
    scalar() returns the given Position row."""
    db = MagicMock()
    db.scalar = AsyncMock(return_value=position)
    db.flush = AsyncMock()
    svc = InventoryService(db)
    svc._get_primary_role_id = AsyncMock(return_value=primary_position_id)
    return svc, db


class TestGetLabelPreset:
    async def test_returns_none_when_member_has_no_position(self):
        svc, _ = _service(None, None)
        result = await svc.get_label_preset(uuid4(), uuid4())
        assert result["preset"] is None
        assert result["position_id"] is None

    async def test_returns_none_when_position_has_no_preset(self):
        pos_id = uuid4()
        position = SimpleNamespace(settings=None)
        svc, _ = _service(pos_id, position)
        result = await svc.get_label_preset(uuid4(), uuid4())
        assert result["preset"] is None
        assert result["position_id"] == str(pos_id)

    async def test_returns_stored_preset_for_the_module(self):
        pos_id = uuid4()
        position = SimpleNamespace(
            settings={
                "label_presets": {
                    "inventory": {
                        "preset": "rollo_4x6",
                        "custom_width": None,
                        "custom_height": None,
                    }
                }
            }
        )
        svc, _ = _service(pos_id, position)
        result = await svc.get_label_preset(uuid4(), uuid4(), module="inventory")
        assert result["preset"] == "rollo_4x6"
        assert result["module"] == "inventory"
        assert result["position_id"] == str(pos_id)

    async def test_module_presets_are_isolated(self):
        position = SimpleNamespace(
            settings={
                "label_presets": {
                    "inventory": {"preset": "rollo_4x6"},
                    "apparatus": {"preset": "dymo_30252"},
                }
            }
        )
        svc, _ = _service(uuid4(), position)
        inv = await svc.get_label_preset(uuid4(), uuid4(), module="inventory")
        app_ = await svc.get_label_preset(uuid4(), uuid4(), module="apparatus")
        assert inv["preset"] == "rollo_4x6"
        assert app_["preset"] == "dymo_30252"

    async def test_returns_none_for_a_module_with_no_preset(self):
        position = SimpleNamespace(
            settings={"label_presets": {"inventory": {"preset": "rollo_4x6"}}}
        )
        svc, _ = _service(uuid4(), position)
        result = await svc.get_label_preset(uuid4(), uuid4(), module="apparatus")
        assert result["preset"] is None


class TestSetLabelPreset:
    async def test_persists_preset_under_the_module(self):
        pos_id = uuid4()
        position = SimpleNamespace(settings=None)
        svc, db = _service(pos_id, position)
        result = await svc.set_label_preset(
            uuid4(), uuid4(), "rollo_2x1", module="inventory"
        )
        assert position.settings["label_presets"]["inventory"]["preset"] == "rollo_2x1"
        assert result["preset"] == "rollo_2x1"
        assert result["module"] == "inventory"
        assert result["position_id"] == str(pos_id)
        db.flush.assert_awaited()

    async def test_persists_custom_dimensions(self):
        position = SimpleNamespace(settings={})
        svc, _ = _service(uuid4(), position)
        await svc.set_label_preset(
            uuid4(), uuid4(), "custom", custom_width=1.5, custom_height=0.5
        )
        pref = position.settings["label_presets"]["inventory"]
        assert pref == {
            "preset": "custom",
            "custom_width": 1.5,
            "custom_height": 0.5,
        }

    async def test_preserves_other_position_settings_and_modules(self):
        position = SimpleNamespace(
            settings={
                "some_other_pref": 42,
                "label_presets": {"apparatus": {"preset": "dymo_30334"}},
            }
        )
        svc, _ = _service(uuid4(), position)
        await svc.set_label_preset(uuid4(), uuid4(), "dymo_30252", module="inventory")
        # Unrelated settings and other modules' presets are untouched.
        assert position.settings["some_other_pref"] == 42
        assert position.settings["label_presets"]["apparatus"]["preset"] == "dymo_30334"
        assert position.settings["label_presets"]["inventory"]["preset"] == "dymo_30252"

    async def test_rejects_unknown_preset(self):
        position = SimpleNamespace(settings={})
        svc, _ = _service(uuid4(), position)
        with pytest.raises(ValueError, match="Unknown label preset"):
            await svc.set_label_preset(uuid4(), uuid4(), "not-a-real-printer")

    async def test_raises_when_member_has_no_position(self):
        db = MagicMock()
        db.scalar = AsyncMock(return_value=None)
        svc = InventoryService(db)
        svc._get_primary_role_id = AsyncMock(return_value=None)
        with pytest.raises(ValueError, match="No position"):
            await svc.set_label_preset(uuid4(), uuid4(), "rollo_4x6")
