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


def module_permission_prefix(module: str) -> str:
    """The permission namespace a label module authorizes against.

    Matches the module key except for ``membership``, whose grants are
    ``members.*``.
    """
    return "members" if module == "membership" else module


class TestGetPreset:
    async def test_none_when_member_has_no_position(self):
        svc, _ = _service(None, None)
        r = await svc.get_preset(uuid4(), uuid4(), "inventory")
        assert r["preset"] is None
        assert r["position_id"] is None
        assert r["module"] == "inventory"

    async def test_returns_the_modules_preset(self):
        position = SimpleNamespace(
            settings={
                "label_presets": {
                    "inventory": {"preset": "rollo_4x6", "printer_id": "printer-2"}
                }
            }
        )
        svc, _ = _service("pos-1", position)
        r = await svc.get_preset(uuid4(), uuid4(), "inventory")
        assert r["preset"] == "rollo_4x6"
        assert r["printer_id"] == "printer-2"
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

    async def test_persists_printer_destination_with_the_module(self):
        position = SimpleNamespace(settings=None)
        svc, _ = _service("p", position)
        r = await svc.set_preset(
            uuid4(), uuid4(), "apparatus", "dymo_30334", printer_id="printer-2"
        )
        assert position.settings["label_presets"]["apparatus"]["printer_id"] == (
            "printer-2"
        )
        assert r["printer_id"] == "printer-2"

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
            assert ls.required_permissions_for_module(m)

    def test_unknown_module(self):
        assert not ls.is_known_label_module("nope")
        assert ls.required_permissions_for_module("nope") is None

    #: Modules whose labels are deliberately manage-only. Inventory's gear
    #: catalogue requires inventory.manage, and a label document naming
    #: arbitrary item ids is a read of that catalogue — registering
    #: inventory.view here would leave the generic endpoint as a way around
    #: the page gate, since every seeded member holds it.
    MANAGE_ONLY_MODULES = {"inventory"}

    def test_every_module_accepts_its_manage_grant(self):
        """A manage-only user must be able to print.

        ``permission_matches`` does not treat manage as implying view, so a
        module registering only its view grant would lock out the very people
        who run the printer. This is the invariant that matters; whether the
        view grant is *also* accepted is a per-module policy decision covered
        by the next test.
        """
        for module, (permissions, _) in ls.MODULE_LABELS.items():
            assert f"{module_permission_prefix(module)}.manage" in permissions, module

    def test_view_grant_is_registered_except_where_deliberately_manage_only(self):
        for module, (permissions, _) in ls.MODULE_LABELS.items():
            actions = {p.split(".")[-1] for p in permissions}
            if module in self.MANAGE_ONLY_MODULES:
                assert actions == {"manage"}, (
                    f"{module} is manage-only by policy; registering a view "
                    "grant here reopens the page gate through this endpoint"
                )
            else:
                assert actions == {"view", "manage"}, module


class TestAuthorizeModule:
    """Endpoint-layer gate: either the view or the manage grant opens the
    label endpoints (the print-labels route accepts both, so a manage-only
    user must not land on an all-403 page)."""

    @staticmethod
    def _user(*permissions):
        return SimpleNamespace(
            positions=[SimpleNamespace(permissions=list(permissions))],
            rank=None,
        )

    def test_view_only_is_accepted(self):
        from app.api.v1.endpoints.labels import _authorize_module

        _authorize_module(self._user("facilities.view"), "facilities")

    def test_manage_only_is_accepted(self):
        from app.api.v1.endpoints.labels import _authorize_module

        _authorize_module(self._user("facilities.manage"), "facilities")

    def test_other_module_permissions_are_rejected(self):
        from fastapi import HTTPException

        from app.api.v1.endpoints.labels import _authorize_module

        with pytest.raises(HTTPException) as exc:
            _authorize_module(self._user("inventory.manage"), "facilities")
        assert exc.value.status_code == 403

    def test_inventory_view_alone_cannot_print_inventory_labels(self):
        """The generic endpoint must not be a way around the page gate.

        `/inventory/print-labels` and `POST /inventory/labels/generate` both
        require `inventory.manage`. This endpoint takes a `module` field, so
        without the same restriction here a member holding the baseline
        `inventory.view` could post the same item ids with
        `module: "inventory"` and get the identical document back.
        """
        from fastapi import HTTPException

        from app.api.v1.endpoints.labels import _authorize_module

        with pytest.raises(HTTPException) as exc:
            _authorize_module(self._user("inventory.view"), "inventory")
        assert exc.value.status_code == 403

        # The quartermaster still prints.
        _authorize_module(self._user("inventory.manage"), "inventory")

    def test_unknown_module_is_not_found(self):
        from fastapi import HTTPException

        from app.api.v1.endpoints.labels import _authorize_module

        with pytest.raises(HTTPException) as exc:
            _authorize_module(self._user("facilities.manage"), "unknown")
        assert exc.value.status_code == 404


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
        pdf, auto, count = await svc.generate(uuid4(), "fake", ["1"], "letter")
        assert pdf.getvalue()[:4] == b"%PDF"
        assert auto == 2
        assert count == 1

    async def test_returns_count_of_specs_actually_rendered(self, monkeypatch):
        """The audit trail (labels.py) uses this count, not len(ids), so it
        must reflect what was actually rendered, not what was requested."""

        async def two_of_three_builder(db, org_id, ids, extra_lines):
            # Simulates one requested id being filtered/nonexistent.
            return [
                LabelSpec(name="A", barcode_value="A1"),
                LabelSpec(name="B", barcode_value="B1"),
            ], 0

        monkeypatch.setitem(
            ls.MODULE_LABELS, "partial", ("inventory.view", two_of_three_builder)
        )
        svc = LabelService(MagicMock())
        _, _, count = await svc.generate(uuid4(), "partial", ["1", "2", "3"], "letter")
        assert count == 2

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

    @pytest.mark.parametrize(
        ("width", "height"),
        [(0.49, 1), (8.01, 1), (1, 0.49), (1, 11.01)],
    )
    def test_custom_rejects_unprintable_dimensions(self, width, height):
        with pytest.raises(ValueError, match="custom label dimensions"):
            render_labels(
                [LabelSpec(name="x", barcode_value="y")],
                "custom",
                custom_width=width,
                custom_height=height,
            )

    def test_rejects_empty_or_unencodable_barcode(self):
        with pytest.raises(ValueError, match="Code128-compatible"):
            render_labels([LabelSpec(name="x", barcode_value="火火")], "letter")

    def test_rejects_partially_unencodable_barcode_instead_of_truncating(self):
        with pytest.raises(ValueError, match="Code128-compatible"):
            render_labels([LabelSpec(name="x", barcode_value="INV-12火")], "letter")

    def test_rejects_barcode_too_long_for_selected_label(self):
        with pytest.raises(ValueError, match="too long for the selected label size"):
            render_labels(
                [LabelSpec(name="Long barcode", barcode_value="X" * 255)],
                "thermal_1x1",
            )

    def test_unknown_format_raises(self):
        with pytest.raises(ValueError, match="Unknown label format"):
            render_labels([LabelSpec(name="x", barcode_value="y")], "bogus")
