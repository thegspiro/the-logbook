"""Historical staffing: what each activity is, and what each seat title means.

Pins the rules agreed with the department:

  * an activity naming a unit or duty words is suggested as a shift; anything
    else as an event; the reviewer decides, and may leave one out;
  * a seat title is decided by its core: "LA106 Dayside Driver (0800-1800)"
    and "Driver" are one decision;
  * titles map only to the department's own choices (its crew seats on a
    shift, its outreach roles at an event); the import adds none;
  * at an event a title may mean attendance; on a shift every title is a seat;
  * a title's list follows its event's activity, so flipping an activity
    moves its titles.
"""

import pytest

from app.models.scheduling_module_config import SchedulingModuleConfig
from app.services import historical_staffing_engine as engine
from app.services import historical_staffing_mapping as m
from app.services.historical_import_service import (
    HistoricalImportNotReady,
    HistoricalImportService,
)
from app.services.historical_staffing_service import HistoricalStaffingService
from tests.test_historical_import import CSV, _uid, _world

SEATS = [
    m.Choice("driver", "Driver/Operator"),
    m.Choice("ems", "EMT"),
    m.Choice("lead_tech", "Lead Technician"),
]
ROLES = [m.Choice("tour_guide", "Tour Guide"), m.Choice("party_staff", "Party Staff")]

SEATS_CSV = "\n".join(
    [
        "EventID,PositionID,Title,VID,Name,MinimumStaffing",
        "500,1,LA106 Dayside Driver (0800-1800),101,Alice Ng,1",
        "500,2,Lead Technician,102,Bob Diaz,1",
        "501,3,Driver,103,Cara Lee,1",
        "502,4,Party Staff,101,Alice Ng,1",
        "502,5,Attendee,102,Bob Diaz,0",
        "503,6,Elf,103,Cara Lee,0",
    ]
)
EVENTS_CSV = "\n".join(
    [
        "EventID,eDate,StartTime,EndTime,Activity",
        "500,2016-05-02,0800,1800,&#128680; LA106 Day Staff",
        "501,2016-05-03,1900,0700,A106E NS",
        "502,2016-05-07,1000,1300,Birthday Party",
        "503,2016-12-12,1800,2100,Santamobile",
    ]
)


def _input(kind, text):
    lines = text.splitlines()
    headers = lines[0].split(",")
    return engine.FileInput(
        mapping=engine.detect_mapping(kind, headers),
        rows=[
            (n + 2, dict(zip(headers, line.split(","))))
            for n, line in enumerate(lines[1:])
        ],
    )


def _joined():
    return engine.join(
        _input(engine.SEATS, SEATS_CSV), _input(engine.EVENTS, EVENTS_CSV)
    )


@pytest.mark.unit
class TestNormalizing:
    def test_a_title_is_decided_by_its_core(self):
        assert m.title_core("LA106 Dayside Driver (0800-1800)") == "Driver"
        assert m.title_core("LA106 Nightside Technician (1800-0800)") == "Technician"
        assert m.title_core("Driver: 1000-1400") == "Driver"
        assert m.title_core("Lead Tech: 0700-1000") == "Lead Tech"
        assert m.title_core("Santa&#39;s Helper") == "Santa's Helper"
        assert m.title_key("UT 106 Driver") == m.title_key("driver")

    def test_a_title_with_nothing_left_is_still_decidable(self):
        assert m.title_key("") == m.NO_TITLE_KEY
        assert m.activity_key("  ") == m.NO_ACTIVITY_KEY
        assert m.title_key("LA106 (0800-1800)") == m.NO_TITLE_KEY
        merged = m.merge(
            m.Decisions(), m.SEAT_TITLES, {m.NO_TITLE_KEY: m.TITLE_SKIP}, SEATS, ROLES
        )
        assert merged.seat_titles == {m.NO_TITLE_KEY: m.TITLE_SKIP}

    def test_an_activity_is_decided_whatever_its_case_or_emoji(self):
        assert m.activity_key("&#128680; LA106 Call Back Staff") == m.activity_key(
            "la106 call back staff"
        )


@pytest.mark.unit
class TestSuggestions:
    def test_units_and_duty_words_suggest_a_shift(self):
        units = ["LA106", "Ladder 106"]
        assert m.suggest_kind("&#128680; LA106 Call Back Staff", units) == m.SHIFT
        assert m.suggest_kind("A102 Saturday Nightside", units) == m.SHIFT
        assert m.suggest_kind("Storm Staffing", units) == m.SHIFT
        assert m.suggest_kind("Ladder 106 drill", units) == m.SHIFT
        assert m.suggest_kind("Santamobile", units) == m.EVENT
        assert m.suggest_kind("Fire Prevention Week Open House", units) == m.EVENT
        # A year is not a unit number.
        assert m.suggest_kind("CPR 2016 Recertification", units) == m.EVENT

    def test_a_seat_is_suggested_only_from_the_departments_seats(self):
        assert m.suggest_seat("Driver", SEATS) == "driver"
        assert m.suggest_seat("EMT B", SEATS) == "ems"
        assert m.suggest_seat("FF/EMT", SEATS) == "ems"
        assert m.suggest_seat("Lead Technician", SEATS) == "lead_tech"
        assert m.suggest_seat("Navigator", SEATS) is None

    def test_an_event_title_may_mean_attendance(self):
        assert m.suggest_event_title("Attendee", ROLES) == m.ATTENDANCE
        assert m.suggest_event_title("BLS Candidate", ROLES) == m.ATTENDANCE
        assert m.suggest_event_title("Party Staff", ROLES) == "party_staff"
        assert m.suggest_event_title("Elf", ROLES) is None


@pytest.mark.unit
class TestDecisions:
    def test_stored_decisions_are_read_defensively(self):
        decisions = m.Decisions.from_stored(
            {
                "activity_kinds": {"a": "shift", "b": "nonsense", "c": 3},
                "seat_titles": ["not", "a", "dict"],
                "event_titles": {"elf": "__skip__"},
            }
        )
        assert decisions.activity_kinds == {"a": "shift"}
        assert decisions.seat_titles == {}
        assert decisions.event_titles == {"elf": "__skip__"}
        assert m.Decisions.from_stored(None) == m.Decisions()

    def test_only_the_departments_choices_are_accepted(self):
        merged = m.merge(
            m.Decisions(), m.SEAT_TITLES, {"driver": "driver"}, SEATS, ROLES
        )
        assert merged.seat_titles == {"driver": "driver"}
        with pytest.raises(ValueError, match="department's choices"):
            m.merge(merged, m.SEAT_TITLES, {"navigator": "navigator"}, SEATS, ROLES)
        with pytest.raises(ValueError, match="department's choices"):
            # Attendance is an event answer; on a shift every title is a seat.
            m.merge(merged, m.SEAT_TITLES, {"attendee": m.ATTENDANCE}, SEATS, ROLES)
        cleared = m.merge(merged, m.SEAT_TITLES, {"driver": None}, SEATS, ROLES)
        assert cleared.seat_titles == {}

    def test_titles_follow_their_events_activity(self):
        lists = m.build_lists(_joined(), m.Decisions(), ["LA106"], SEATS, ROLES)
        assert {(i.label, i.suggestion) for i in lists.activities} == {
            ("&#128680; LA106 Day Staff", m.SHIFT),
            ("A106E NS", m.SHIFT),
            ("Birthday Party", m.EVENT),
            ("Santamobile", m.EVENT),
        }
        driver = lists.seat_titles[0]
        assert (driver.label, driver.seats, driver.events, driver.suggestion) == (
            "Driver",
            2,
            2,
            "driver",
        )
        assert {i.label for i in lists.event_titles} == {
            "Party Staff",
            "Attendee",
            "Elf",
        }

        flipped = m.Decisions(activity_kinds={m.activity_key("Santamobile"): m.SHIFT})
        lists = m.build_lists(_joined(), flipped, ["LA106"], SEATS, ROLES)
        assert "Elf" in {i.label for i in lists.seat_titles}
        assert "Elf" not in {i.label for i in lists.event_titles}

        skipped = m.Decisions(activity_kinds={m.activity_key("Birthday Party"): m.SKIP})
        lists = m.build_lists(_joined(), skipped, ["LA106"], SEATS, ROLES)
        assert {i.label for i in lists.event_titles} == {"Elf"}

    def test_progress_counts_seats_settled(self):
        lists = m.build_lists(_joined(), m.Decisions(), ["LA106"], SEATS, ROLES)
        assert m.progress(lists.event_titles) == {
            "items": 3,
            "decided": 0,
            "suggested": 2,
            "undecided": 1,
            "seats": 3,
            "seats_settled": 2,
        }


async def _ready_import(db_session):
    org, admin = await _world(db_session)
    record = await HistoricalImportService(db_session).create(
        org, admin, "hours.csv", CSV, "FCVFD Hours DB", None
    )
    service = HistoricalStaffingService(db_session)
    await service.upload(org, record.id, "seats", "s.csv", SEATS_CSV, admin)
    await service.upload(org, record.id, "events", "e.csv", EVENTS_CSV, admin)
    return org, admin, record.id, service


@pytest.mark.integration
class TestDecidingOnScreen:
    async def test_the_departments_own_seats_are_the_choices(self, db_session):
        org, _, import_id, service = await _ready_import(db_session)
        db_session.add(
            SchedulingModuleConfig(
                id=_uid(),
                organization_id=org,
                enabled_positions=["driver", "ems"],
                custom_positions=[{"value": "lead_tech", "label": "Lead Technician"}],
            )
        )
        await db_session.commit()

        view = await service.mapping_view(org, import_id, m.SEAT_TITLES)

        assert view["seat_choices"] == [
            {"value": "driver", "label": "Driver/Operator"},
            {"value": "ems", "label": "EMT"},
            {"value": "lead_tech", "label": "Lead Technician"},
        ]
        assert {(i["label"], i["suggestion"]) for i in view["items"]} == {
            ("Driver", "driver"),
            ("Lead Technician", "lead_tech"),
        }
        assert view["progress"][m.EVENT_TITLES]["items"] == 3

    async def test_decisions_are_kept_and_checked(self, db_session):
        org, _, import_id, service = await _ready_import(db_session)

        await service.update_decisions(
            org, import_id, m.EVENT_TITLES, {"elf": m.TITLE_SKIP}
        )
        with pytest.raises(ValueError, match="department's choices"):
            await service.update_decisions(
                org, import_id, m.EVENT_TITLES, {"elf": "chief_elf"}
            )
        view = await service.mapping_view(org, import_id, m.EVENT_TITLES, search="elf")

        assert [(i["key"], i["choice"]) for i in view["items"]] == [
            ("elf", m.TITLE_SKIP)
        ]

    async def test_suggestions_are_taken_where_nothing_was_decided(self, db_session):
        org, _, import_id, service = await _ready_import(db_session)
        await service.update_decisions(
            org, import_id, m.EVENT_TITLES, {"attendee": m.TITLE_SKIP}
        )

        accepted = await service.accept_suggestions(org, import_id, m.EVENT_TITLES)

        view = await service.mapping_view(org, import_id, m.EVENT_TITLES)
        choices = {i["key"]: i["choice"] for i in view["items"]}
        # The default outreach roles have no Party Staff; Attendee was decided.
        assert accepted == 0
        assert choices["attendee"] == m.TITLE_SKIP

        accepted = await service.accept_suggestions(org, import_id, m.ACTIVITIES)
        view = await service.mapping_view(org, import_id, m.ACTIVITIES)
        assert accepted == 4
        assert all(i["choice"] == i["suggestion"] for i in view["items"])

    async def test_nothing_is_offered_before_the_files_are_ready(self, db_session):
        org, admin = await _world(db_session)
        record = await HistoricalImportService(db_session).create(
            org, admin, "hours.csv", CSV, "FCVFD Hours DB", None
        )

        with pytest.raises(HistoricalImportNotReady, match="staffing files"):
            await HistoricalStaffingService(db_session).mapping_view(
                org, record.id, m.ACTIVITIES
            )
