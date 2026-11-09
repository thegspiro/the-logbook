"""Historical staffing: storing a roster export and reporting how it joins.

Pins what was agreed with the department:

  * a staffing export arrives as a seats file joined to an events file on an
    event key, or as one flat file whose seat rows carry their event's date;
  * a seat with nobody in it (a blank name, or a number of all zeros) is
    unfilled, and is counted, not dropped;
  * a seat whose event the events file lacks has no date to stand on, and is
    counted apart, with the event keys named;
  * an event outside the years most of the file falls in (one dated 1931 in a
    history starting in 2000) is flagged as a possible test entry; an event
    after today is upcoming, which the import makes a scheduled event;
  * an event ending at or before its start runs past midnight.
"""

from datetime import date, time
from unittest.mock import patch

import pytest
from sqlalchemy import func, select

from app.models.historical_import import HistoricalStaffingFile, HistoricalStaffingRow
from app.services import historical_staffing_engine as engine
from app.services.historical_import_service import (
    HistoricalImportNotFound,
    HistoricalImportService,
)
from app.services.historical_staffing_service import HistoricalStaffingService
from tests.test_historical_import import CSV, _world

SEATS_CSV = "\n".join(
    [
        "EventID,PositionID,Title,VID,Name,MinimumStaffing,SwitchRequested",
        "500,1,Driver,101,Alice Ng,1,0",
        "500,2,Lead Technician,102,Bob Diaz,1,0",
        "500,3,Asst. Technician,,,0,0",
        "501,4,Party Staff,0,,1,0",
        # No event 999 in the events file.
        "999,5,Driver,101,Alice Ng,1,0",
        # No event at all.
        ",6,Driver,,,1,0",
    ]
)

EVENTS_CSV = "\n".join(
    [
        "EventID,eDate,StartTime,EndTime,Location,Activity",
        "500,2016-05-02 00:00:00.000,1899-12-30 19:00:00.000,"
        "1899-12-30 07:00:00.000,Station 6,A106E NS",
        "501,2016-05-07 00:00:00.000,1899-12-30 10:00:00.000,"
        "1899-12-30 13:00:00.000,FCVFD Meeting Hall,Birthday Party",
        "502,2016-06-01 00:00:00.000,1899-12-30 19:00:00.000,"
        "1899-12-30 21:00:00.000,FCVFD Meeting Hall,Hall Rental",
    ]
)


def _file(kind, text):
    lines = text.splitlines()
    headers = lines[0].split(",")
    rows = [
        (number + 2, dict(zip(headers, line.split(","))))
        for number, line in enumerate(lines[1:])
    ]
    return engine.FileInput(mapping=engine.detect_mapping(kind, headers), rows=rows)


@pytest.mark.unit
class TestReadingTheFiles:
    def test_the_columns_are_recognised(self):
        seats = _file(engine.SEATS, SEATS_CSV)
        events = _file(engine.EVENTS, EVENTS_CSV)
        assert seats.mapping == {
            "event_key": "EventID",
            "seat_id": "PositionID",
            "title": "Title",
            "membership_number": "VID",
            "member_name": "Name",
            "required": "MinimumStaffing",
        }
        assert events.mapping == {
            "event_key": "EventID",
            "date": "eDate",
            "start_time": "StartTime",
            "end_time": "EndTime",
            "activity": "Activity",
            "location": "Location",
        }
        assert engine.mapping_problems(seats, events) == []

    def test_a_time_stored_on_a_placeholder_day_reads_as_its_clock(self):
        assert engine.parse_clock_cell("1899-12-30 19:00:00.000") == time(19, 0)
        assert engine.parse_clock_cell("1900-01-01 07:59:00.000") == time(7, 59)
        assert engine.parse_clock_cell("0700") == time(7, 0)
        assert engine.parse_clock_cell("") is None

    def test_a_zero_number_names_nobody(self):
        assert not engine.has_member({"membership_number": "0", "member_name": ""})
        assert not engine.has_member({"membership_number": "", "member_name": " "})
        assert engine.has_member({"membership_number": "", "member_name": "Al"})
        assert engine.has_member({"membership_number": "101"})

    def test_seats_join_their_events(self):
        joined = engine.join(
            _file(engine.SEATS, SEATS_CSV), _file(engine.EVENTS, EVENTS_CSV)
        )
        assert (joined.events["500"].seat_count, joined.events["500"].filled_count) == (
            3,
            2,
        )
        assert joined.events["500"].overnight is True
        assert joined.events["501"].overnight is False
        assert [s.line_number for s in joined.seats_missing_event] == [6]
        assert [s.line_number for s in joined.seats_without_key] == [7]

    def test_the_summary_counts_every_seat(self):
        summary = engine.summarize(
            engine.join(
                _file(engine.SEATS, SEATS_CSV), _file(engine.EVENTS, EVENTS_CSV)
            ),
            date(2026, 11, 8),
        )
        assert summary["seats"] == {
            "rows": 6,
            "filled": 3,
            "unfilled": 3,
            "without_event_key": 1,
            "missing_event": 1,
            "missing_event_filled": 1,
            "missing_event_keys": 1,
            "missing_event_examples": [{"event_key": "999", "seats": 1}],
        }
        events = summary["events"]
        assert (events["rows"], events["staffed"], events["unstaffed"]) == (3, 2, 1)
        assert events["unstaffed_importable"] == 1
        assert (events["overnight"], events["upcoming"]) == (1, 0)
        # Three events in one year are too few to judge a usual range by.
        assert events["usual_first_year"] is None
        assert events["outside_usual_range"] == 0

    def test_an_event_far_outside_the_files_years_is_flagged(self):
        days = [date(2010 + i % 5, 1, 1 + i) for i in range(25)] + [date(1931, 12, 12)]
        years = engine.usual_years(days, date(2014, 11, 8))
        assert years == (2010, 2015)
        assert engine.outside_usual_range(date(1931, 12, 12), years)
        assert engine.outside_usual_range(date(2099, 1, 1), years)
        assert not engine.outside_usual_range(date(2012, 6, 1), years)

    def test_an_event_after_today_is_upcoming(self):
        lines = ["EventID,eDate,Activity"] + [
            f"{n},{2015 + n % 3}-03-0{1 + n % 9},Shift" for n in range(30)
        ]
        lines.append("99,2027-03-28,Santamobile")
        summary = engine.summarize(
            engine.join(
                _file(engine.SEATS, "EventID,Title,Name\n99,Santa,Al Ng"),
                _file(engine.EVENTS, "\n".join(lines)),
            ),
            date(2026, 11, 8),
        )
        assert summary["events"]["upcoming"] == 1
        assert summary["events"]["outside_usual_range"] == 0
        assert summary["events"]["last_date"] == date(2027, 3, 28)

    def test_a_flat_file_groups_its_seats_into_events(self):
        flat = _file(
            engine.SEATS,
            "\n".join(
                [
                    "Date,Start,End,Activity,Position,Name",
                    "2016-05-02,1900,0700,A106E NS,Driver,Alice Ng",
                    "2016-05-02,1900,0700,A106E NS,Technician,",
                    "2016-05-03,0800,1200,Open House,Tour Host,Bob Diaz",
                ]
            ),
        )
        assert engine.flat_file(flat)
        assert engine.mapping_problems(flat, None) == []
        joined = engine.join(flat, None)
        assert len(joined.events) == 2
        assert sorted(
            (e.seat_count, e.filled_count) for e in joined.events.values()
        ) == [
            (1, 1),
            (2, 1),
        ]

    def test_a_flat_file_needs_something_to_tell_a_days_events_apart(self):
        flat = engine.FileInput(
            mapping={"date": "Date", "title": "Position", "member_name": "Name"},
            rows=[],
        )
        assert engine.mapping_problems(flat, None) == [
            "Choose the seats file's event column, or its activity column, "
            "so seats on the same day are told apart by event."
        ]
        flat.mapping = {**flat.mapping, "activity": "Activity"}
        assert engine.mapping_problems(flat, None) == []

    def test_what_must_be_chosen_is_named(self):
        seats = engine.FileInput(mapping={"title": "Title"}, rows=[])
        assert engine.mapping_problems(seats, None) == [
            "Choose the column naming who held each seat.",
            "Upload the events file, or choose the seats file's date column "
            "if each seat row carries its event's date.",
        ]
        assert engine.mapping_problems(None, None) == [
            "Upload the seats file: one row per seat, naming who held it."
        ]

    def test_a_mapping_is_checked_against_the_file(self):
        headers = ["EventID", "Title", "Name"]
        assert engine.clean_mapping(
            engine.SEATS, headers, {"title": "Title", "member_name": None}
        ) == {"title": "Title"}
        with pytest.raises(ValueError, match="no column named"):
            engine.clean_mapping(engine.SEATS, headers, {"title": "Seat"})
        with pytest.raises(ValueError, match="two fields"):
            engine.clean_mapping(
                engine.SEATS, headers, {"title": "Title", "member_name": "Title"}
            )
        with pytest.raises(ValueError, match="not a field"):
            engine.clean_mapping(engine.EVENTS, headers, {"title": "Title"})


async def _import(db_session):
    org, admin = await _world(db_session)
    record = await HistoricalImportService(db_session).create(
        org, admin, "hours.csv", CSV, "FCVFD Hours DB", None
    )
    return org, admin, record


async def _row_count(db_session, file_id):
    return (
        await db_session.execute(
            select(func.count(HistoricalStaffingRow.id)).where(
                HistoricalStaffingRow.file_id == file_id
            )
        )
    ).scalar_one()


@pytest.mark.integration
class TestStoringTheFiles:
    async def test_both_files_are_stored_and_joined(self, db_session):
        org, admin, record = await _import(db_session)
        service = HistoricalStaffingService(db_session)

        seats = await service.upload(
            org, record.id, "seats", "Staffing.csv", SEATS_CSV, admin
        )
        await service.upload(org, record.id, "events", "Events.csv", EVENTS_CSV, admin)
        preview = await service.preview(org, record.id)

        assert await _row_count(db_session, seats.id) == 6
        assert [f["kind"] for f in preview["files"]] == ["seats", "events"]
        assert preview["problems"] == []
        assert preview["flat_file"] is False
        assert preview["summary"]["seats"]["missing_event_keys"] == 1
        assert preview["summary"]["events"]["staffed"] == 2

    async def test_a_second_upload_replaces_the_first(self, db_session):
        org, admin, record = await _import(db_session)
        service = HistoricalStaffingService(db_session)
        first = await service.upload(org, record.id, "seats", "a.csv", SEATS_CSV, admin)

        second = await service.upload(
            org, record.id, "seats", "b.csv", "EventID,Title,Name\n1,Driver,Al", admin
        )

        stored = (
            (
                await db_session.execute(
                    select(HistoricalStaffingFile).where(
                        HistoricalStaffingFile.historical_import_id == record.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [f.id for f in stored] == [second.id]
        assert await _row_count(db_session, first.id) == 0
        assert await _row_count(db_session, second.id) == 1

    async def test_the_mapping_can_be_corrected_and_the_file_removed(self, db_session):
        org, admin, record = await _import(db_session)
        service = HistoricalStaffingService(db_session)
        await service.upload(org, record.id, "seats", "s.csv", SEATS_CSV, admin)

        await service.update_mapping(
            org, record.id, "seats", {"title": "Title", "member_name": "Name"}
        )
        preview = await service.preview(org, record.id)
        assert preview["files"][0]["column_mapping"] == {
            "title": "Title",
            "member_name": "Name",
        }
        assert preview["summary"] is None
        assert preview["problems"][0].startswith("Upload the events file")

        assert await service.remove(org, record.id, "seats") is True
        assert await service.remove(org, record.id, "seats") is False
        assert (await service.preview(org, record.id))["files"] == []

    async def test_another_departments_import_is_not_reachable(self, db_session):
        org, admin, record = await _import(db_session)
        other_org, other_admin = await _world(db_session)
        service = HistoricalStaffingService(db_session)

        with pytest.raises(HistoricalImportNotFound):
            await service.upload(
                other_org, record.id, "seats", "s.csv", SEATS_CSV, other_admin
            )
        with pytest.raises(HistoricalImportNotFound):
            await service.preview(other_org, record.id)

    async def test_a_failed_upload_leaves_no_file_behind(self, db_session):
        org, admin, record = await _import(db_session)
        # The rollback expires every loaded object; keep the id.
        import_id = record.id
        service = HistoricalStaffingService(db_session)
        real_flush = db_session.flush
        calls = {"n": 0}

        async def failing_flush(*args, **kwargs):
            calls["n"] += 1
            # The file row flushes first; fail on the first chunk of rows.
            if calls["n"] == 2:
                raise RuntimeError("connection lost")
            return await real_flush(*args, **kwargs)

        with patch.object(db_session, "flush", failing_flush):
            with pytest.raises(RuntimeError, match="connection lost"):
                await service.upload(org, import_id, "seats", "s.csv", SEATS_CSV, admin)

        assert (await service.preview(org, import_id))["files"] == []

    async def test_an_unreadable_kind_or_file_is_refused(self, db_session):
        org, admin, record = await _import(db_session)
        service = HistoricalStaffingService(db_session)

        with pytest.raises(ValueError, match="seats file or an events file"):
            await service.upload(org, record.id, "crew", "s.csv", SEATS_CSV, admin)
        with pytest.raises(ValueError, match="no data rows"):
            await service.upload(org, record.id, "seats", "s.csv", "Title,Name", admin)
        with pytest.raises(ValueError, match="Upload that file first"):
            await service.update_mapping(org, record.id, "events", {})
