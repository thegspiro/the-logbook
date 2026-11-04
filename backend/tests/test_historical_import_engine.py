"""The rules a historical data import reads a previous system's export by.

Pure-function tests over ``historical_import_engine``: no database. The header
row and cell shapes here are the ones a real department export uses — one
column per kind of hour, military times written past 2400, a date column
carrying a midnight timestamp — because those are what the rules exist for.
"""

from datetime import date

import pytest

from app.services import historical_import_engine as engine
from app.services import shift_history_import_engine as shift_engine

pytestmark = pytest.mark.unit

HEADERS = [
    "VID",
    "Date",
    "Start",
    "End",
    "Standby",
    "Training",
    "Admin",
    "PubEd",
    "Recall",
    "UniqueID",
    "EMSCalls",
    "FireCalls",
    "UnitStaffed",
]
CALL_TYPES = [{"slug": "ems", "label": "EMS"}, {"slug": "fire", "label": "Fire"}]
SETTINGS = engine.Settings(
    column_mapping={
        "membership_number": "VID",
        "date": "Date",
        "start_time": "Start",
        "end_time": "End",
        "source_id": "UniqueID",
        "unit": "UnitStaffed",
    },
    hour_columns={
        "Standby": engine.SHIFT,
        "Training": engine.TRAINING,
        "Admin": engine.ADMIN,
        "PubEd": engine.ADMIN,
        "Recall": engine.ON_CALL,
    },
    call_columns={"EMSCalls": "ems", "FireCalls": "fire"},
)


def _raw(**cells: str) -> dict:
    base = {header: "" for header in HEADERS}
    base.update(
        {
            "VID": "6178",
            "Date": "2015-11-08 00:00:00.000",
            "Start": "1930",
            "End": "2130",
            "UniqueID": "81395",
        }
    )
    base.update(cells)
    return base


def _route(line: int = 2, **cells: str) -> engine.RowRouting:
    return engine.route_row(
        engine.RowInput(id=f"r{line}", line_number=line, raw=_raw(**cells)), SETTINGS
    )


class TestDetection:
    def test_a_department_export_is_read_without_mapping(self):
        mapping = engine.detect_column_mapping(HEADERS)
        assert mapping == SETTINGS.column_mapping

    def test_hours_columns_are_recognised_by_kind(self):
        taken = list(engine.detect_column_mapping(HEADERS).values())
        assert engine.detect_hour_columns(HEADERS, taken) == SETTINGS.hour_columns

    def test_call_columns_match_the_departments_call_types(self):
        assert engine.detect_call_columns(HEADERS, CALL_TYPES) == SETTINGS.call_columns

    def test_a_call_column_for_a_type_the_department_lacks_is_left_alone(self):
        assert engine.detect_call_columns(["HazmatCalls"], CALL_TYPES) == {}


class TestRouting:
    def test_one_nonzero_column_is_one_record_keeping_its_id(self):
        routing = _route(Admin="2.0", Standby="0.0", Training="0.0")
        assert [i.record_type for i in routing.items] == [engine.ADMIN]
        item = routing.items[0]
        assert item.source_id == "81395"
        assert item.minutes == 120
        assert item.local_date == date(2015, 11, 8)

    def test_recall_routes_as_on_call(self):
        assert _route(Recall="10.0").items[0].record_type == engine.ON_CALL

    def test_a_row_with_no_hours_is_skipped(self):
        routing = _route(Standby="0.0", Admin="")
        assert routing.items == []
        assert routing.skipped_reason == "No hours recorded."

    def test_hours_in_two_columns_become_two_records_with_distinct_ids(self):
        routing = _route(Standby="12", Training="2")
        assert sorted(i.source_id for i in routing.items) == [
            "81395#Standby",
            "81395#Training",
        ]

    def test_unreadable_hours_is_an_error(self):
        routing = _route(Standby="twelve")
        assert routing.errors == ["Standby 'twelve' is not a number of hours."]
        assert routing.items == []

    def test_ignored_columns_are_not_read(self):
        settings = engine.Settings(
            column_mapping=SETTINGS.column_mapping,
            hour_columns={"Standby": engine.IGNORE},
            call_columns={},
        )
        routing = engine.route_row(
            engine.RowInput(id="r", line_number=2, raw=_raw(Standby="12")), settings
        )
        assert routing.skipped_reason == "No hours recorded."

    def test_a_row_without_an_id_column_gets_a_stable_fingerprint(self):
        first = engine.fingerprint(_raw(Standby="12"))
        assert first == engine.fingerprint(_raw(Standby="12"))
        assert first != engine.fingerprint(_raw(Standby="13"))
        assert first.startswith("row:")


class TestCleanUp:
    def test_recorded_hours_that_disagree_with_the_clock_are_noted(self):
        item = _route(Start="1015", End="1345", Training="4.0").items[0]
        assert (
            "hours_differ",
            "Recorded hours (4) used instead of the clock times (3.5 h).",
        ) in item.notes
        assert item.minutes == 240

    def test_an_overnight_shift_is_noted(self):
        item = _route(Start="1800", End="0800", Standby="14").items[0]
        assert ("next_day", "Ends the next day.") in item.notes

    def test_an_end_written_past_2400_is_read_as_the_next_days_clock(self):
        item = _route(Start="2200", End="2445", Standby="2.75").items[0]
        assert item.end_cell == "0045"
        assert item.local_date == date(2015, 11, 8)
        assert not any(kind == "hours_differ" for kind, _ in item.notes)

    def test_a_start_written_past_2400_moves_to_the_next_day(self):
        item = _route(Start="2400", End="0800", Standby="8").items[0]
        assert item.start_cell == "0000"
        assert item.local_date == date(2015, 11, 9)
        assert any(kind == "past_midnight" for kind, _ in item.notes)

    @pytest.mark.parametrize("cell", ["1930", "0700", "2359", "7:00", "4800"])
    def test_ordinary_times_are_left_alone(self, cell):
        assert engine.normalize_clock_cell(cell) == (cell, False)

    def test_the_summary_counts_types_and_clean_up(self):
        routings = [
            _route(2, Standby="12", UniqueID="1", Start="0700", End="1900"),
            _route(3, Admin="2", UniqueID="2", Start="1015", End="1345"),
            _route(4, UniqueID="3"),
        ]
        summary = engine.summarize(routings)
        assert summary["types"]["shift"]["records"] == 1
        assert summary["types"]["admin"]["hours"] == 2
        assert summary["types"]["shift"]["first_date"] == "2015-11-08"
        assert summary["skipped"] == 1
        assert summary["notes"]["hours_differ"]["count"] == 1


class TestShiftBatches:
    def _rows(self, specs):
        rows, routings = [], []
        for line, (day, column, uid) in enumerate(specs, start=2):
            row = engine.RowInput(
                id=f"r{line}",
                line_number=line,
                raw=_raw(Date=day, UniqueID=uid, **{column: "12"}),
            )
            rows.append(row)
            routings.append(engine.route_row(row, SETTINGS))
        return rows, routings

    def test_only_shift_and_on_call_rows_are_batched(self):
        rows, routings = self._rows(
            [
                ("2015-01-05", "Standby", "1"),
                ("2015-01-06", "Training", "2"),
                ("2015-01-07", "Recall", "3"),
            ]
        )
        batches = engine.build_shift_batches(rows, routings, SETTINGS)
        assert len(batches) == 1
        assert sorted(values["duty_type"] for _, values in batches[0].rows) == [
            shift_engine.DUTY_IN_STATION,
            shift_engine.DUTY_ON_CALL,
        ]

    def test_months_are_packed_whole_up_to_the_target(self):
        specs = [("2015-01-05", "Standby", "a1"), ("2015-01-06", "Standby", "a2")]
        specs += [("2015-02-05", "Standby", "b1"), ("2015-03-05", "Standby", "c1")]
        rows, routings = self._rows(specs)
        batches = engine.build_shift_batches(rows, routings, SETTINGS, target_rows=3)
        assert [b.label for b in batches] == ["2015-01 to 2015-02", "2015-03"]
        assert [len(b.rows) for b in batches] == [3, 1]

    def test_rows_already_imported_are_left_out(self):
        rows, routings = self._rows(
            [("2015-01-05", "Standby", "1"), ("2015-01-06", "Standby", "2")]
        )
        batches = engine.build_shift_batches(
            rows, routings, SETTINGS, already_imported=frozenset({"1"})
        )
        assert [values["source_id"] for _, values in batches[0].rows] == ["2"]

    def test_undated_rows_get_a_batch_of_their_own(self):
        rows, routings = self._rows([("not a date", "Standby", "1")])
        batches = engine.build_shift_batches(rows, routings, SETTINGS)
        assert batches[0].label == "rows without a date"

    def test_a_batch_row_speaks_the_shift_imports_field_names(self):
        row = engine.RowInput(
            id="r2",
            line_number=2,
            raw=_raw(
                Start="2200",
                End="2445",
                Standby="2.75",
                EMSCalls="2",
                UnitStaffed="LA106",
            ),
        )
        routing = engine.route_row(row, SETTINGS)
        values = engine.shift_row(row.raw, routing.items[0], SETTINGS)
        assert values == {
            "membership_number": "6178",
            "start_time": "2200",
            "end_time": "0045",
            "unit": "LA106",
            "date": "2015-11-08",
            "hours": "2.75",
            "duty_type": "in_station",
            "source_id": "81395",
            "calls:ems": "2",
            "calls:fire": "",
        }
        assert set(engine.shift_column_mapping(SETTINGS)) == set(values)
