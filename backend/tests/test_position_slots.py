"""
Tests for the canonical crew-seat form written to the positions JSON columns
(app/utils/positions.py).

Three writers filled shifts.positions, shift_templates.positions and
basic_apparatus.positions three different ways — bare strings, structured
{"position", "required"} objects, and (templates only) an event-metadata dict
that is not a seat list. Readers had to tell those apart, and the templates
screen did not, rendering an object as a React child. Pure logic; no DB.
"""

import pytest

from app.utils.positions import normalize_stored_positions


class TestFlatSeatLists:
    def test_converts_legacy_strings(self):
        assert normalize_stored_positions(["officer", "driver"]) == [
            {"position": "officer", "required": True},
            {"position": "driver", "required": True},
        ]

    def test_preserves_an_explicit_optional_seat(self):
        assert normalize_stored_positions(
            [{"position": "firefighter", "required": False}]
        ) == [{"position": "firefighter", "required": False}]

    @pytest.mark.parametrize("flag", [None, "yes", 1])
    def test_only_an_explicit_false_makes_a_seat_optional(self, flag):
        # The frontend reads `required !== false`; a missing or null flag on a
        # legacy row means the seat is required, not optional.
        assert normalize_stored_positions([{"position": "ems", "required": flag}]) == [
            {"position": "ems", "required": True}
        ]

    def test_defaults_a_missing_flag_to_required(self):
        assert normalize_stored_positions([{"position": "ems"}]) == [
            {"position": "ems", "required": True}
        ]

    def test_is_idempotent(self):
        once = normalize_stored_positions(["officer", {"position": "ems"}])
        assert normalize_stored_positions(once) == once

    @pytest.mark.parametrize(
        "junk", [[""], ["   "], [{"position": ""}], [{"position": None}], [{}], [None]]
    )
    def test_drops_seats_with_no_usable_name(self, junk):
        # An unnamed seat cannot be assigned to and renders blank; keeping it
        # would only inflate the staffing target.
        assert normalize_stored_positions(junk) == []

    def test_trims_surrounding_whitespace(self):
        assert normalize_stored_positions([" officer "]) == [
            {"position": "officer", "required": True}
        ]


class TestNonSeatValues:
    def test_leaves_event_template_metadata_untouched(self):
        # Event templates store resource metadata in this same column.
        meta = {
            "event_type": "parade",
            "resources": [{"type": "engine", "quantity": 1, "positions": ["officer"]}],
            "flat_positions": ["officer"],
        }
        assert normalize_stored_positions(meta) == meta

    @pytest.mark.parametrize("value", [None, "", 0])
    def test_passes_through_non_lists(self, value):
        assert normalize_stored_positions(value) == value

    def test_empty_list_stays_empty(self):
        assert normalize_stored_positions([]) == []


class TestWritePathWiring:
    """The helper only matters if the write paths actually call it."""

    @staticmethod
    def _service():
        from unittest.mock import AsyncMock, MagicMock

        from app.services.scheduling_service import SchedulingService

        db = MagicMock()
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.rollback = AsyncMock()
        return SchedulingService(db), db

    async def test_create_template_normalizes_a_legacy_seat_list(self):
        from uuid import uuid4

        service, db = self._service()

        record, error = await service.create_template(
            uuid4(), {"name": "Day Shift", "positions": ["officer", "driver"]}, uuid4()
        )

        assert error is None
        added = db.add.call_args[0][0]
        assert added.positions == [
            {"position": "officer", "required": True},
            {"position": "driver", "required": True},
        ]
        assert record is added

    async def test_create_template_leaves_event_metadata_alone(self):
        from uuid import uuid4

        service, db = self._service()
        meta = {
            "event_type": "parade",
            "resources": [{"type": "engine", "quantity": 1, "positions": ["officer"]}],
        }

        _, error = await service.create_template(
            uuid4(), {"name": "Parade", "positions": meta}, uuid4()
        )

        assert error is None
        assert db.add.call_args[0][0].positions == meta

    async def test_update_template_normalizes_a_legacy_seat_list(self):
        from unittest.mock import AsyncMock
        from uuid import uuid4

        from app.models.training import ShiftTemplate

        service, _ = self._service()
        template = ShiftTemplate(name="Day Shift", positions=["officer"])
        service.get_template_by_id = AsyncMock(return_value=template)

        _, error = await service.update_template(
            uuid4(), uuid4(), {"positions": [{"position": "ems", "required": False}]}
        )

        assert error is None
        assert template.positions == [{"position": "ems", "required": False}]

    async def test_create_shift_normalizes_a_legacy_seat_list(self):
        from uuid import uuid4

        service, db = self._service()
        from unittest.mock import AsyncMock

        db.flush = AsyncMock()

        _, error = await service.create_shift(
            uuid4(), {"shift_date": "2026-08-18", "positions": ["ems"]}, uuid4()
        )

        assert error is None
        assert db.add.call_args[0][0].positions == [
            {"position": "ems", "required": True}
        ]

    async def test_update_shift_normalizes_a_legacy_seat_list(self):
        # The path that used to corrupt data: the structured editor spreads
        # each entry, so a string seat saved back as {0: 'e', 1: 'm', 2: 's'}.
        from unittest.mock import AsyncMock
        from uuid import uuid4

        from app.models.training import Shift

        service, _ = self._service()
        shift = Shift(positions=["ems"])
        service.get_shift_by_id = AsyncMock(return_value=shift)
        service._requalify_drivers_for_shift_change = AsyncMock(return_value=None)

        _, error = await service.update_shift(uuid4(), uuid4(), {"positions": ["ems"]})

        assert error is None
        assert shift.positions == [{"position": "ems", "required": True}]
