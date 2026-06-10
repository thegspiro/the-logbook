"""
Tests for the per-position inventory label-printer preference
(app/services/inventory_service.py).

A position's label printer/size is remembered so whoever fills the role gets
the same printer on any computer. The preference is stored on the member's
highest-priority position (Position.settings["label_preset"]). The DB session
is mocked, so the suite needs no MySQL.
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
        assert result == {"preset": None, "position_id": None}

    async def test_returns_none_when_position_has_no_preset(self):
        pos_id = uuid4()
        position = SimpleNamespace(settings=None)
        svc, _ = _service(pos_id, position)
        result = await svc.get_label_preset(uuid4(), uuid4())
        assert result["preset"] is None
        assert result["position_id"] == str(pos_id)

    async def test_returns_stored_preset(self):
        pos_id = uuid4()
        position = SimpleNamespace(
            settings={
                "label_preset": {
                    "preset": "rollo_4x6",
                    "custom_width": None,
                    "custom_height": None,
                }
            }
        )
        svc, _ = _service(pos_id, position)
        result = await svc.get_label_preset(uuid4(), uuid4())
        assert result["preset"] == "rollo_4x6"
        assert result["position_id"] == str(pos_id)


class TestSetLabelPreset:
    async def test_persists_preset_on_the_position(self):
        pos_id = uuid4()
        position = SimpleNamespace(settings=None)
        svc, db = _service(pos_id, position)
        result = await svc.set_label_preset(uuid4(), uuid4(), "rollo_2x1")
        assert position.settings["label_preset"]["preset"] == "rollo_2x1"
        assert result["preset"] == "rollo_2x1"
        assert result["position_id"] == str(pos_id)
        db.flush.assert_awaited()

    async def test_persists_custom_dimensions(self):
        position = SimpleNamespace(settings={})
        svc, _ = _service(uuid4(), position)
        await svc.set_label_preset(
            uuid4(), uuid4(), "custom", custom_width=1.5, custom_height=0.5
        )
        pref = position.settings["label_preset"]
        assert pref == {
            "preset": "custom",
            "custom_width": 1.5,
            "custom_height": 0.5,
        }

    async def test_preserves_other_position_settings(self):
        position = SimpleNamespace(settings={"some_other_pref": 42})
        svc, _ = _service(uuid4(), position)
        await svc.set_label_preset(uuid4(), uuid4(), "dymo_30252")
        assert position.settings["some_other_pref"] == 42
        assert position.settings["label_preset"]["preset"] == "dymo_30252"

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
