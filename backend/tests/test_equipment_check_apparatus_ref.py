"""Equipment-check submission across both apparatus inventories.

The reported bug: submitting an equipment check for **any shift with an
apparatus assigned** returned a 500. ``submit_check`` copied
``shifts.apparatus_id`` — which for a department that only completed onboarding
is a ``basic_apparatus.id`` — straight into
``shift_equipment_checks.apparatus_id``, which is a real foreign key to
``apparatus.id``. The id named no apparatus row, so the constraint failed and
the whole submission was lost.

The fix resolves the shift's id against both tables and stores the full
``Apparatus`` id when there is one, ``NULL`` when there is not. ``NULL`` is the
correct value rather than a lossy one: that department has no full apparatus
record for the vehicle, and the column is nullable with ``ON DELETE SET NULL``
precisely because a check need not be attributable to one.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.equipment_check_service import EquipmentCheckService


def _scalars_first(obj):
    r = MagicMock()
    r.scalars.return_value.first.return_value = obj
    r.scalars.return_value.all.return_value = [obj] if obj is not None else []
    r.scalar_one_or_none.return_value = obj
    r.all.return_value = []
    return r


def _scalars_all(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    r.scalars.return_value.first.return_value = items[0] if items else None
    r.scalar_one_or_none.return_value = None
    r.all.return_value = []
    return r


def _queued_execute(*results):
    """An ``execute`` mock that yields ``results`` in order, then empty results.

    ``submit_check`` runs a tail of queries after the row is built — item
    loading, notification recipients, organization settings. Those have their
    own coverage and are not what these tests assert on, so rather than pin an
    exact query count (which would make the tests fail on any unrelated query
    being added), the queue answers the calls under test and returns an empty
    result for everything after.
    """
    queue = list(results)

    async def _execute(*_args, **_kwargs):
        if queue:
            return queue.pop(0)
        return _scalars_all([])

    return AsyncMock(side_effect=_execute)


def _shift(apparatus_id="basic-1"):
    return SimpleNamespace(
        id="shift-1",
        organization_id="org-1",
        apparatus_id=apparatus_id,
        shift_officer_id=None,
    )


def _items():
    return [{"item_name": "SCBA", "status": "pass", "template_item_id": None}]


async def _submit(db, shift, monkeypatch):
    """Drive submit_check with the surrounding machinery stubbed out.

    Only the apparatus-resolution behaviour is under test here; item creation,
    deficiency flagging and notifications each have their own coverage and would
    otherwise require mocking a large query sequence.
    """
    svc = EquipmentCheckService(db)
    monkeypatch.setattr(
        svc, "_create_check_items", AsyncMock(return_value=None), raising=True
    )
    monkeypatch.setattr(
        svc, "_update_apparatus_deficiency", AsyncMock(return_value=None), raising=True
    )
    monkeypatch.setattr(
        svc, "_notify_check_result", AsyncMock(return_value=None), raising=False
    )
    return await svc.submit_check(
        shift_id="shift-1",
        organization_id="org-1",
        checked_by="user-1",
        data={"items": _items(), "template_id": None},
        allow_manage=True,
    )


class TestSubmitCheckApparatusResolution:
    async def test_basic_apparatus_shift_stores_null_not_the_basic_id(
        self, monkeypatch
    ):
        """The reported 500. Writing the basic id here violated the FK."""
        captured = {}

        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_shift("basic-1")),  # load the shift
            _scalars_first(None),  # not a full Apparatus
            _scalars_first(SimpleNamespace(id="basic-1")),  # is a BasicApparatus
        )
        db.add = MagicMock(side_effect=lambda obj: captured.setdefault("check", obj))
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()

        await _submit(db, _shift("basic-1"), monkeypatch)

        check = captured["check"]
        assert check.apparatus_id is None, (
            "a basic_apparatus id must never be written into a column whose "
            "foreign key targets apparatus.id"
        )
        assert check.shift_id == "shift-1"

    async def test_full_apparatus_shift_stores_the_apparatus_id(self, monkeypatch):
        captured = {}

        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_shift("app-1")),
            _scalars_first(
                SimpleNamespace(
                    id="app-1",
                    unit_number="Engine 3",
                    name="Engine 3",
                    min_staffing=4,
                    apparatus_type=SimpleNamespace(name="Engine"),
                )
            ),
        )
        db.add = MagicMock(side_effect=lambda obj: captured.setdefault("check", obj))
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()

        await _submit(db, _shift("app-1"), monkeypatch)

        assert captured["check"].apparatus_id == "app-1"

    async def test_shift_with_no_apparatus_stores_null(self, monkeypatch):
        """Previously the only case that worked — it must keep working."""
        captured = {}

        db = MagicMock()
        db.execute = _queued_execute(_scalars_first(_shift(None)))
        db.add = MagicMock(side_effect=lambda obj: captured.setdefault("check", obj))
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()

        await _submit(db, _shift(None), monkeypatch)

        assert captured["check"].apparatus_id is None

    async def test_foreign_apparatus_id_stores_null_rather_than_leaking(
        self, monkeypatch
    ):
        """Resolution is org-scoped, so another tenant's id resolves to nothing.

        It cannot be stored, which would otherwise attach this org's check to a
        foreign apparatus record (XC-1).
        """
        captured = {}

        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_shift("other-org-apparatus")),
            _scalars_first(None),  # not in this org's Apparatus
            _scalars_first(None),  # nor its BasicApparatus
        )
        db.add = MagicMock(side_effect=lambda obj: captured.setdefault("check", obj))
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()

        await _submit(db, _shift("other-org-apparatus"), monkeypatch)

        assert captured["check"].apparatus_id is None


def _apparatus(apparatus_id="app-1", type_name="Engine"):
    return SimpleNamespace(
        id=apparatus_id,
        unit_number="Engine 3",
        name="Engine 3",
        min_staffing=4,
        apparatus_type=SimpleNamespace(name=type_name),
    )


def _basic(apparatus_id="basic-1", apparatus_type="engine"):
    return SimpleNamespace(
        id=apparatus_id,
        unit_number="Engine 3",
        name="Engine 3",
        apparatus_type=apparatus_type,
        min_staffing=3,
        positions=None,
    )


def _shift_with_template(apparatus_id="app-1", template_id="shift-tmpl-1"):
    """A shift whose ShiftTemplate names its checklists explicitly."""
    shift = _shift(apparatus_id)
    shift.template_id = template_id
    return shift


def _template(template_id, **kwargs):
    return SimpleNamespace(
        id=template_id,
        is_active=kwargs.get("is_active", True),
        assigned_positions=kwargs.get("assigned_positions"),
        apparatus_type=kwargs.get("apparatus_type"),
    )


class TestResolveTemplates:
    """Template resolution has to work for both inventories.

    Templates are defined per-apparatus (an FK to ``apparatus.id``) or per
    apparatus *type* (a plain string). A BasicApparatus department has no full
    apparatus records, so only the type route can match — and the old code
    reached that route through ``Apparatus.type``, an attribute the model does
    not have.
    """

    async def test_basic_apparatus_shift_matches_type_level_templates(self):
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(None),  # resolve: not a full Apparatus
            _scalars_first(_basic()),  # but a BasicApparatus, type "engine"
            _scalars_all([_template("t1", apparatus_type="engine")]),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift("basic-1"), "org-1", user_position=None
        )

        assert [t.id for t in templates] == ["t1"]

    async def test_full_apparatus_shift_prefers_apparatus_specific_templates(self):
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_apparatus()),
            _scalars_all([_template("t-specific")]),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift("app-1"), "org-1", user_position=None
        )

        assert [t.id for t in templates] == ["t-specific"]

    async def test_full_apparatus_falls_back_to_its_type(self):
        """Regression: this branch read ``apparatus.type`` and would have raised.

        The AttributeError was latent only because the id never resolved, so the
        branch was unreachable. Fixing the id would have unmasked it.
        """
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_apparatus(type_name="Ladder")),
            _scalars_all([]),  # no apparatus-specific templates
            _scalars_all([_template("t-type", apparatus_type="ladder")]),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift("app-1"), "org-1", user_position=None
        )

        assert [t.id for t in templates] == ["t-type"]

    async def test_unresolvable_apparatus_yields_no_templates(self):
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(None),
            _scalars_first(None),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift("gone"), "org-1", user_position=None
        )

        assert templates == []

    async def test_inactive_templates_are_filtered_out(self):
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_apparatus()),
            _scalars_all([_template("live"), _template("dead", is_active=False)]),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift("app-1"), "org-1", user_position=None
        )

        assert [t.id for t in templates] == ["live"]

    async def test_a_draft_apparatus_template_does_not_suppress_the_type_one(self):
        """A draft is not a checklist, so it must not block the fallback.

        `_advance_content_revision` sets is_active=False on every item or
        compartment edit, and a new template now saves as a draft by default.
        Deciding precedence before filtering meant an officer opening the
        Engine 1 template took the published "Engine — start of shift"
        checklist off every Engine 1 shift: `get_my_checklists` showed
        nothing, and `submit_check` refused anyone who still had the form
        open. Readiness and the reminder task filter first, so both went on
        reporting a MISSING check for a checklist nobody was offered.
        """
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_apparatus()),
            _scalars_all([_template("draft-specific", is_active=False)]),
            _scalars_all([_template("t-type", apparatus_type="engine")]),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift("app-1"), "org-1", user_position=None
        )

        assert [t.id for t in templates] == ["t-type"]

    async def test_a_published_apparatus_template_still_wins(self):
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_apparatus()),
            _scalars_all(
                [_template("live-specific"), _template("draft", is_active=False)]
            ),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift("app-1"), "org-1", user_position=None
        )

        assert [t.id for t in templates] == ["live-specific"]

    async def test_a_draft_type_template_is_not_offered_either(self):
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_apparatus()),
            _scalars_all([]),
            _scalars_all([_template("draft-type", is_active=False)]),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift("app-1"), "org-1", user_position=None
        )

        assert templates == []

    async def test_a_linked_draft_checklist_is_not_offered(self):
        """A shift template's explicit links go through the active filter too.

        Editing a published checklist sets ``is_active=False``, so without
        this the crew is handed the half-edited contents of a checklist an
        officer is still working on. ``explicit`` stays True either way — it
        is set from the link rows, not from what they resolve to — so this
        resolves to nothing rather than falling through to the apparatus's
        checklist, which is the documented precedence rule.
        """
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_all(["linked-draft"]),
            _scalars_all([_template("linked-draft", is_active=False)]),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift_with_template("app-1"), "org-1", user_position=None
        )

        assert templates == []

    async def test_a_linked_published_checklist_is_offered_in_the_officers_order(self):
        """The active ones survive, in the order the link rows name."""
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_all(["second", "first"]),
            _scalars_all(
                [
                    _template("first"),
                    _template("second"),
                    _template("linked-draft", is_active=False),
                ]
            ),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift_with_template("app-1"), "org-1", user_position=None
        )

        assert [t.id for t in templates] == ["second", "first"]

    async def test_position_filter_still_applies(self):
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_apparatus()),
            _scalars_all(
                [
                    _template("driver-only", assigned_positions=["driver"]),
                    _template("everyone"),
                ]
            ),
        )
        svc = EquipmentCheckService(db)

        templates = await svc._resolve_templates(
            _shift("app-1"), "org-1", user_position="officer"
        )

        assert [t.id for t in templates] == ["everyone"]


class TestSubmitCheckGuards:
    async def test_missing_shift_is_rejected(self):
        db = MagicMock()
        db.execute = _queued_execute(_scalars_first(None))
        svc = EquipmentCheckService(db)

        with pytest.raises(ValueError, match="Shift not found"):
            await svc.submit_check(
                shift_id="nope",
                organization_id="org-1",
                checked_by="user-1",
                data={"items": _items()},
                allow_manage=True,
            )

    async def test_empty_items_are_rejected(self):
        db = MagicMock()
        db.execute = _queued_execute(_scalars_first(_shift()))
        svc = EquipmentCheckService(db)

        with pytest.raises(ValueError, match="At least one checklist item"):
            await svc.submit_check(
                shift_id="shift-1",
                organization_id="org-1",
                checked_by="user-1",
                data={"items": []},
                allow_manage=True,
            )

    async def test_unassigned_member_is_rejected(self):
        db = MagicMock()
        db.execute = _queued_execute(
            _scalars_first(_shift()),
            _scalars_first(None),
        )
        svc = EquipmentCheckService(db)

        with pytest.raises(PermissionError, match="Not authorized"):
            await svc.submit_check(
                shift_id="shift-1",
                organization_id="org-1",
                checked_by="user-1",
                data={"items": _items()},
            )
