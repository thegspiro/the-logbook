"""
Tests for the canonical crew-seat form written to the positions JSON columns
(app/utils/positions.py).

Three writers filled shifts.positions, shift_templates.positions and
basic_apparatus.positions three different ways — bare strings, structured
{"position", "required"} objects, and (templates only) an event-metadata dict
that is not a seat list. Readers had to tell those apart, and the templates
screen did not, rendering an object as a React child. Pure logic; no DB.
"""

import re
from pathlib import Path

import pytest

from app.schemas.scheduling import ShiftPosition
from app.utils.positions import (
    CANONICAL_POSITIONS,
    canonical_position,
    normalize_stored_positions,
)


class TestFlatSeatLists:
    def test_converts_legacy_strings(self):
        assert normalize_stored_positions(["officer", "driver"]) == [
            {
                "position": "officer",
                "required": True,
                "allow_administrative_members": False,
            },
            {
                "position": "driver",
                "required": True,
                "allow_administrative_members": False,
            },
        ]

    def test_preserves_an_explicit_optional_seat(self):
        assert normalize_stored_positions(
            [
                {
                    "position": "firefighter",
                    "required": False,
                    "allow_administrative_members": False,
                }
            ]
        ) == [
            {
                "position": "firefighter",
                "required": False,
                "allow_administrative_members": False,
            }
        ]

    @pytest.mark.parametrize("flag", [None, "yes", 1])
    def test_only_an_explicit_false_makes_a_seat_optional(self, flag):
        # The frontend reads `required !== false`; a missing or null flag on a
        # legacy row means the seat is required, not optional.
        assert normalize_stored_positions([{"position": "ems", "required": flag}]) == [
            {"position": "ems", "required": True, "allow_administrative_members": False}
        ]

    def test_defaults_a_missing_flag_to_required(self):
        assert normalize_stored_positions([{"position": "ems"}]) == [
            {"position": "ems", "required": True, "allow_administrative_members": False}
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
            {
                "position": "officer",
                "required": True,
                "allow_administrative_members": False,
            }
        ]


class TestCountedSeats:
    """ShiftTemplate.positions documents a `count`. Nothing has ever written
    one, but the migration that rewrites these rows cannot be reversed."""

    def test_expands_a_count_into_that_many_seats(self):
        assert normalize_stored_positions(
            [{"position": "firefighter", "count": 3}]
        ) == [
            {
                "position": "firefighter",
                "required": True,
                "allow_administrative_members": False,
            },
            {
                "position": "firefighter",
                "required": True,
                "allow_administrative_members": False,
            },
            {
                "position": "firefighter",
                "required": True,
                "allow_administrative_members": False,
            },
        ]

    def test_keeps_the_required_flag_on_every_expanded_seat(self):
        assert normalize_stored_positions(
            [
                {
                    "position": "ems",
                    "count": 2,
                    "required": False,
                    "allow_administrative_members": False,
                }
            ]
        ) == [
            {
                "position": "ems",
                "required": False,
                "allow_administrative_members": False,
            },
            {
                "position": "ems",
                "required": False,
                "allow_administrative_members": False,
            },
        ]

    def test_expanded_seats_do_not_share_a_dict(self):
        slots = normalize_stored_positions([{"position": "ems", "count": 2}])
        slots[0]["position"] = "officer"
        assert slots[1]["position"] == "ems"

    @pytest.mark.parametrize("count", [None, 0, -1, "3", 1.5, True])
    def test_an_unusable_count_means_one_seat(self, count):
        assert normalize_stored_positions([{"position": "ems", "count": count}]) == [
            {"position": "ems", "required": True, "allow_administrative_members": False}
        ]

    def test_caps_an_absurd_count(self):
        # Corrupt data, not a staffing plan — min_staffing itself caps at 50.
        assert (
            len(normalize_stored_positions([{"position": "ems", "count": 10**6}])) == 50
        )


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
            {
                "position": "officer",
                "required": True,
                "allow_administrative_members": False,
            },
            {
                "position": "driver",
                "required": True,
                "allow_administrative_members": False,
            },
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
            uuid4(),
            uuid4(),
            {
                "positions": [
                    {
                        "position": "ems",
                        "required": False,
                        "allow_administrative_members": False,
                    }
                ]
            },
        )

        assert error is None
        assert template.positions == [
            {
                "position": "ems",
                "required": False,
                "allow_administrative_members": False,
            }
        ]

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
            {"position": "ems", "required": True, "allow_administrative_members": False}
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
        assert shift.positions == [
            {"position": "ems", "required": True, "allow_administrative_members": False}
        ]


class TestApparatusOptionSchema:
    """The apparatus-options response declared List[str] and 500'd on the
    canonical shape once the write paths started storing slots."""

    def test_accepts_canonical_slots(self):
        from app.schemas.scheduling import ApparatusOption

        option = ApparatusOption(
            name="Engine 1",
            apparatus_type="engine",
            source="basic",
            positions=[
                {
                    "position": "driver",
                    "required": True,
                    "allow_administrative_members": False,
                }
            ],
        )

        assert [position.model_dump() for position in option.positions] == [
            {
                "position": "driver",
                "required": True,
                "allow_administrative_members": False,
            }
        ]

    def test_still_accepts_legacy_strings(self):
        from app.schemas.scheduling import ApparatusOption

        option = ApparatusOption(
            name="Engine 1",
            apparatus_type="engine",
            source="basic",
            positions=["driver"],
        )

        assert option.positions == ["driver"]


class TestMigrationTransform:
    """The migration inlines its own copy of the transform and cannot be
    reversed, so it gets its own coverage rather than riding on the helper's."""

    @staticmethod
    def _migration():
        import importlib.util
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic"
            / "versions"
            / "20260819_2037_1eeb053d59b7_normalize_stored_position_slots.py"
        )
        spec = importlib.util.spec_from_file_location("_seat_migration", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_expands_counted_template_seats(self):
        # Collapsing this would cut a three-firefighter template to one, with
        # no downgrade to put it back.
        assert (
            self._migration()._normalize([{"position": "firefighter", "count": 3}])
            == [
                {"position": "firefighter", "required": True},
            ]
            * 3
        )

    def test_converts_legacy_strings(self):
        assert self._migration()._normalize(["officer"]) == [
            {"position": "officer", "required": True}
        ]

    def test_leaves_event_metadata_untouched(self):
        meta = {"event_type": "parade", "resources": []}
        assert self._migration()._normalize(meta) == meta

    def test_is_idempotent(self):
        normalize = self._migration()._normalize
        once = normalize(["officer", {"position": "ems", "count": 2}])
        assert normalize(once) == once


class TestSeatNameCanonicalization:
    """The seat name is part of the canonical shape, not just the structure.

    The apparatus editor wrote ``"EMT"`` where every other writer wrote
    ``"ems"``. Nothing grants ``"EMT"`` and ``ShiftPosition`` cannot name it, so
    an ambulance built from the defaults had an EMT seat no EMT could fill.
    """

    @pytest.mark.parametrize("spelling", ["EMT", "emt", "EMS", "ems", " ems ", "Ems"])
    def test_every_emt_spelling_settles_on_ems(self, spelling):
        assert canonical_position(spelling) == "ems"
        assert normalize_stored_positions([spelling]) == [
            {"position": "ems", "required": True, "allow_administrative_members": False}
        ]

    def test_the_ambulance_default_becomes_fillable(self):
        # ApparatusBasicPage's DEFAULT_POSITIONS_BY_TYPE['ambulance'].
        assert normalize_stored_positions(["driver", "ems"]) == [
            {
                "position": "driver",
                "required": True,
                "allow_administrative_members": False,
            },
            {
                "position": "ems",
                "required": True,
                "allow_administrative_members": False,
            },
        ]

    @pytest.mark.parametrize("seat", sorted(CANONICAL_POSITIONS))
    def test_canonical_seats_are_fixed_points(self, seat):
        assert canonical_position(seat) == seat

    def test_case_variants_of_builtin_seats_fold(self):
        assert canonical_position("Firefighter") == "firefighter"
        assert canonical_position("OFFICER") == "officer"

    def test_a_departments_custom_seat_round_trips_verbatim(self):
        # A custom position's value is chosen by an admin; folding its case
        # would silently rename their seat.
        assert canonical_position("Medic") == "Medic"
        assert canonical_position("Safety Officer") == "Safety Officer"

    def test_blank_names_are_still_dropped(self):
        assert canonical_position("   ") == ""
        assert normalize_stored_positions(["  ", {"position": ""}]) == []

    def test_required_flag_survives_renaming(self):
        assert normalize_stored_positions(
            [
                {
                    "position": "EMT",
                    "required": False,
                    "allow_administrative_members": False,
                }
            ]
        ) == [
            {
                "position": "ems",
                "required": False,
                "allow_administrative_members": False,
            }
        ]


class TestSeatVocabularyMatchesTheWire:
    """A seat outside ``ShiftPosition`` cannot be signed up for by anyone.

    ``signup_for_shift`` sends a ``ShiftPosition`` and refuses anything the
    member's eligible set does not contain, so a stored seat with no matching
    enum member is unfillable no matter how the department is configured. The
    two lists must not drift apart again.
    """

    def test_canonical_set_is_exactly_the_signup_enum(self):
        assert CANONICAL_POSITIONS == {p.value for p in ShiftPosition}

    def test_the_stored_enum_matches_the_wire_enum(self):
        """A third copy of this vocabulary backs the ENUM columns.

        ``app.models.training.ShiftPosition`` is what SQLAlchemy emits into the
        MySQL ``ENUM(...)`` DDL for ``shift_assignments.position`` and
        ``standing_shift_claims.position``. It is a separate class from the
        request-schema enum asserted above, and the two had drifted: the medic
        seat was added to the schema and to ``CANONICAL_POSITIONS`` while this
        one still listed nine values.

        The failure that causes is invisible until the write. A paramedic
        signup passes request validation, passes the eligibility union, and
        then fails when the ORM flushes a label the column does not allow --
        so the seat looks fillable everywhere except where it counts.
        """
        from app.models.training import ShiftPosition as StoredShiftPosition

        assert {p.value for p in StoredShiftPosition} == {
            p.value for p in ShiftPosition
        }, (
            "the stored enum backing the position ENUM columns has drifted "
            "from the one the signup API accepts"
        )

    def test_every_enum_backed_position_column_is_normalized_at_startup(self):
        """Adding a seat widens the ENUM DDL only for listed columns.

        ``enum_normalization`` compares each listed column's labels against its
        model enum and rewrites the DDL when they differ. That is this
        deployment's delivery mechanism for existing databases, since schema is
        built by ``create_all`` and Alembic is stamped rather than upgraded. A
        ``Enum(ShiftPosition)`` column missing from that list keeps the older
        label set forever, and the seat stays unwritable on exactly the
        installations that already exist.
        """
        import re
        from pathlib import Path as _Path

        from app.utils.enum_normalization import _TARGET_COLUMNS

        model_source = (
            _Path(__file__).resolve().parents[1] / "app" / "models" / "training.py"
        ).read_text()

        # Tables declaring a column typed Enum(ShiftPosition).
        backed = set()
        table = None
        for line in model_source.splitlines():
            match = re.search(r'__tablename__\s*=\s*"([^"]+)"', line)
            if match:
                table = match.group(1)
            if "Enum(ShiftPosition" in line and table:
                backed.add(table)

        assert backed, "no Enum(ShiftPosition) column found — did the type move?"
        listed = {
            spec.table
            for spec in _TARGET_COLUMNS
            if spec.enum_class.__name__ == "ShiftPosition"
        }
        assert backed <= listed, (
            "these tables have an Enum(ShiftPosition) column that startup "
            f"normalization never widens: {sorted(backed - listed)}"
        )

    def test_apparatus_page_seat_values_are_all_canonical(self):
        # The frontend list that caused this bug, asserted from source so a
        # non-canonical seat value cannot be reintroduced there unnoticed.
        source = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "pages"
            / "ApparatusBasicPage.tsx"
        ).read_text()
        block = re.search(r"const POSITION_OPTIONS = \[(.*?)\];", source, re.S)
        assert block, "POSITION_OPTIONS not found in ApparatusBasicPage.tsx"
        seats = re.findall(r"'([^']+)'", block.group(1))
        assert seats, "no seat values parsed"
        assert (
            set(seats) <= CANONICAL_POSITIONS
        ), f"non-canonical apparatus seat values: {set(seats) - CANONICAL_POSITIONS}"

    def test_apparatus_type_defaults_are_all_canonical(self):
        source = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "pages"
            / "ApparatusBasicPage.tsx"
        ).read_text()
        block = re.search(
            r"const DEFAULT_POSITIONS_BY_TYPE: Record<string, string\[\]> = \{(.*?)\n\};",
            source,
            re.S,
        )
        assert block, "DEFAULT_POSITIONS_BY_TYPE not found"
        seats = set(re.findall(r"'([^']+)'", block.group(1)))
        # Keys (apparatus types) appear unquoted, so everything parsed is a seat.
        assert (
            seats <= CANONICAL_POSITIONS
        ), f"non-canonical default seats: {seats - CANONICAL_POSITIONS}"
