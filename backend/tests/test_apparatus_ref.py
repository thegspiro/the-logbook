"""Tests for the polymorphic ``shifts.apparatus_id`` resolver.

``shifts.apparatus_id`` holds an ``apparatus.id`` for a department running the
full Apparatus module and a ``basic_apparatus.id`` for one that only completed
onboarding — ``GET /scheduling/apparatus-options`` serves whichever it finds,
in that priority order. Nothing enforced the distinction, and the two consumers
each assumed the *other* source:

* equipment-check submission copied the shift's id into a real FK to
  ``apparatus.id``, so every submission on a BasicApparatus department failed
  the constraint with a 500;
* shift create/update validated the id against ``BasicApparatus`` only, so a
  department on the full Apparatus module could not assign an apparatus to a
  shift at all.

These lock both directions in. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.utils.apparatus_ref import (
    apparatus_ref_exists,
    resolve_apparatus_display_map,
    resolve_apparatus_labels,
    resolve_apparatus_ref,
)


def _scalars_first(obj):
    """Mock a result whose ``.scalars().first()`` yields ``obj``."""
    result = MagicMock()
    result.scalars.return_value.first.return_value = obj
    return result


def _scalars_all(items):
    """Mock a result whose ``.scalars().all()`` yields ``items``."""
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _full_apparatus(apparatus_id="app-1", type_name="Engine", **kwargs):
    """A full Apparatus row, with its type relationship already loaded."""
    return SimpleNamespace(
        id=apparatus_id,
        organization_id=kwargs.get("organization_id", "org-1"),
        unit_number=kwargs.get("unit_number", "Engine 3"),
        name=kwargs.get("name", "Old Reliable"),
        min_staffing=kwargs.get("min_staffing", 4),
        apparatus_type=(
            SimpleNamespace(name=type_name) if type_name is not None else None
        ),
    )


def _basic_apparatus(apparatus_id="basic-1", **kwargs):
    return SimpleNamespace(
        id=apparatus_id,
        organization_id=kwargs.get("organization_id", "org-1"),
        unit_number=kwargs.get("unit_number", "Engine 3"),
        name=kwargs.get("name", "Engine 3"),
        apparatus_type=kwargs.get("apparatus_type", "engine"),
        min_staffing=kwargs.get("min_staffing", 3),
        positions=kwargs.get("positions", ["officer", "driver"]),
    )


class TestResolveApparatusRef:
    async def test_resolves_a_full_apparatus_id(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalars_first(_full_apparatus())])

        ref = await resolve_apparatus_ref(db, "app-1", "org-1")

        assert ref.exists
        assert ref.full is not None
        assert ref.basic is None
        assert ref.full_id == "app-1"
        # The full table is queried first and short-circuits, mirroring the
        # options endpoint's own priority.
        assert db.execute.await_count == 1

    async def test_resolves_a_basic_apparatus_id(self):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_first(None),  # not a full Apparatus
                _scalars_first(_basic_apparatus()),
            ]
        )

        ref = await resolve_apparatus_ref(db, "basic-1", "org-1")

        assert ref.exists
        assert ref.basic is not None
        assert ref.full is None

    async def test_basic_apparatus_has_no_full_id(self):
        """The whole point: a BasicApparatus shift stores NULL, not its own id.

        ``shift_equipment_checks.apparatus_id`` is a real FK to ``apparatus.id``,
        so writing the basic id there is what raised the constraint error.
        """
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_scalars_first(None), _scalars_first(_basic_apparatus())]
        )

        ref = await resolve_apparatus_ref(db, "basic-1", "org-1")

        assert ref.full_id is None

    async def test_unknown_id_resolves_to_nothing(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalars_first(None), _scalars_first(None)])

        ref = await resolve_apparatus_ref(db, "nope", "org-1")

        assert not ref.exists
        assert ref.full_id is None
        assert ref.type_slug is None
        assert ref.unit_label == ""

    async def test_fails_closed_on_missing_inputs(self):
        """A falsy id or org resolves to nothing without touching the database."""
        db = MagicMock()
        db.execute = AsyncMock()

        assert not (await resolve_apparatus_ref(db, None, "org-1")).exists
        assert not (await resolve_apparatus_ref(db, "app-1", None)).exists
        assert not (await resolve_apparatus_ref(db, "", "org-1")).exists
        db.execute.assert_not_awaited()


class TestTypeSlug:
    async def test_full_apparatus_type_comes_from_the_relationship(self):
        """Regression: the old code read ``apparatus.type``, which does not exist.

        ``Apparatus`` has ``apparatus_type_id`` and an ``apparatus_type``
        relationship — no ``type`` attribute at all. The AttributeError was
        latent only because the id never matched a row, so the branch was dead.
        """
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_scalars_first(_full_apparatus(type_name="Ladder"))]
        )

        ref = await resolve_apparatus_ref(db, "app-1", "org-1")

        assert ref.type_slug == "ladder"

    async def test_full_apparatus_without_a_type_is_none(self):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_scalars_first(_full_apparatus(type_name=None))]
        )

        ref = await resolve_apparatus_ref(db, "app-1", "org-1")

        assert ref.type_slug is None

    async def test_basic_apparatus_type_comes_from_the_inline_column(self):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_first(None),
                _scalars_first(_basic_apparatus(apparatus_type="Rescue")),
            ]
        )

        ref = await resolve_apparatus_ref(db, "basic-1", "org-1")

        assert ref.type_slug == "rescue"


class TestUnitLabel:
    async def test_prefers_unit_number_over_name(self):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_first(_full_apparatus(unit_number="E-3", name="Reliable"))
            ]
        )

        ref = await resolve_apparatus_ref(db, "app-1", "org-1")

        assert ref.unit_label == "E-3"

    async def test_basic_apparatus_falls_back_to_name(self):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_first(None),
                _scalars_first(_basic_apparatus(unit_number=None, name="Brush 1")),
            ]
        )

        ref = await resolve_apparatus_ref(db, "basic-1", "org-1")

        assert ref.unit_label == "Brush 1"


class TestApparatusRefExists:
    async def test_true_for_either_table(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalars_first(_full_apparatus())])
        assert await apparatus_ref_exists(db, "app-1", "org-1") is True

        db.execute = AsyncMock(
            side_effect=[_scalars_first(None), _scalars_first(_basic_apparatus())]
        )
        assert await apparatus_ref_exists(db, "basic-1", "org-1") is True

    async def test_false_for_an_id_in_neither(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalars_first(None), _scalars_first(None)])
        assert await apparatus_ref_exists(db, "foreign", "org-1") is False


class TestDisplayMap:
    async def test_maps_ids_from_both_tables(self):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_all([_full_apparatus("app-1", type_name="Engine")]),
                _scalars_all([_basic_apparatus("basic-1")]),
            ]
        )

        result = await resolve_apparatus_display_map(db, ["app-1", "basic-1"], "org-1")

        assert set(result) == {"app-1", "basic-1"}
        assert result["app-1"].apparatus_type == "engine"
        assert result["app-1"].min_staffing == 4
        assert result["basic-1"].min_staffing == 3

    async def test_skips_the_second_query_when_the_first_resolved_everything(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalars_all([_full_apparatus("app-1")])])

        await resolve_apparatus_display_map(db, ["app-1"], "org-1")

        assert db.execute.await_count == 1

    async def test_riding_positions_are_basic_apparatus_only(self):
        """The full module does not model riding positions, so it reports None.

        Callers fall back to the shift's own positions, so this has to read as
        "not specified" rather than "no positions".
        """
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_all([_full_apparatus("app-1")]),
            ]
        )

        result = await resolve_apparatus_display_map(db, ["app-1"], "org-1")

        assert result["app-1"].positions is None

    async def test_unresolved_ids_are_absent_rather_than_none_valued(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalars_all([]), _scalars_all([])])

        result = await resolve_apparatus_display_map(db, ["gone"], "org-1")

        assert result == {}

    async def test_empty_input_touches_no_database(self):
        db = MagicMock()
        db.execute = AsyncMock()

        assert await resolve_apparatus_display_map(db, [], "org-1") == {}
        assert await resolve_apparatus_display_map(db, ["a"], None) == {}
        db.execute.assert_not_awaited()

    async def test_labels_wrapper_returns_display_strings(self):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_all([_full_apparatus("app-1", unit_number="Engine 3")]),
            ]
        )

        labels = await resolve_apparatus_labels(db, ["app-1"], "org-1")

        assert labels == {"app-1": "Engine 3"}
