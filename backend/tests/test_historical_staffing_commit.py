"""Historical staffing: writing the roster.

Pins what was agreed with the department:

  * a shift fills the department's existing shift for that date and unit (the
    hours import's) rather than making a second one; a member already on it
    is re-seated in the seat the roster names; no hours are written;
  * a shift with no existing match is made, roster only;
  * an event becomes a calendar event: attendance seats check their members
    in, role seats go on its outreach sheet in that role; an upcoming event is
    scheduled, nobody checked in;
  * an event with no seats becomes a calendar event unless turned off;
  * an unfilled seat is skipped unless the reviewer assigns a member;
  * running it again writes nothing twice.
"""

from datetime import date, datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

from app.models.event import Event, EventRSVP
from app.models.training import (
    BasicApparatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
)
from app.models.user import User
from app.services import historical_staffing_engine as engine
from app.services import historical_staffing_mapping as m
from app.services import historical_staffing_plan as p
from app.services.historical_import_service import (
    HistoricalImportNotReady,
    HistoricalImportService,
)
from app.services.historical_import_undo import HistoricalImportUndoService
from app.services.historical_staffing_commit import HistoricalStaffingCommitService
from app.services.historical_staffing_service import HistoricalStaffingService
from tests.clock_support import reread_each_test
from tests.test_historical_import import CSV, _add_user, _uid, _world


def _clock() -> dict[str, Any]:
    """Read as each test starts (tests/clock_support.py), not at import."""
    next_year = date.today().year + 1
    return {"NEXT_YEAR": next_year}


(NEXT_YEAR,) = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)

SEATS_CSV = "\n".join(
    [
        "EventID,PositionID,Title,VID,Name,MinimumStaffing",
        "500,1,LA106 Dayside Driver (0800-1800),101,Alice Ng,1",
        "500,2,Lead Technician,102,Bob Diaz,1",
        "500,3,Technician,0,,0",
        "501,4,Driver,101,Alice Ng,1",
        "502,5,Party Staff,101,Alice Ng,1",
        "502,6,Attendee,102,Bob Diaz,0",
        "503,7,Party Staff,102,Bob Diaz,1",
    ]
)
EVENTS_CSV = "\n".join(
    [
        "EventID,eDate,StartTime,EndTime,Location,Activity",
        "500,2016-05-02,0800,1800,Station 6,LA106 Day Staff",
        "501,2016-05-03,1900,0700,Station 6,A106E NS",
        "502,2016-05-07,1000,1300,Meeting Hall,Birthday Party",
        f"503,{NEXT_YEAR}-03-28,1800,2100,Meeting Hall,Santamobile",
        "504,2016-06-01,1900,2100,Meeting Hall,Hall Rental",
    ]
)

DECISIONS = {
    m.ACTIVITIES: {
        m.activity_key("LA106 Day Staff"): m.SHIFT,
        m.activity_key("A106E NS"): m.SHIFT,
        m.activity_key("Birthday Party"): m.EVENT,
        m.activity_key("Santamobile"): m.EVENT,
    },
    m.SEAT_TITLES: {
        "driver": "driver",
        "lead technician": "ems",
        "technician": "firefighter",
    },
    m.EVENT_TITLES: {"party staff": "greeter", "attendee": m.ATTENDANCE},
}


@pytest.mark.unit
class TestThePlan:
    def test_only_decided_seats_are_written_and_the_rest_counted(self):
        lines = SEATS_CSV.splitlines()
        seat_rows = [
            (n + 2, dict(zip(lines[0].split(","), line.split(","))))
            for n, line in enumerate(lines[1:])
        ]
        lines = EVENTS_CSV.splitlines()
        event_rows = [
            (n + 2, dict(zip(lines[0].split(","), line.split(","))))
            for n, line in enumerate(lines[1:])
        ]
        joined = engine.join(
            engine.FileInput(
                engine.detect_mapping("seats", SEATS_CSV.split("\n")[0].split(",")),
                seat_rows,
            ),
            engine.FileInput(
                engine.detect_mapping("events", EVENTS_CSV.split("\n")[0].split(",")),
                event_rows,
            ),
        )
        decisions = m.Decisions(
            activity_kinds={m.activity_key("LA106 Day Staff"): m.SHIFT},
            seat_titles={"driver": "driver"},
        )

        plan = p.build_plan(
            joined, decisions, {}, ["LA106"], date(2026, 11, 8), include_unstaffed=False
        )

        assert [(e.event.key, len(e.seats)) for e in plan.events] == [("500", 1)]
        assert plan.skipped == {
            p.SKIP_TITLE_UNDECIDED: 2,
            p.SKIP_ACTIVITY_UNDECIDED: 4,
        }

    def test_a_long_flat_key_fits_the_ledger(self):
        key = "2016-05-02|1900|" + "a very long activity name " * 10
        assert len(p.ledger_id(p.EVENT_PREFIX, key)) <= 100
        assert p.ledger_id(p.EVENT_PREFIX, "500") == "staff-event:500"

    def test_a_unit_is_found_by_its_longest_name(self):
        units = [("a106", "A106"), ("a106e", "A106E")]
        assert p.unit_of("A106E NS", units) == "a106e"
        assert p.unit_of("A106 Friday", units) == "a106"
        assert p.unit_of("Birthday Party", units) is None

    def test_call_back_is_an_on_call_shift(self):
        assert p.is_on_call("&#128680; LA106 Call Back Staff")
        assert not p.is_on_call("A106E NS")


async def _setup(db_session, *, decided=True):
    org, admin = await _world(db_session)
    record = await HistoricalImportService(db_session).create(
        org, admin, "hours.csv", CSV, "FCVFD Hours DB", None
    )
    staffing = HistoricalStaffingService(db_session)
    await staffing.upload(org, record.id, "seats", "s.csv", SEATS_CSV, admin)
    await staffing.upload(org, record.id, "events", "e.csv", EVENTS_CSV, admin)
    if decided:
        for name, updates in DECISIONS.items():
            await staffing.update_decisions(org, record.id, name, updates)
    return org, admin, record.id


async def _hours_shift(db_session, org, user_id):
    """The shift the hours import made for LA106 on 2 May 2016."""
    apparatus = (
        await db_session.execute(
            select(BasicApparatus).where(BasicApparatus.organization_id == org)
        )
    ).scalar_one()
    shift = Shift(
        id=_uid(),
        organization_id=org,
        shift_date=date(2016, 5, 2),
        start_time=datetime(2016, 5, 2, 12, tzinfo=timezone.utc),
        end_time=datetime(2016, 5, 2, 22, tzinfo=timezone.utc),
        apparatus_id=apparatus.id,
        is_finalized=True,
    )
    db_session.add(shift)
    db_session.add(
        ShiftAssignment(
            id=_uid(),
            organization_id=org,
            shift_id=shift.id,
            user_id=user_id,
            position="firefighter",
        )
    )
    await db_session.commit()
    return shift


async def _user(db_session, org, number):
    return (
        await db_session.execute(
            select(User.id).where(
                User.organization_id == org, User.membership_number == number
            )
        )
    ).scalar_one()


@pytest.mark.integration
class TestWritingTheRoster:
    async def test_the_roster_fills_shifts_and_events(self, db_session):
        org, admin, import_id = await _setup(db_session)
        alice = await _user(db_session, org, "101")
        bob = await _user(db_session, org, "102")
        hours_shift = await _hours_shift(db_session, org, alice)
        service = HistoricalStaffingCommitService(db_session)

        preview = await service.preview(org, import_id)
        assert preview["can_commit"] is True
        assert preview["counts"]["shifts"] == 2
        assert preview["unfilled_seats"] == 1
        assert preview["skipped"] == {p.SKIP_UNFILLED: 1}

        counts = await service.commit(org, import_id, admin)

        assert counts["shifts_filled"] == 1
        assert counts["shifts_created"] == 1
        assert counts["seats_updated"] == 1  # Alice, re-seated as driver
        assert counts["seats_added"] == 2  # Bob on LA106, Alice on A106E
        assert counts["events_created"] == 3  # party, Santamobile, hall rental
        assert counts["upcoming_events_created"] == 1
        assert counts["check_ins"] == 1
        assert counts["outreach_seats"] == 2

        seats = dict(
            (
                await db_session.execute(
                    select(ShiftAssignment.user_id, ShiftAssignment.position).where(
                        ShiftAssignment.shift_id == hours_shift.id
                    )
                )
            ).all()
        )
        assert seats == {alice: "driver", bob: "ems"}
        assert (
            await db_session.execute(select(func.count(ShiftAttendance.id)))
        ).scalar_one() == 0

        party = (
            await db_session.execute(
                select(Event).where(
                    Event.organization_id == org, Event.title == "Birthday Party"
                )
            )
        ).scalar_one()
        assert party.attendance_finalized_at is not None
        rsvp = (
            await db_session.execute(
                select(EventRSVP).where(EventRSVP.event_id == party.id)
            )
        ).scalar_one()
        assert (rsvp.user_id, rsvp.checked_in) == (bob, True)
        sheet_roles = (
            await db_session.execute(
                select(ShiftAssignment.user_id, ShiftAssignment.outreach_role)
                .join(Shift, Shift.id == ShiftAssignment.shift_id)
                .where(Shift.organization_id == org, Shift.is_outreach.is_(True))
            )
        ).all()
        assert sorted(sheet_roles) == sorted([(alice, "greeter"), (bob, "greeter")])

        santa = (
            await db_session.execute(
                select(Event).where(
                    Event.organization_id == org, Event.title == "Santamobile"
                )
            )
        ).scalar_one()
        assert santa.attendance_finalized_at is None

    async def test_running_it_again_writes_nothing(self, db_session):
        org, admin, import_id = await _setup(db_session)
        service = HistoricalStaffingCommitService(db_session)
        await service.commit(org, import_id, admin)
        before = [
            (await db_session.execute(select(func.count(model.id)))).scalar_one()
            for model in (Shift, ShiftAssignment, Event, EventRSVP)
        ]

        counts = await service.commit(org, import_id, admin)

        after = [
            (await db_session.execute(select(func.count(model.id)))).scalar_one()
            for model in (Shift, ShiftAssignment, Event, EventRSVP)
        ]
        assert after == before
        assert counts["already_imported"] == 6
        assert "events_created" not in counts

    async def test_an_unfilled_seat_is_written_only_when_assigned(self, db_session):
        org, admin, import_id = await _setup(db_session)
        service = HistoricalStaffingCommitService(db_session)
        other_org, other_admin = await _world(db_session)

        view = await service.unfilled_view(org, import_id)
        assert [(i["line_number"], i["maps_to"]) for i in view["items"]] == [
            (4, "Firefighter")
        ]
        with pytest.raises(ValueError, match="member of this department"):
            await service.assign_unfilled(org, import_id, {"4": other_admin})

        await service.assign_unfilled(org, import_id, {"4": admin})
        counts = await service.commit(org, import_id, admin)

        technician = (
            await db_session.execute(
                select(ShiftAssignment.position).where(
                    ShiftAssignment.user_id == admin,
                    ShiftAssignment.organization_id == org,
                )
            )
        ).scalar_one()
        assert technician == "firefighter"
        # No hours shift here, so every crew seat is new: Alice, Bob and the
        # assigned member on LA106, Alice on A106E.
        assert counts["seats_added"] == 4

    async def test_events_without_seats_can_be_left_off(self, db_session):
        org, admin, import_id = await _setup(db_session)
        service = HistoricalStaffingCommitService(db_session)

        await service.set_include_unstaffed(org, import_id, False)
        counts = await service.commit(org, import_id, admin)

        assert counts["events_created"] == 2
        assert (
            await db_session.execute(
                select(func.count(Event.id)).where(
                    Event.organization_id == org, Event.title == "Hall Rental"
                )
            )
        ).scalar_one() == 0

    async def test_an_unknown_member_must_be_decided_first(self, db_session):
        org, admin, import_id = await _setup(db_session)
        staffing = HistoricalStaffingService(db_session)
        await staffing.upload(
            org,
            import_id,
            "seats",
            "s.csv",
            SEATS_CSV + "\n502,8,Attendee,999,Zed Quinn,0",
            admin,
        )
        service = HistoricalStaffingCommitService(db_session)

        preview = await service.preview(org, import_id)
        assert preview["can_commit"] is False
        assert [m_["key"] for m_ in preview["members"]] == ["number:999"]
        with pytest.raises(HistoricalImportNotReady, match="still need a decision"):
            await service.commit(org, import_id, admin)

        zed = await _add_user(db_session, org, "Zed", "Quinn", "999x")
        await db_session.commit()
        await service.update_members(
            org, import_id, {"number:999": {"action": "map", "user_id": zed}}
        )
        assert (await service.preview(org, import_id))["can_commit"] is True

    async def test_a_member_created_once_is_not_created_again(self, db_session):
        org, admin, import_id = await _setup(db_session)
        staffing = HistoricalStaffingService(db_session)
        await staffing.upload(
            org,
            import_id,
            "seats",
            "s.csv",
            SEATS_CSV + "\n502,8,Attendee,999,Zed Quinn,0",
            admin,
        )
        service = HistoricalStaffingCommitService(db_session)
        await service.update_members(
            org, import_id, {"number:999": {"action": "create"}}
        )

        first = await service.commit(org, import_id, admin)
        second = await service.commit(org, import_id, admin)

        assert first["members_created"] == 1
        assert "members_created" not in second
        assert (
            await db_session.execute(
                select(func.count(User.id)).where(
                    User.organization_id == org, User.membership_number == "999"
                )
            )
        ).scalar_one() == 1

    async def test_nothing_decided_writes_nothing(self, db_session):
        org, admin, import_id = await _setup(db_session, decided=False)
        service = HistoricalStaffingCommitService(db_session)
        await service.set_include_unstaffed(org, import_id, False)

        with pytest.raises(HistoricalImportNotReady, match="Nothing to write"):
            await service.commit(org, import_id, admin)


@pytest.mark.unit
def test_the_day_is_read_in_the_departments_zone():
    event = engine.StaffingEvent(
        key="1",
        line_number=2,
        day=date(2016, 5, 2),
        start=time(19),
        end=time(7),
        activity="A106E NS",
        location="",
    )
    start, end = HistoricalStaffingCommitService._span(
        event, ZoneInfo("America/New_York")
    )
    assert start == datetime(2016, 5, 2, 23, tzinfo=timezone.utc)
    assert end == datetime(2016, 5, 3, 11, tzinfo=timezone.utc)


@pytest.mark.unit
def test_an_unfilled_seat_with_a_date_passes_the_response_schema():
    from app.schemas.historical_import import StaffingUnfilledView

    view = StaffingUnfilledView.model_validate(
        {
            "items": [
                {
                    "line_number": 4,
                    "date": date(2016, 5, 2),
                    "activity": "LA106 Day Staff",
                    "title": "Technician",
                    "maps_to": "Firefighter",
                    "required": False,
                }
            ],
            "total": 1,
            "assigned": 0,
            "member_options": [],
        }
    )
    assert view.items[0].date == date(2016, 5, 2)


@pytest.mark.unit
def test_a_member_to_create_is_shown_by_the_name_they_will_get():
    from app.services import shift_history_import_engine as shift_engine
    from app.services.historical_import_service import _member_views

    named = shift_engine.resolve_member(
        shift_engine.identity_from_values(
            {"membership_number": "1005", "member_name": "James Fortner"}
        ),
        [],
        {"action": "create"},
    )
    number_only = shift_engine.resolve_member(
        shift_engine.identity_from_values({"membership_number": "2013"}),
        [],
        {"action": "create"},
    )

    views = {v["key"]: v for v in _member_views({"a": named, "b": number_only})}

    assert (
        views["number:1005"]["new_first_name"],
        views["number:1005"]["new_last_name"],
    ) == (
        "James",
        "Fortner",
    )
    assert (
        views["number:2013"]["new_first_name"],
        views["number:2013"]["new_last_name"],
    ) == (
        shift_engine.FORMER_MEMBER_FIRST_NAME,
        "2013",
    )


async def _hours_entry(
    db_session, org, user_id, start, end, *, position="firefighter", calls=3
):
    """An hours entry the department already has: a shift with no unit (an
    hours file without a vehicle column), the member's seat and attendance."""
    shift = Shift(
        id=_uid(),
        organization_id=org,
        shift_date=start.date(),
        start_time=start,
        end_time=end,
        is_finalized=True,
    )
    db_session.add(shift)
    db_session.add(
        ShiftAssignment(
            id=_uid(),
            organization_id=org,
            shift_id=shift.id,
            user_id=user_id,
            position=position,
        )
    )
    db_session.add(
        ShiftAttendance(
            id=_uid(),
            shift_id=shift.id,
            user_id=user_id,
            checked_in_at=start,
            checked_out_at=end,
            duration_minutes=int((end - start).total_seconds() // 60),
            call_count=calls,
        )
    )
    await db_session.commit()
    return shift


async def _seats_on(db_session, shift_id):
    return dict(
        (
            await db_session.execute(
                select(ShiftAssignment.user_id, ShiftAssignment.position).where(
                    ShiftAssignment.shift_id == shift_id
                )
            )
        ).all()
    )


def _utc(day: int, hour: int) -> datetime:
    return datetime(2016, 5, day, hour, tzinfo=timezone.utc)


@pytest.mark.integration
class TestPairingWithTheHours:
    """A seat and an hours entry are one duty when they are the same member
    and their times overlap (owner decision 2026-11-21)."""

    async def test_a_shift_seat_goes_onto_the_shift_its_hours_were_on(self, db_session):
        org, admin, import_id = await _setup(db_session)
        alice = await _user(db_session, org, "101")
        bob = await _user(db_session, org, "102")
        # LA106 Day Staff on 2 May, 08:00 to 18:00 in New York, logged with no
        # unit: the date-and-unit match cannot find it.
        alice_hours = await _hours_entry(
            db_session, org, alice, _utc(2, 12), _utc(2, 22)
        )
        bob_hours = await _hours_entry(db_session, org, bob, _utc(2, 12), _utc(2, 21))
        service = HistoricalStaffingCommitService(db_session)

        counts = await service.commit(org, import_id, admin)

        assert await _seats_on(db_session, alice_hours.id) == {alice: "driver"}
        assert await _seats_on(db_session, bob_hours.id) == {bob: "ems"}
        assert counts["seats_matched_to_hours"] == 2
        # No roster shift for LA106: every filled seat paired. A106E on the 3rd
        # has no hours, so it is made as before.
        assert counts["shifts_created"] == 1
        assert "shifts_filled" not in counts

        again = await service.commit(org, import_id, admin)
        assert "seats_matched_to_hours" not in again
        assert await _seats_on(db_session, alice_hours.id) == {alice: "driver"}

    async def test_an_event_title_that_is_a_crew_seat_is_written_and_a_role_is_not(
        self, db_session
    ):
        org, admin = await _world(db_session)
        record = await HistoricalImportService(db_session).create(
            org, admin, "hours.csv", CSV, "FCVFD Hours DB", None
        )
        staffing = HistoricalStaffingService(db_session)
        seats = "\n".join(
            [
                "EventID,PositionID,Title,VID,Name,MinimumStaffing",
                "600,1,Driver,101,Alice Ng,1",
                "600,2,Party Staff,102,Bob Diaz,1",
            ]
        )
        events = "\n".join(
            [
                "EventID,eDate,StartTime,EndTime,Location,Activity",
                "600,2016-05-07,1000,1300,Meeting Hall,Birthday Party",
            ]
        )
        await staffing.upload(org, record.id, "seats", "s.csv", seats, admin)
        await staffing.upload(org, record.id, "events", "e.csv", events, admin)
        for name, updates in {
            m.ACTIVITIES: {m.activity_key("Birthday Party"): m.EVENT},
            m.EVENT_TITLES: {"driver": "greeter", "party staff": "greeter"},
        }.items():
            await staffing.update_decisions(org, record.id, name, updates)
        alice = await _user(db_session, org, "101")
        bob = await _user(db_session, org, "102")
        alice_hours = await _hours_entry(
            db_session, org, alice, _utc(7, 14), _utc(7, 17)
        )
        bob_hours = await _hours_entry(db_session, org, bob, _utc(7, 14), _utc(7, 17))

        counts = await HistoricalStaffingCommitService(db_session).commit(
            org, record.id, admin
        )

        assert await _seats_on(db_session, alice_hours.id) == {alice: "driver"}
        assert await _seats_on(db_session, bob_hours.id) == {bob: "firefighter"}
        assert counts["seats_matched_to_hours"] == 2
        assert counts["matched_role_not_a_seat"] == 1
        # The event and its sheet are written as before.
        assert counts["events_created"] == 1
        assert counts["outreach_seats"] == 2

    async def test_undo_puts_a_paired_seat_back(self, db_session):
        org, admin, import_id = await _setup(db_session)
        alice = await _user(db_session, org, "101")
        bob = await _user(db_session, org, "102")
        alice_hours = await _hours_entry(
            db_session, org, alice, _utc(2, 12), _utc(2, 22)
        )
        await HistoricalStaffingCommitService(db_session).commit(org, import_id, admin)
        # Bob has no hours of his own: his seat joins the shift Alice's hours
        # are on, the crew's shift.
        assert await _seats_on(db_session, alice_hours.id) == {
            alice: "driver",
            bob: "ems",
        }

        record = await HistoricalImportService(db_session).get(
            org, import_id, for_update=True
        )
        counts = await HistoricalImportUndoService(db_session).undo(
            record, "staffing", admin
        )
        await db_session.commit()

        # Alice back in the seat the hours gave her; Bob's roster seat gone.
        assert counts["positions_restored"] == 1
        assert await _seats_on(db_session, alice_hours.id) == {alice: "firefighter"}
        assert await db_session.get(Shift, alice_hours.id) is not None

    async def test_the_preview_counts_both_sides_and_names_what_is_unpaired(
        self, db_session
    ):
        org, admin, import_id = await _setup(db_session)
        alice = await _user(db_session, org, "101")
        bob = await _user(db_session, org, "102")
        await _hours_entry(db_session, org, alice, _utc(2, 12), _utc(2, 22))
        # Bob logged hours on the 3rd, a day the roster covers, with no seat.
        await _hours_entry(db_session, org, bob, _utc(3, 12), _utc(3, 18))

        view = (
            await HistoricalStaffingCommitService(db_session).preview(org, import_id)
        )["hours_match"]

        assert view["matched"] == 1
        # Bob's LA106 seat on the 2nd, Alice's A106E seat on the 3rd, and both
        # Birthday Party seats; the Santamobile next year is upcoming.
        assert view["signups_without_hours"] == 4
        assert view["hours_without_signup"] == 1
        assert view["hours_without_signup_examples"][0]["member"] == "Bob Diaz"
        titles = {
            (e["member"], e["title"]) for e in view["signups_without_hours_examples"]
        }
        assert ("Alice Ng", "Driver") in titles
        assert ("Bob Diaz", "Lead Technician") in titles


@pytest.mark.integration
class TestTheLeftovers:
    """Every seat and hours entry the overlap rule leaves unpaired can be seen,
    paired by hand or marked reviewed (owner decisions, 2026-11-26).

    Alice's A106E night seat runs 19:00 to 07:00 on 3 May, New York time; she
    logged hours that morning, 04:00 to 08:00, which no overlap pairs."""

    async def _alice_logged_the_wrong_hours(self, db_session):
        org, admin, import_id = await _setup(db_session)
        alice = await _user(db_session, org, "101")
        bob = await _user(db_session, org, "102")
        morning = await _hours_entry(db_session, org, alice, _utc(3, 8), _utc(3, 12))
        return org, admin, import_id, alice, bob, morning

    async def _signup_key(self, service, org, import_id, member, title):
        view = await service.leftovers_view(org, import_id, kind="signups")
        (item,) = [
            i for i in view["items"] if i["member_id"] == member and i["title"] == title
        ]
        return item

    async def test_both_sides_are_listed_with_the_members_own_hours_to_pair(
        self, db_session
    ):
        org, _, import_id, alice, _, morning = await self._alice_logged_the_wrong_hours(
            db_session
        )
        service = HistoricalStaffingCommitService(db_session)

        seat = await self._signup_key(service, org, import_id, alice, "Driver")
        hours = await service.leftovers_view(org, import_id, kind="hours")

        assert seat["state"] == "open"
        assert seat["date"] == date(2016, 5, 3)
        assert [c["attendance_id"] for c in seat["candidates"]] == [
            str(
                (
                    await db_session.execute(
                        select(ShiftAttendance.id).where(
                            ShiftAttendance.shift_id == morning.id
                        )
                    )
                ).scalar_one()
            )
        ]
        assert [(i["member"], i["date"]) for i in hours["items"]] == [
            ("Alice Ng", date(2016, 5, 3))
        ]

    async def test_a_hand_pairing_is_written_onto_those_hours(self, db_session):
        org, admin, import_id, alice, _, morning = (
            await self._alice_logged_the_wrong_hours(db_session)
        )
        service = HistoricalStaffingCommitService(db_session)
        seat = await self._signup_key(service, org, import_id, alice, "Driver")
        entry = seat["candidates"][0]["attendance_id"]

        await service.update_leftovers(org, import_id, {seat["key"]: entry}, {})

        preview = (await service.preview(org, import_id))["hours_match"]
        assert preview["paired_by_reviewer"] == 1
        assert preview["hours_without_signup"] == 0
        open_seats = await service.leftovers_view(org, import_id, kind="signups")
        assert seat["key"] not in {i["key"] for i in open_seats["items"]}
        resolved = await service.leftovers_view(
            org, import_id, kind="signups", show_resolved=True
        )
        (paired,) = [i for i in resolved["items"] if i["key"] == seat["key"]]
        assert paired["state"] == "paired"
        assert paired["paired_with"]["attendance_id"] == entry

        await service.commit(org, import_id, admin)
        assert await _seats_on(db_session, morning.id) == {alice: "driver"}

    async def test_a_seat_cannot_take_another_members_hours(self, db_session):
        org, _, import_id, _, bob, morning = await self._alice_logged_the_wrong_hours(
            db_session
        )
        service = HistoricalStaffingCommitService(db_session)
        seat = await self._signup_key(service, org, import_id, bob, "Lead Technician")
        hours = await service.leftovers_view(org, import_id, kind="hours")
        alices = hours["items"][0]["key"]

        with pytest.raises(ValueError, match="own member"):
            await service.update_leftovers(org, import_id, {seat["key"]: alices}, {})

    async def test_reviewed_leftovers_stop_counting_as_outstanding(self, db_session):
        org, _, import_id, _, _, _ = await self._alice_logged_the_wrong_hours(
            db_session
        )
        service = HistoricalStaffingCommitService(db_session)
        hours = await service.leftovers_view(org, import_id, kind="hours")
        mark = m.HOURS_LEFTOVER + hours["items"][0]["key"]

        await service.update_leftovers(org, import_id, {}, {mark: True})

        preview = (await service.preview(org, import_id))["hours_match"]
        assert preview["hours_reviewed"] == 1
        assert (await service.leftovers_view(org, import_id, kind="hours"))[
            "total"
        ] == 0
        shown = await service.leftovers_view(
            org, import_id, kind="hours", show_resolved=True
        )
        assert [i["state"] for i in shown["items"]] == ["reviewed"]

        await service.update_leftovers(org, import_id, {}, {mark: False})
        assert (await service.leftovers_view(org, import_id, kind="hours"))[
            "total"
        ] == 1

    async def test_the_seats_list_filters_by_member_and_date(self, db_session):
        org, _, import_id, alice, bob, _ = await self._alice_logged_the_wrong_hours(
            db_session
        )
        service = HistoricalStaffingCommitService(db_session)

        bobs = await service.leftovers_view(
            org, import_id, kind="signups", member_id=bob
        )
        on_the_third = await service.leftovers_view(
            org,
            import_id,
            kind="signups",
            date_from=date(2016, 5, 3),
            date_to=date(2016, 5, 3),
        )

        assert {i["member_id"] for i in bobs["items"]} == {bob}
        assert {i["date"] for i in on_the_third["items"]} == {date(2016, 5, 3)}
        assert {(mem["id"], mem["name"]) for mem in bobs["members"]} == {
            (bob, "Bob Diaz")
        }
        assert alice in {mem["id"] for mem in on_the_third["members"]}
