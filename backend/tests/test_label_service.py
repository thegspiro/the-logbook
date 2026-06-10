"""
Tests for the cross-module label service and shared renderer
(app/services/label_service.py, app/utils/label_renderer.py).

Covers the per-position/per-module printer preset, the module registry, the
generate dispatch, and PDF rendering. The DB session is mocked and the
renderer runs for real (reportlab), so the suite needs no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services import label_service as ls
from app.services.label_service import LabelService
from app.utils.label_renderer import LabelSpec, render_labels


def _service(position_id, position):
    db = MagicMock()
    db.scalar = AsyncMock(return_value=position)
    db.flush = AsyncMock()
    svc = LabelService(db)
    svc._primary_position_id = AsyncMock(return_value=position_id)
    return svc, db


class TestGetPreset:
    async def test_none_when_member_has_no_position(self):
        svc, _ = _service(None, None)
        r = await svc.get_preset(uuid4(), uuid4(), "inventory")
        assert r["preset"] is None
        assert r["position_id"] is None
        assert r["module"] == "inventory"

    async def test_returns_the_modules_preset(self):
        position = SimpleNamespace(
            settings={"label_presets": {"inventory": {"preset": "rollo_4x6"}}}
        )
        svc, _ = _service("pos-1", position)
        r = await svc.get_preset(uuid4(), uuid4(), "inventory")
        assert r["preset"] == "rollo_4x6"
        assert r["module"] == "inventory"

    async def test_modules_are_isolated(self):
        position = SimpleNamespace(
            settings={
                "label_presets": {
                    "inventory": {"preset": "rollo_4x6"},
                    "apparatus": {"preset": "dymo_30252"},
                }
            }
        )
        svc, _ = _service("p", position)
        assert (await svc.get_preset(uuid4(), uuid4(), "inventory"))["preset"] == (
            "rollo_4x6"
        )
        assert (await svc.get_preset(uuid4(), uuid4(), "apparatus"))["preset"] == (
            "dymo_30252"
        )


class TestSetPreset:
    async def test_persists_under_the_module(self):
        position = SimpleNamespace(settings=None)
        svc, db = _service("p", position)
        r = await svc.set_preset(uuid4(), uuid4(), "apparatus", "dymo_30334")
        assert position.settings["label_presets"]["apparatus"]["preset"] == "dymo_30334"
        assert r["module"] == "apparatus"
        db.flush.assert_awaited()

    async def test_preserves_other_modules(self):
        position = SimpleNamespace(
            settings={"label_presets": {"apparatus": {"preset": "dymo_30334"}}}
        )
        svc, _ = _service("p", position)
        await svc.set_preset(uuid4(), uuid4(), "inventory", "rollo_2x1")
        assert position.settings["label_presets"]["apparatus"]["preset"] == "dymo_30334"
        assert position.settings["label_presets"]["inventory"]["preset"] == "rollo_2x1"

    async def test_rejects_unknown_preset(self):
        position = SimpleNamespace(settings={})
        svc, _ = _service("p", position)
        with pytest.raises(ValueError, match="Unknown label preset"):
            await svc.set_preset(uuid4(), uuid4(), "inventory", "not-a-printer")

    async def test_raises_when_no_position(self):
        svc, _ = _service(None, None)
        with pytest.raises(ValueError, match="No position"):
            await svc.set_preset(uuid4(), uuid4(), "inventory", "rollo_4x6")


class TestModuleRegistry:
    def test_all_expected_modules_registered(self):
        for m in [
            "inventory",
            "apparatus",
            "prospective_members",
            "facilities",
            "membership",
        ]:
            assert ls.is_known_label_module(m)
            assert ls.required_permission_for_module(m)

    def test_unknown_module(self):
        assert not ls.is_known_label_module("nope")
        assert ls.required_permission_for_module("nope") is None


class TestGenerate:
    async def test_unknown_module_raises(self):
        svc = LabelService(MagicMock())
        with pytest.raises(ValueError, match="not available"):
            await svc.generate(uuid4(), "nope", ["x"])

    async def test_dispatches_to_builder_and_renders_pdf(self, monkeypatch):
        async def fake_builder(db, org_id, ids, extra_lines):
            return [LabelSpec(name="Widget", barcode_value="ABC123")], 2

        monkeypatch.setitem(ls.MODULE_LABELS, "fake", ("inventory.view", fake_builder))
        svc = LabelService(MagicMock())
        pdf, auto = await svc.generate(uuid4(), "fake", ["1"], "letter")
        assert pdf.getvalue()[:4] == b"%PDF"
        assert auto == 2

    async def test_empty_result_raises(self, monkeypatch):
        async def empty_builder(db, org_id, ids, extra_lines):
            return [], 0

        monkeypatch.setitem(
            ls.MODULE_LABELS, "empty", ("inventory.view", empty_builder)
        )
        svc = LabelService(MagicMock())
        with pytest.raises(ValueError, match="No records"):
            await svc.generate(uuid4(), "empty", ["1"])


class TestRenderer:
    def test_renders_sheet_pdf(self):
        specs = [
            LabelSpec(
                name="Thermal Camera",
                barcode_value="INV-000001",
                asset_tag="A1",
                serial_number="S1",
                extra="Station 1 | PPE",
            )
        ]
        assert render_labels(specs, "letter").getvalue()[:4] == b"%PDF"

    def test_renders_thermal_rollo_pdf(self):
        specs = [LabelSpec(name="Engine 5", barcode_value="E5")]
        assert render_labels(specs, "rollo_4x6").getvalue()[:4] == b"%PDF"

    def test_renders_custom_size_pdf(self):
        specs = [LabelSpec(name="x", barcode_value="y")]
        out = render_labels(specs, "custom", custom_width=1.5, custom_height=0.5)
        assert out.getvalue()[:4] == b"%PDF"

    def test_custom_requires_dimensions(self):
        with pytest.raises(ValueError, match="custom_width"):
            render_labels([LabelSpec(name="x", barcode_value="y")], "custom")

    def test_unknown_format_raises(self):
        with pytest.raises(ValueError, match="Unknown label format"):
            render_labels([LabelSpec(name="x", barcode_value="y")], "bogus")
