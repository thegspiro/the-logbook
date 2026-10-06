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
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.schemas.scheduling import ShiftPosition
from app.utils.positions import (
    CANONICAL_POSITIONS,
    POSITION_LABELS,
    canonical_position,
    normalize_stored_positions,
    position_label,
)


@pytest.fixture(autouse=True)
def _department_today(monkeypatch):
    """The service asks the org for its date; answer with the same
    ``date.today()`` the fixtures here are built from."""
    monkeypatch.setattr(
        "app.services.scheduling_service.resolve_org_today",
        AsyncMock(return_value=date.today()),
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
        db.flush = AsyncMock()
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

        assert [slot.model_dump() for slot in option.positions or []] == [
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
    """The built-in seat vocabulary is one set, named three times.

    ``CANONICAL_POSITIONS``, the request-schema ``ShiftPosition`` and the model
    ``ShiftPosition`` must agree. Since SCHED-CUSTOM-SEAT none of them closes
    the vocabulary — a department's own seats are stored verbatim — but each is
    what the code means by "a built-in seat".
    """

    def test_canonical_set_is_exactly_the_signup_enum(self):
        assert CANONICAL_POSITIONS == {p.value for p in ShiftPosition}

    def test_the_model_enum_matches_the_schema_enum(self):
        from app.models.training import ShiftPosition as StoredShiftPosition

        assert {p.value for p in StoredShiftPosition} == {
            p.value for p in ShiftPosition
        }

    def test_no_position_column_is_an_enum(self):
        """A department's own seat has to fit the column it is written to.

        Both position columns were MySQL ENUMs of the built-in seats, so a
        custom seat was refused at the flush even once the request schema
        admitted it (SCHED-CUSTOM-SEAT). They are VARCHAR, sized for the
        longest seat name the Position Names screen accepts.
        """
        from sqlalchemy import String

        from app.models.training import SeatName, ShiftAssignment, StandingShiftClaim
        from app.schemas.scheduling_module_config import CustomPositionSchema
        from app.utils.positions import SEAT_NAME_MAX_LENGTH

        width = CustomPositionSchema.model_fields["value"].metadata
        assert any(
            getattr(m, "max_length", None) == SEAT_NAME_MAX_LENGTH for m in width
        )
        for model in (ShiftAssignment, StandingShiftClaim):
            column_type = model.__table__.c.position.type
            assert isinstance(column_type, SeatName), model.__tablename__
            assert isinstance(column_type.impl, String)
            assert column_type.impl.length == SEAT_NAME_MAX_LENGTH

    def test_startup_normalization_leaves_the_position_columns_alone(self):
        """The startup ENUM pass converts any non-ENUM column it lists back
        into an ENUM. Listing a position column would re-close the vocabulary
        on every boot, or fail on the first custom seat."""
        from app.utils.enum_normalization import _TARGET_COLUMNS

        listed = {(spec.table, spec.column) for spec in _TARGET_COLUMNS}
        assert ("shift_assignments", "position") not in listed
        assert ("standing_shift_claims", "position") not in listed

    def test_a_builtin_enum_member_binds_as_its_value(self):
        """A str-mixin enum is not bound as its value by the MySQL driver: it
        renders through ``str()`` as ``'ShiftPosition.OFFICER'``. The ENUM
        column converted it for us; ``SeatName`` has to do the same."""
        from app.models.training import SeatName
        from app.models.training import ShiftPosition as StoredShiftPosition

        bind = SeatName().process_bind_param(StoredShiftPosition.OFFICER, None)
        assert bind == "officer"
        assert type(bind) is str
        assert SeatName().process_bind_param("rescue_tech", None) == "rescue_tech"
        assert SeatName().process_bind_param(None, None) is None

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


class TestParsedRequestModels:
    """A route hands over parsed models, not dicts.

    ``BasicApparatusCreate.positions`` is ``List[PositionSlot | str]``, so
    ``POST /scheduling/apparatus`` reaches ``normalize_stored_positions`` with
    ``PositionSlot`` instances. Matching neither the str nor the dict branch
    dropped every structured seat and stored ``[]`` — with a 201 and no error —
    while the PATCH sibling, which dumps the payload first, kept them.
    """

    def test_position_slot_models_survive_the_write(self):
        from app.schemas.scheduling import BasicApparatusCreate

        parsed = BasicApparatusCreate(
            unit_number="E1",
            name="Engine 1",
            positions=[
                {
                    "position": "officer",
                    "required": True,
                    "allow_administrative_members": True,
                },
                {"position": "driver", "required": False},
            ],
        )

        assert normalize_stored_positions(parsed.positions) == [
            {
                "position": "officer",
                "required": True,
                "allow_administrative_members": True,
            },
            {
                "position": "driver",
                "required": False,
                "allow_administrative_members": False,
            },
        ]

    def test_a_mixed_list_keeps_both_arms(self):
        from app.schemas.scheduling import BasicApparatusCreate

        parsed = BasicApparatusCreate(
            unit_number="E1",
            name="Engine 1",
            positions=["EMT", {"position": "driver"}],
        )

        assert [
            s["position"] for s in normalize_stored_positions(parsed.positions)
        ] == [
            "ems",
            "driver",
        ]

    def test_create_and_patch_settle_identically(self):
        from app.schemas.scheduling import BasicApparatusCreate, BasicApparatusUpdate

        seats = [{"position": "officer", "required": False}]
        created = BasicApparatusCreate(unit_number="E1", name="E1", positions=seats)
        patched = BasicApparatusUpdate(positions=seats)

        assert normalize_stored_positions(
            created.positions
        ) == normalize_stored_positions(
            patched.model_dump(exclude_unset=True)["positions"]
        )


class TestEventMetadataFlattening:
    """The templates form writes seat objects into ``flat_positions``.

    The display normalizer bound each entry in as the seat *name*, so a shift
    generated from an event template stored a seat inside a seat: unassignable,
    and rejected by ``ShiftResponse`` — one such row 500s the whole calendar.
    """

    @staticmethod
    def _meta(flat):
        return {"event_type": "parade", "resources": [], "flat_positions": flat}

    def test_object_entries_flatten_to_seats(self):
        from app.services.scheduling_service import SchedulingService

        slots = SchedulingService.normalize_positions(
            self._meta(
                [
                    {
                        "position": "officer",
                        "required": True,
                        "allow_administrative_members": True,
                    },
                    {"position": "driver", "required": False},
                ]
            )
        )

        assert slots == [
            {
                "position": "officer",
                "required": True,
                "allow_administrative_members": True,
            },
            {
                "position": "driver",
                "required": False,
                "allow_administrative_members": False,
            },
        ]

    def test_legacy_name_entries_still_flatten(self):
        from app.services.scheduling_service import SchedulingService

        assert SchedulingService.normalize_positions(self._meta(["officer"])) == [
            {"position": "officer", "required": True}
        ]

    def test_flattened_seats_pass_response_validation(self):
        from app.schemas.scheduling import PositionSlot
        from app.services.scheduling_service import SchedulingService

        slots = SchedulingService.normalize_positions(
            self._meta([{"position": "officer", "required": True}])
        )

        # A nested seat satisfies neither arm of ShiftResponse's
        # ``List[PositionSlot | str]``, which is the 500.
        assert [PositionSlot(**slot).position for slot in slots] == ["officer"]


class TestNestedSeatRepair:
    """The migration that unwraps rows already written with a nested seat."""

    @staticmethod
    def _unwrap():
        import importlib.util

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic"
            / "versions"
            / "20260831_0900_f7a1c3b5d9e2_unwrap_nested_seat_names.py"
        )
        spec = importlib.util.spec_from_file_location("_unwrap_seats", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module._unwrap

    def test_unwraps_a_seat_inside_a_seat(self):
        corrupt = [
            {
                "position": {
                    "position": "officer",
                    "required": False,
                    "allow_administrative_members": True,
                },
                "required": True,
            }
        ]

        # The wrapper's ``required`` was a hardcoded True; the admin chose the
        # inner one, so that is the flag the repair must keep.
        assert self._unwrap()(corrupt) == [
            {
                "position": "officer",
                "required": False,
                "allow_administrative_members": True,
            }
        ]

    def test_leaves_healthy_rows_byte_identical(self):
        healthy = [
            {
                "position": "driver",
                "required": True,
                "allow_administrative_members": False,
            }
        ]
        assert self._unwrap()(healthy) == healthy

    def test_drops_an_unnameable_seat(self):
        assert self._unwrap()([{"position": {"required": True}}]) == []

    def test_passes_event_metadata_through(self):
        meta = {"event_type": "parade", "flat_positions": ["officer"]}
        assert self._unwrap()(meta) == meta


class TestSeatDisplayNames:
    """The seat's stored token and its name on screen are two things.

    A department builds a template with two EMT seats and the board listed
    them as "EMS", because the token ("ems") was printed where the label
    belonged. Everything that shows a member a seat name goes through
    `position_label`, so the template screen and the board cannot disagree
    about what one seat is called.
    """

    def test_the_ems_seat_is_called_emt(self):
        assert position_label("ems") == "EMT"

    def test_aliases_resolve_to_the_same_name(self):
        # Rows written before the backend settled on one spelling.
        assert position_label("EMT") == "EMT"
        assert position_label("EMS") == "EMT"
        assert position_label(" emt ") == "EMT"

    def test_enum_members_resolve(self):
        assert position_label(ShiftPosition.EMS) == "EMT"
        assert position_label(ShiftPosition.DRIVER) == "Driver/Operator"

    def test_a_departments_own_seat_is_returned_readable(self):
        # Custom seats are not in the map; a slug is still better than blank,
        # which would leave the seat nameless on a printed roster.
        assert position_label("medic_student") == "Medic Student"

    def test_no_position_names_nothing(self):
        assert position_label(None) == ""
        assert position_label("") == ""

    def test_every_canonical_seat_has_a_label(self):
        # A seat added to the vocabulary with no label renders as its slug.
        assert set(POSITION_LABELS) == set(CANONICAL_POSITIONS)

    def test_frontend_labels_agree(self):
        # Two copies of one mapping, in two languages: a shift roster printed
        # by the backend and the same roster on screen have to name the seat
        # identically, so the frontend map is asserted from source.
        source = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "constants"
            / "enums.ts"
        ).read_text()
        block = re.search(
            r"export const POSITION_LABELS: Record<string, string> = \{(.*?)\n\};",
            source,
            re.S,
        )
        assert block, "POSITION_LABELS not found in enums.ts"
        frontend = dict(re.findall(r"(\w+): '([^']+)'", block.group(1)))
        assert frontend == POSITION_LABELS
