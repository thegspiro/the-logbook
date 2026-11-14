"""The rules a department's shift history is imported by.

Pure-function tests over ``shift_history_import_engine``: no database. Each
group pins one decision agreed when the import was specified, so a later
change to a tolerance or an ordering is a visible test change rather than a
silent shift in how years of records land.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import pytest

from app.services import shift_history_import_engine as engine
from app.services.shift_history_import_engine import (
    AnalysisContext,
    ExistingExternalEntry,
    ExistingShift,
    ExternalUnit,
    MemberRecord,
    OwnUnit,
    RowInput,
)

pytestmark = pytest.mark.unit

NY = ZoneInfo("America/New_York")
NOW = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
MAPPING = {f: f for f in engine.FIELDS}

ALICE = MemberRecord(
    id="u-alice",
    first_name="Alice",
    last_name="Ng",
    preferred_name="",
    membership_number="101",
    email="alice@fd.test",
    personal_email="",
    username="alice",
    status="active",
)
BOB = MemberRecord(
    id="u-bob",
    first_name="Bob",
    last_name="Diaz",
    preferred_name="Bobby",
    membership_number="102",
    email="bob@fd.test",
    personal_email="",
    username="bob",
    status="active",
)
CARL = MemberRecord(
    id="u-carl",
    first_name="Carl",
    last_name="Ortiz",
    preferred_name="",
    membership_number="103",
    email="carl@fd.test",
    personal_email="",
    username="carl",
    status="active",
)
A106E = OwnUnit(id="app-a106e", unit_number="A106E", name="Volunteer Ambulance")
E1 = OwnUnit(id="app-e1", unit_number="E1", name="Engine 1")
COUNTY_A106 = ExternalUnit(
    id="ext-a106", name="A106", agency_id="ag-county", agency_name="County EMS"
)


def _row(line: int, **values: Any) -> RowInput:
    cells = {
        "member_name": "",
        "membership_number": "",
        "unit": "E1",
        "date": "2025-03-01",
        "start_time": "07:00",
        "end_time": "07:00",
    }
    cells.update({k: str(v) for k, v in values.items()})
    return RowInput(
        id=f"r{line}",
        line_number=line,
        raw=cells,
        edits=None,
        excluded=False,
        match_decision=values.pop("_decision", None) if "_decision" in values else None,
    )


def _context(**overrides: Any) -> AnalysisContext:
    base: Dict[str, Any] = dict(
        organization_name="Volunteer FD",
        members=[ALICE, BOB, CARL],
        own_units=[A106E, E1],
        external_units=[COUNTY_A106],
        department_seats=["Tiller"],
        member_mappings={},
        unit_mappings={},
        position_mappings={},
        existing_shift_decisions={},
    )
    base.update(overrides)
    return AnalysisContext(**base)


def _analyze(rows: List[RowInput], **overrides: Any) -> engine.Analysis:
    parsed = engine.parse_rows(rows, MAPPING, NY, NOW)
    return engine.analyze(parsed, _context(**overrides))


def _codes(analysis: engine.Analysis) -> List[str]:
    return [i.code for i in analysis.issues]


def _parse(**values: Any) -> engine.ParsedRow:
    return engine.parse_row(
        _row(2, membership_number="101", **values), MAPPING, NY, NOW
    )


class TestColumnDetection:
    def test_recognises_common_export_headers(self):
        mapping = engine.detect_column_mapping(
            [
                "Employee Name",
                "Badge #",
                "Apparatus",
                "Shift Date",
                "Time In",
                "Time Out",
                "Calls",
                "Riding Position",
            ]
        )
        assert mapping == {
            "member_name": "Employee Name",
            "membership_number": "Badge #",
            "unit": "Apparatus",
            "date": "Shift Date",
            "start_time": "Time In",
            "end_time": "Time Out",
            "call_count": "Calls",
            "position": "Riding Position",
        }

    def test_a_header_feeds_one_field_only(self):
        mapping = engine.detect_column_mapping(["name", "unit"])
        assert list(mapping.values()).count("name") == 1

    def test_template_headers_detect_onto_themselves(self):
        mapping = engine.detect_column_mapping(list(engine.TEMPLATE_HEADERS))
        assert all(mapping[h] == h for h in engine.TEMPLATE_HEADERS)

    def test_edits_take_precedence_over_cells(self):
        values = engine.effective_values(
            {"Unit": "E1"}, {"unit": "E2"}, {"unit": "Unit"}
        )
        assert values["unit"] == "E2"


class TestTimes:
    @pytest.mark.parametrize(
        ("cell", "expected"),
        [
            ("07:00", (7, 0)),
            ("0700", (7, 0)),
            ("700", (7, 0)),
            ("7:30 PM", (19, 30)),
            ("12:00 am", (0, 0)),
            ("7pm", (19, 0)),
            ("24:00", (0, 0)),
            ("06:00:00", (6, 0)),
        ],
    )
    def test_clock_spellings(self, cell, expected):
        parsed = engine.parse_clock(cell)
        assert parsed is not None
        assert (parsed.hour, parsed.minute) == expected

    @pytest.mark.parametrize("cell", ["25:00", "7:75", "noon", "13pm", ""])
    def test_not_a_time(self, cell):
        assert engine.parse_clock(cell) is None

    def test_end_before_start_crosses_midnight(self):
        row = _parse(start_time="07:00", end_time="06:00")
        assert row.minutes == 23 * 60
        assert row.local_date == date(2025, 3, 1)

    def test_equal_times_are_a_24_hour_shift(self):
        row = _parse(start_time="07:00", end_time="07:00")
        assert row.minutes == 24 * 60

    def test_times_read_in_the_import_zone_and_stored_utc(self):
        row = _parse(date="2025-07-01", start_time="07:00", end_time="19:00")
        assert row.start == datetime(2025, 7, 1, 11, 0, tzinfo=timezone.utc)

    def test_spring_forward_night_is_an_hour_short(self):
        # 2025-03-09: clocks jump 02:00 -> 03:00 in New York.
        row = _parse(date="2025-03-08", start_time="19:00", end_time="07:00")
        assert row.minutes == 11 * 60

    def test_a_skipped_wall_time_moves_forward(self):
        row = _parse(date="2025-03-09", start_time="02:30", end_time="06:00")
        # 02:30 does not exist; read with the pre-change offset it is 03:30 EDT.
        assert row.start == datetime(2025, 3, 9, 7, 30, tzinfo=timezone.utc)

    def test_a_repeated_wall_time_reads_as_its_first_occurrence(self):
        row = _parse(date="2025-11-02", start_time="01:30", end_time="06:00")
        assert row.start == datetime(2025, 11, 2, 5, 30, tzinfo=timezone.utc)

    def test_start_cell_may_carry_the_date(self):
        row = _parse(date="", start_time="10/9/2025 07:00", end_time="06:00")
        assert row.local_date == date(2025, 10, 9)
        assert row.minutes == 23 * 60

    def test_us_date_order(self):
        row = _parse(date="3/4/2025")
        assert row.local_date == date(2025, 3, 4)

    def test_a_shift_that_has_not_ended_is_refused(self):
        row = _parse(date="2026-10-09", start_time="07:00", end_time="07:00")
        assert any("not ended" in e for e in row.errors)


class TestRowValidation:
    @pytest.mark.parametrize("status", ["Cancelled", "canceled", "No-Show", "no show"])
    def test_cancelled_and_no_show_rows_are_skipped(self, status):
        row = _parse(status=status)
        assert row.skipped_reason
        assert not row.active

    def test_missing_unit_is_an_error(self):
        row = _parse(unit="")
        assert "No unit." in row.errors

    def test_bad_call_count_is_an_error(self):
        assert _parse(call_count="ten").errors
        assert _parse(call_count="2.5").errors
        assert _parse(call_count="10").call_count == 10

    def test_name_forms(self):
        assert engine.split_name("Smith, John A") == ("John", "Smith")
        assert engine.split_name("John A Smith") == ("John", "Smith")


class TestMembers:
    def test_membership_number_matches(self):
        analysis = _analyze([_row(2, membership_number="101", member_name="Alice Ng")])
        assert analysis.members[0].user_id == "u-alice"
        assert analysis.can_commit

    def test_reused_badge_with_another_surname_goes_to_review(self):
        analysis = _analyze([_row(2, membership_number="101", member_name="Pat Jones")])
        assert analysis.members[0].status == engine.MEMBER_CONFLICT
        assert "member_conflict" in _codes(analysis)

    def test_names_match_exactly_including_preferred_name(self):
        analysis = _analyze([_row(2, member_name="Bobby Diaz")])
        assert analysis.members[0].user_id == "u-bob"

    def test_a_close_name_is_not_a_match(self):
        analysis = _analyze([_row(2, member_name="J. Ng")])
        assert analysis.members[0].status == engine.MEMBER_UNMATCHED
        assert not analysis.can_commit

    def test_mapping_resolves_an_unmatched_name(self):
        analysis = _analyze(
            [_row(2, member_name="A. Ng")],
            member_mappings={"name:a. ng": {"action": "map", "user_id": "u-alice"}},
        )
        assert analysis.members[0].ref == "u-alice"
        assert analysis.can_commit

    def test_mapping_to_someone_outside_the_directory_is_ignored(self):
        analysis = _analyze(
            [_row(2, member_name="A. Ng")],
            member_mappings={"name:a. ng": {"action": "map", "user_id": "u-other"}},
        )
        assert analysis.members[0].ref is None

    def test_create_keeps_the_files_identifiers(self):
        analysis = _analyze(
            [_row(2, member_name="Dana Former", membership_number="77")],
            member_mappings={"number:77": {"action": "create"}},
        )
        assert analysis.members[0].ref == "new:number:77"
        assert analysis.can_commit

    def test_create_cannot_take_an_identifier_someone_holds(self):
        analysis = _analyze(
            [_row(2, member_name="Pat Jones", membership_number="101")],
            member_mappings={"number:101": {"action": "create"}},
        )
        assert "new_member_identifier_taken" in _codes(analysis)


class TestRememberedDecisions:
    def test_a_remembered_mapping_settles_a_name_the_draft_has_not(self):
        analysis = _analyze(
            [_row(2, member_name="A. Ng")],
            saved_member_mappings={
                "name:a. ng": {"action": "map", "user_id": "u-alice"}
            },
        )
        member = analysis.members[0]
        assert member.ref == "u-alice"
        assert member.remembered
        assert analysis.can_commit

    def test_the_drafts_own_decision_wins(self):
        analysis = _analyze(
            [_row(2, member_name="A. Ng")],
            member_mappings={"name:a. ng": {"action": "map", "user_id": "u-bob"}},
            saved_member_mappings={
                "name:a. ng": {"action": "map", "user_id": "u-alice"}
            },
        )
        assert analysis.members[0].ref == "u-bob"
        assert not analysis.members[0].remembered

    def test_a_remembered_mapping_to_someone_gone_settles_nothing(self):
        analysis = _analyze(
            [_row(2, member_name="A. Ng")],
            saved_member_mappings={
                "name:a. ng": {"action": "map", "user_id": "u-gone"}
            },
        )
        assert analysis.members[0].ref is None
        assert not analysis.members[0].remembered

    def test_units_and_positions_are_remembered_too(self):
        analysis = _analyze(
            [_row(2, membership_number="101", unit="Rig 9", position="Nozzle")],
            saved_unit_mappings={"|rig 9": {"action": "own", "id": "app-e1"}},
            saved_position_mappings={"nozzle": {"seat": "firefighter"}},
        )
        assert analysis.units[0].ref == (engine.OWN, "app-e1")
        assert analysis.units[0].remembered
        assert analysis.positions[0].remembered
        assert analysis.can_commit


class TestUnits:
    def test_a106_and_a106e_are_different_vehicles(self):
        analysis = _analyze(
            [
                _row(2, membership_number="101", unit="A106E"),
                _row(3, membership_number="102", unit="A106"),
            ]
        )
        by_unit = {u.unit: u for u in analysis.units}
        assert by_unit["A106E"].ref == (engine.OWN, "app-a106e")
        assert by_unit["A106"].ref == (engine.EXTERNAL, "ext-a106")
        assert len(analysis.shifts) == 1
        assert len(analysis.external) == 1

    def test_an_agency_column_scopes_the_match(self):
        analysis = _analyze(
            [_row(2, membership_number="101", unit="E1", agency="County EMS")]
        )
        assert analysis.units[0].status == engine.UNIT_UNMATCHED

    def test_unknown_unit_can_become_a_new_outside_unit(self):
        analysis = _analyze(
            [_row(2, membership_number="101", unit="M7")],
            unit_mappings={
                "|m7": {
                    "action": "create_external",
                    "agency_name": "Metro",
                    "unit_name": "M7",
                }
            },
        )
        assert analysis.units[0].ref == (engine.NEW_EXTERNAL, "|m7")
        assert analysis.external[0].role == ""
        assert analysis.can_commit


class TestPositions:
    def test_blank_position_is_the_default_seat(self):
        analysis = _analyze([_row(2, membership_number="101")])
        assert analysis.shifts[0].attendances[0].seat == "firefighter"

    def test_department_seat_matches(self):
        analysis = _analyze([_row(2, membership_number="101", position="tiller")])
        assert analysis.shifts[0].attendances[0].seat == "Tiller"

    def test_unknown_position_needs_mapping(self):
        analysis = _analyze([_row(2, membership_number="101", position="Nozzle")])
        assert "position_unmatched" in _codes(analysis)
        mapped = _analyze(
            [_row(2, membership_number="101", position="Nozzle")],
            position_mappings={"nozzle": {"seat": "firefighter"}},
        )
        assert mapped.can_commit


class TestJoining:
    def test_split_entries_join_into_one_stretch(self):
        # A previous system that could not count past midnight: logged as
        # 06:00-06:00 and then 06:00-07:30 the next morning.
        analysis = _analyze(
            [
                _row(
                    2,
                    membership_number="101",
                    date="2025-10-09",
                    start_time="06:00",
                    end_time="06:00",
                    call_count=3,
                ),
                _row(
                    3,
                    membership_number="101",
                    date="2025-10-10",
                    start_time="06:00",
                    end_time="07:30",
                    call_count=1,
                ),
            ]
        )
        assert len(analysis.shifts) == 1
        att = analysis.shifts[0].attendances[0]
        assert att.joined
        assert att.minutes == 25 * 60 + 30
        assert att.call_count == 4
        assert analysis.shifts[0].shift_date == date(2025, 10, 9)

    def test_the_tail_does_not_join_the_next_days_crew(self):
        analysis = _analyze(
            [
                _row(
                    2,
                    membership_number="101",
                    date="2025-10-09",
                    start_time="06:00",
                    end_time="06:00",
                ),
                _row(
                    3,
                    membership_number="101",
                    date="2025-10-10",
                    start_time="06:00",
                    end_time="07:30",
                ),
                _row(
                    4,
                    membership_number="102",
                    date="2025-10-10",
                    start_time="07:00",
                    end_time="07:00",
                ),
            ]
        )
        crews = sorted(
            (s.shift_date, sorted(a.member_ref for a in s.attendances))
            for s in analysis.shifts
        )
        assert crews == [
            (date(2025, 10, 9), ["u-alice"]),
            (date(2025, 10, 10), ["u-bob"]),
        ]

    def test_a_reviewer_can_split_a_joined_entry_back_apart(self):
        rows = [
            _row(
                2,
                membership_number="101",
                date="2025-10-09",
                start_time="06:00",
                end_time="06:00",
            ),
            _row(
                3,
                membership_number="101",
                date="2025-10-10",
                start_time="06:00",
                end_time="07:30",
            ),
        ]
        rows[1].keep_separate = True
        analysis = _analyze(rows)
        attendances = [a for s in analysis.shifts for a in s.attendances]
        assert sorted(a.minutes for a in attendances) == [90, 24 * 60]
        assert not any(a.joined for a in attendances)

    def test_a_gap_over_thirty_minutes_does_not_join(self):
        analysis = _analyze(
            [
                _row(2, membership_number="101", start_time="07:00", end_time="12:00"),
                _row(3, membership_number="101", start_time="12:31", end_time="19:00"),
            ]
        )
        assert sum(len(s.attendances) for s in analysis.shifts) == 2

    def test_overlapping_entries_are_flagged(self):
        analysis = _analyze(
            [
                _row(2, membership_number="101"),
                _row(3, membership_number="101"),
            ]
        )
        assert "overlapping_entries" in _codes(analysis)
        assert not analysis.can_commit


class TestGrouping:
    def test_crew_with_close_times_is_one_shift(self):
        analysis = _analyze(
            [
                _row(2, membership_number="101", start_time="07:00", end_time="07:00"),
                _row(3, membership_number="102", start_time="07:15", end_time="07:00"),
            ]
        )
        assert len(analysis.shifts) == 1
        assert analysis.shifts[0].attendances[1].confidence >= 90

    def test_a_probable_match_is_held_for_review(self):
        rows = [
            _row(2, membership_number="101", start_time="07:00", end_time="07:00"),
            _row(3, membership_number="102", start_time="08:00", end_time="07:00"),
        ]
        analysis = _analyze(rows)
        late = analysis.shifts[0].attendances[1]
        assert 60 <= late.confidence < 90
        assert late.needs_confirmation
        assert "probable_match" in _codes(analysis)

    def test_reviewer_can_confirm_or_split_a_probable_match(self):
        def run(decision: Optional[str]) -> engine.Analysis:
            rows = [
                _row(2, membership_number="101", start_time="07:00", end_time="07:00"),
                _row(3, membership_number="102", start_time="08:00", end_time="07:00"),
            ]
            rows[1].match_decision = decision
            return _analyze(rows)

        accepted = run("accept")
        assert len(accepted.shifts) == 1
        assert accepted.can_commit
        separated = run("separate")
        assert len(separated.shifts) == 2
        assert separated.can_commit

    def test_far_apart_times_are_separate_shifts(self):
        analysis = _analyze(
            [
                _row(2, membership_number="101", start_time="07:00", end_time="19:00"),
                _row(3, membership_number="102", start_time="19:00", end_time="07:00"),
            ]
        )
        assert len(analysis.shifts) == 2

    def test_different_units_are_different_shifts(self):
        analysis = _analyze(
            [
                _row(2, membership_number="101", unit="E1"),
                _row(3, membership_number="102", unit="A106E"),
            ]
        )
        assert len(analysis.shifts) == 2

    def test_same_member_twice_on_one_shift_is_flagged(self):
        # Two pieces for one member more than 30 minutes apart do not join,
        # yet each scores as a probable match for the same 24-hour crew.
        rows = [
            _row(2, membership_number="102", start_time="07:00", end_time="07:00"),
            _row(3, membership_number="101", start_time="07:00", end_time="07:10"),
            _row(4, membership_number="101", start_time="07:45", end_time="07:00"),
        ]
        analysis = _analyze(rows)
        assert len(analysis.shifts) == 1
        assert "duplicate_member_in_shift" in _codes(analysis)


class TestExisting:
    def _existing(self, start_minute: int, attendees=frozenset()) -> ExistingShift:
        start = datetime(2025, 3, 1, 7, tzinfo=NY).astimezone(timezone.utc)
        start += timedelta(minutes=start_minute)
        return ExistingShift(
            id="s-existing",
            apparatus_id="app-e1",
            shift_date=date(2025, 3, 1),
            start=start,
            end=start + timedelta(hours=24),
            attendee_ids=attendees,
        )

    def test_a_matching_shift_on_the_schedule_is_reused(self):
        analysis = _analyze(
            [_row(2, membership_number="101")],
            existing_shifts=[self._existing(0)],
        )
        assert analysis.shifts[0].existing_status == engine.EXISTING_AUTO
        assert analysis.shifts[0].existing_shift_id == "s-existing"

    def test_a_member_already_recorded_there_is_skipped(self):
        analysis = _analyze(
            [_row(2, membership_number="101"), _row(3, membership_number="102")],
            existing_shifts=[self._existing(0, frozenset({"u-alice"}))],
        )
        flags = {
            a.member_ref: a.duplicate_existing for a in analysis.shifts[0].attendances
        }
        assert flags == {"u-alice": True, "u-bob": False}
        assert analysis.can_commit

    def test_nothing_left_to_write_cannot_commit(self):
        analysis = _analyze(
            [_row(2, membership_number="101")],
            existing_shifts=[self._existing(0, frozenset({"u-alice"}))],
        )
        assert analysis.blocking_issue_count == 0
        assert not analysis.can_commit

    def test_a_probable_existing_match_needs_a_decision(self):
        rows = [_row(2, membership_number="101")]
        pending = _analyze(rows, existing_shifts=[self._existing(30)])
        assert pending.shifts[0].existing_status == engine.EXISTING_PENDING
        assert "probable_existing_match" in _codes(pending)
        accepted = _analyze(
            rows,
            existing_shifts=[self._existing(30)],
            existing_shift_decisions={"r2": "accept"},
        )
        assert accepted.shifts[0].attaches_to_existing
        assert accepted.can_commit

    def test_hours_already_logged_on_an_outside_unit_are_skipped(self):
        start = datetime(2025, 3, 1, 7, tzinfo=NY).astimezone(timezone.utc)
        analysis = _analyze(
            [_row(2, membership_number="101", unit="A106")],
            existing_external=[
                ExistingExternalEntry(
                    user_id="u-alice",
                    external_apparatus_id="ext-a106",
                    shift_date=date(2025, 3, 1),
                    start=start,
                    end=start + timedelta(hours=24),
                )
            ],
        )
        assert analysis.external[0].duplicate_existing


class TestConfidence:
    def test_identical_times_are_certain(self):
        t = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)
        assert engine.match_confidence(t, t, t, t) == 100

    def test_two_hours_apart_on_both_ends_is_zero(self):
        t = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)
        later = t + timedelta(hours=2)
        assert engine.match_confidence(t, t, later, later) == 0

    def test_the_article_follows_how_the_percentage_is_read(self):
        assert engine.percent_phrase(85) == "an 85%"
        assert engine.percent_phrase(80) == "an 80%"
        assert engine.percent_phrase(70) == "a 70%"
        assert engine.percent_phrase(60) == "a 60%"
        assert engine.percent_phrase(11) == "an 11%"
        assert engine.percent_phrase(18) == "an 18%"
        assert engine.percent_phrase(100) == "a 100%"

    def test_a_probable_match_message_reads_an_85_percent(self):
        analysis = _analyze(
            [
                _row(2, membership_number="101", start_time="07:00", end_time="07:00"),
                _row(3, membership_number="102", start_time="07:30", end_time="07:00"),
            ]
        )
        message = next(i.message for i in analysis.issues if i.code == "probable_match")
        assert message.startswith("Line 3 is an 85% match for the shift starting")


# ---------------------------------------------------------------------------
# Rows routed here by a historical data import: stated hours, duty type,
# calls by type, source ids, per-unit seats, number-only former members.
# ---------------------------------------------------------------------------

AMBULANCE = OwnUnit(
    id="app-a102", unit_number="A102", name="Ambulance", seats=("driver", "emt")
)
LADDER = OwnUnit(
    id="app-la106",
    unit_number="LA106",
    name="Ladder",
    seats=("driver", "officer", "firefighter"),
)


class TestStatedHours:
    def test_stated_hours_are_credited_over_the_clock_span(self):
        analysis = _analyze(
            [
                _row(
                    2,
                    membership_number="101",
                    start_time="0945",
                    end_time="1015",
                    hours="2.5",
                )
            ]
        )
        attendance = analysis.shifts[0].attendances[0]
        assert attendance.span_minutes == 30
        assert attendance.minutes == 150

    def test_a_24_hour_shift_logged_0800_to_0800_keeps_its_24_hours(self):
        analysis = _analyze(
            [
                _row(
                    2,
                    membership_number="101",
                    start_time="0800",
                    end_time="0800",
                    hours="24.0",
                )
            ]
        )
        assert analysis.shifts[0].attendances[0].minutes == 24 * 60

    def test_zero_hours_is_skipped_not_an_error(self):
        parsed = _parse(hours="0.0")
        assert parsed.skipped_reason == "Recorded as 0 hours."
        assert parsed.errors == []

    def test_unreadable_hours_is_an_error(self):
        assert _parse(hours="twelve").errors

    def test_joined_rows_sum_their_stated_hours_not_the_gap(self):
        analysis = _analyze(
            [
                _row(
                    2,
                    membership_number="101",
                    start_time="0700",
                    end_time="1200",
                    hours="5",
                ),
                _row(
                    3,
                    membership_number="101",
                    start_time="1220",
                    end_time="1500",
                    hours="2",
                ),
            ]
        )
        attendance = analysis.shifts[0].attendances[0]
        assert attendance.joined
        assert attendance.minutes == 7 * 60

    def test_without_an_hours_column_the_span_is_credited_as_before(self):
        analysis = _analyze(
            [_row(2, membership_number="101", start_time="0700", end_time="1900")]
        )
        assert analysis.shifts[0].attendances[0].minutes == 12 * 60

    def test_hours_is_never_detected_from_a_header(self):
        mapping = engine.detect_column_mapping(
            ["Name", "Unit", "Date", "Hours", "Shift Type"]
        )
        assert "hours" not in mapping
        assert "duty_type" not in mapping


class TestDutyType:
    def test_on_call_and_in_station_on_one_unit_and_day_are_separate_shifts(self):
        analysis = _analyze(
            [
                _row(2, membership_number="101", start_time="0700", end_time="1900"),
                _row(
                    3,
                    membership_number="102",
                    start_time="0700",
                    end_time="1900",
                    duty_type="on_call",
                ),
            ]
        )
        assert sorted(s.duty_type for s in analysis.shifts) == ["in_station", "on_call"]
        assert all(len(s.attendances) == 1 for s in analysis.shifts)

    def test_recall_is_read_as_on_call(self):
        assert _parse(duty_type="Recall").duty_type == "on_call"

    def test_standby_is_not_guessed(self):
        assert _parse(duty_type="Standby").errors

    def test_on_call_never_attaches_to_an_in_station_shift_on_the_schedule(self):
        start = datetime(2025, 3, 1, 12, tzinfo=timezone.utc)
        existing = ExistingShift(
            id="s-existing",
            apparatus_id="app-e1",
            shift_date=date(2025, 3, 1),
            start=start,
            end=start + timedelta(hours=24),
            attendee_ids=frozenset(),
        )
        analysis = _analyze(
            [_row(2, membership_number="101", duty_type="on_call")],
            existing_shifts=[existing],
        )
        assert analysis.shifts[0].existing_shift_id is None


class TestCallTypes:
    def test_typed_columns_total_into_the_call_count(self):
        rows = [
            _row(2, membership_number="101", **{"calls:ems": "3", "calls:fire": "1"})
        ]
        mapping = {**MAPPING, "calls:ems": "calls:ems", "calls:fire": "calls:fire"}
        parsed = engine.parse_rows(rows, mapping, NY, NOW)
        assert parsed[0].call_counts == {"ems": 3, "fire": 1}
        assert parsed[0].call_count == 4

    def test_joined_rows_add_their_typed_calls(self):
        rows = [
            _row(
                2,
                membership_number="101",
                start_time="0700",
                end_time="1200",
                **{"calls:ems": "2"},
            ),
            _row(
                3,
                membership_number="101",
                start_time="1210",
                end_time="1500",
                **{"calls:ems": "1"},
            ),
        ]
        mapping = {**MAPPING, "calls:ems": "calls:ems"}
        analysis = engine.analyze(engine.parse_rows(rows, mapping, NY, NOW), _context())
        assert analysis.shifts[0].attendances[0].call_counts == {"ems": 3}

    def test_a_bad_typed_count_is_an_error(self):
        rows = [_row(2, membership_number="101", **{"calls:ems": "two"})]
        mapping = {**MAPPING, "calls:ems": "calls:ems"}
        assert engine.parse_rows(rows, mapping, NY, NOW)[0].errors


class TestSourceIds:
    def test_a_row_the_ledger_holds_is_skipped(self):
        analysis = _analyze(
            [_row(2, membership_number="101", source_id="81395")],
            imported_source_ids=frozenset({"81395"}),
        )
        assert analysis.rows[0].skipped_reason == "Already imported (source row 81395)."
        assert not analysis.can_commit

    def test_one_id_twice_in_a_file_is_blocking(self):
        analysis = _analyze(
            [
                _row(2, membership_number="101", source_id="7"),
                _row(3, membership_number="102", source_id="7", date="2025-03-02"),
            ]
        )
        assert "duplicate_source_id" in _codes(analysis)

    def test_source_ids_are_collected_for_the_ledger_lookup(self):
        parsed = engine.parse_rows(
            [
                _row(2, membership_number="101", source_id="b"),
                _row(3, membership_number="101", source_id="a"),
            ],
            MAPPING,
            NY,
            NOW,
        )
        assert engine.source_ids(parsed) == ["a", "b"]


class TestUnitDefaultSeat:
    def test_an_ambulance_crew_is_not_seated_as_firefighters(self):
        analysis = _analyze(
            [_row(2, membership_number="101", unit="A102")],
            own_units=[AMBULANCE, E1],
        )
        assert "unit_default_seat" in _codes(analysis)
        assert analysis.shifts == []

    def test_the_reviewer_chooses_the_units_seat(self):
        analysis = _analyze(
            [_row(2, membership_number="101", unit="A102")],
            own_units=[AMBULANCE, E1],
            unit_mappings={
                "|a102": {"action": "own", "id": "app-a102", "default_seat": "emt"}
            },
        )
        assert analysis.can_commit
        assert analysis.shifts[0].attendances[0].seat == "emt"

    def test_a_unit_listing_firefighter_keeps_the_default(self):
        analysis = _analyze(
            [_row(2, membership_number="101", unit="LA106")],
            own_units=[LADDER],
        )
        assert analysis.shifts[0].attendances[0].seat == "firefighter"

    def test_a_named_position_still_wins_over_the_unit_default(self):
        analysis = _analyze(
            [_row(2, membership_number="101", unit="A102", position="driver")],
            own_units=[AMBULANCE],
        )
        assert analysis.shifts[0].attendances[0].seat == "driver"


class TestNumberOnlyFormerMembers:
    def test_a_number_only_member_can_be_created(self):
        analysis = _analyze(
            [_row(2, membership_number="6178")],
            member_mappings={"number:6178": {"action": "create"}},
        )
        assert "new_member_without_name" not in _codes(analysis)
        member = analysis.members[0]
        assert engine.new_member_name(member) == ("Former member", "6178")

    def test_a_typed_name_is_used_for_the_new_member(self):
        analysis = _analyze(
            [_row(2, membership_number="6178")],
            member_mappings={
                "number:6178": {
                    "action": "create",
                    "first_name": "Pat",
                    "last_name": "Lee",
                }
            },
        )
        assert engine.new_member_name(analysis.members[0]) == ("Pat", "Lee")

    def test_a_member_with_nothing_to_be_called_by_is_still_refused(self):
        analysis = _analyze(
            [_row(2, email="nobody@fd.test")],
            member_mappings={"email:nobody@fd.test": {"action": "create"}},
        )
        assert "new_member_without_name" in _codes(analysis)
