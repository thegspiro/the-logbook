"""Apparatus events against the real schema.

The behaviours a department relies on, each against MySQL rather than a
mock: nights are ordinary events that are never shifts; a seat brings the RSVP
check-in and the hours credit work from; the Driver seat follows the shift EVOC
rule by the night's mode; a crew's hours go to the night's own category
*instead of* the event-type mapping (never as well); and nothing crosses an
organization.
"""

import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    EventHourMapping,
)
from app.models.apparatus import (
    Apparatus,
    ApparatusOperator,
    ApparatusStatus,
    ApparatusType,
    EvocLevel,
)
from app.models.apparatus_event import EventApparatusPlan, EventApparatusSeat
from app.models.event import Event, EventRSVP, EventType, RSVPHistory
from app.models.training import Shift
from app.models.user import Organization, User
from app.schemas.apparatus_event import (
    ApparatusEventTemplateCreate,
    NightPlanUpdate,
    NightSpec,
    ScheduleNightsRequest,
)
from app.services.admin_hours_service import AdminHoursService
from app.services.apparatus_event_service import (
    ApparatusEventService,
    ConflictsNotAcknowledged,
)
from app.services.event_service import EventService

pytestmark = pytest.mark.integration

FUTURE = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=20)


def _night(day_offset: int = 0, hours: int = 3) -> NightSpec:
    start = FUTURE + timedelta(days=day_offset)
    return NightSpec(start_datetime=start, end_datetime=start + timedelta(hours=hours))


class _World:
    """One department with a coordinator, members, an EVOC-3 engine and two
    Admin Hours categories, one of them mapped to Public Education."""


async def _user(db: AsyncSession, org: Organization, label: str) -> User:
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"{label}-{uuid.uuid4().hex[:8]}",
        email=f"{label}-{uuid.uuid4().hex[:8]}@example.test",
        first_name=label.title(),
        last_name="Tester",
    )
    db.add(user)
    return user


async def _world(db: AsyncSession) -> _World:
    w = _World()
    suffix = uuid.uuid4().hex[:8]
    w.org = Organization(
        id=str(uuid.uuid4()),
        name="Outreach FD",
        slug=f"outreach-{suffix}",
        timezone="America/New_York",
    )
    db.add(w.org)
    await db.flush()

    w.coordinator = await _user(db, w.org, "coordinator")
    w.santa = await _user(db, w.org, "santa")
    w.elf = await _user(db, w.org, "elf")
    w.driver = await _user(db, w.org, "driver")
    w.rookie = await _user(db, w.org, "rookie")
    await db.flush()

    level2 = EvocLevel(
        id=str(uuid.uuid4()),
        organization_id=w.org.id,
        level_number=2,
        name="EVOC 2",
        code=f"E2{suffix}",
        is_cumulative=True,
    )
    level3 = EvocLevel(
        id=str(uuid.uuid4()),
        organization_id=w.org.id,
        level_number=3,
        name="EVOC 3",
        code=f"E3{suffix}",
        is_cumulative=True,
    )
    unit_type = ApparatusType(
        id=str(uuid.uuid4()), organization_id=w.org.id, name="Engine", code=f"T{suffix}"
    )
    w.status = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=w.org.id,
        name="In Service",
        code=f"S{suffix}",
        is_available=True,
    )
    db.add_all([level2, level3, unit_type, w.status])
    await db.flush()
    w.engine = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=w.org.id,
        unit_number=f"E1-{suffix}",
        apparatus_type_id=unit_type.id,
        status_id=w.status.id,
        required_evoc_level_id=level3.id,
    )
    db.add(w.engine)
    await db.flush()
    for user, level in ((w.driver, level3), (w.rookie, level2)):
        db.add(
            ApparatusOperator(
                id=str(uuid.uuid4()),
                organization_id=w.org.id,
                apparatus_id=w.engine.id,
                user_id=user.id,
                evoc_level_id=level.id,
                is_certified=True,
                is_active=True,
            )
        )

    w.outreach = AdminHoursCategory(
        id=str(uuid.uuid4()),
        organization_id=w.org.id,
        name="Community Outreach",
        require_approval=False,
    )
    w.public_ed = AdminHoursCategory(
        id=str(uuid.uuid4()),
        organization_id=w.org.id,
        name="Public Education",
        require_approval=False,
    )
    db.add_all([w.outreach, w.public_ed])
    await db.flush()
    db.add(
        EventHourMapping(
            id=str(uuid.uuid4()),
            organization_id=w.org.id,
            event_type=EventType.PUBLIC_EDUCATION.value,
            admin_hours_category_id=w.public_ed.id,
            percentage=100,
        )
    )
    await db.flush()
    w.service = ApparatusEventService(db)
    return w


def _template_body(w: _World, **overrides) -> ApparatusEventTemplateCreate:
    body = {
        "name": "Santamobile — Full",
        "event_type": "public_education",
        "default_start_time": "18:00",
        "duration_minutes": 210,
        "admin_hours_category_id": w.outreach.id,
        "evoc_mode": "enforce",
        "units": [
            {
                "apparatus_id": w.engine.id,
                "seats": [
                    {"name": "Driver", "seat_type": "driver", "count": 1},
                    {"name": "Santa", "count": 1},
                    {"name": "Elf", "count": 2},
                ],
            }
        ],
    }
    body.update(overrides)
    return ApparatusEventTemplateCreate(**body)


async def _scheduled(w: _World, db: AsyncSession, nights=None, **template_overrides):
    template = await w.service.create_template(
        _template_body(w, **template_overrides), w.org.id, w.coordinator.id
    )
    series_id, event_ids = await w.service.schedule_nights(
        template.id,
        ScheduleNightsRequest(title="Santamobile 2026", nights=nights or [_night()]),
        w.org.id,
        w.coordinator.id,
    )
    return template, series_id, event_ids


async def _seat(w: _World, event_id: str, name: str, index: int = 0):
    _event, plan = await w.service.get_night(event_id, w.org.id)
    seats = [s for u in plan.units for s in u.seats if s.name == name]
    return seats[index]


# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------


class TestScheduling:
    async def test_each_night_is_an_event_with_its_own_seats_and_never_a_shift(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        shifts_before = await db_session.scalar(select(func.count(Shift.id)))

        _template, series_id, event_ids = await _scheduled(
            w, db_session, nights=[_night(0), _night(2)]
        )

        assert len(event_ids) == 2
        events = (
            await db_session.execute(select(Event).where(Event.id.in_(event_ids)))
        ).scalars()
        for event in events:
            assert event.event_type == EventType.PUBLIC_EDUCATION
            assert event.organization_id == w.org.id
        seats = await db_session.scalar(
            select(func.count(EventApparatusSeat.id)).where(
                EventApparatusSeat.event_id.in_(event_ids)
            )
        )
        # Driver + Santa + Elf x2, on each night separately.
        assert seats == 8
        plans = (
            await db_session.execute(
                select(EventApparatusPlan.series_id).where(
                    EventApparatusPlan.event_id.in_(event_ids)
                )
            )
        ).scalars()
        assert set(plans) == {series_id}
        assert await db_session.scalar(select(func.count(Shift.id))) == shifts_before

    async def test_an_overlapping_night_waits_for_acknowledgement(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        template, _series, _ids = await _scheduled(w, db_session)

        with pytest.raises(ConflictsNotAcknowledged) as caught:
            await w.service.schedule_nights(
                template.id,
                ScheduleNightsRequest(title="Second run", nights=[_night(0)]),
                w.org.id,
                w.coordinator.id,
            )
        assert caught.value.conflicts[0].conflicting_title == "Santamobile 2026"

        _series, ids = await w.service.schedule_nights(
            template.id,
            ScheduleNightsRequest(
                title="Second run", nights=[_night(0)], acknowledge_conflicts=True
            ),
            w.org.id,
            w.coordinator.id,
        )
        assert len(ids) == 1

    async def test_an_unavailable_apparatus_is_a_conflict(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        w.status.is_available = False
        await db_session.flush()
        template = await w.service.create_template(
            _template_body(w), w.org.id, w.coordinator.id
        )

        conflicts = await w.service.check_template_conflicts(
            template.id, [_night()], w.org.id
        )

        assert conflicts
        assert "In Service" in conflicts[0].reason


# ---------------------------------------------------------------------------
# Seats
# ---------------------------------------------------------------------------


class TestSeats:
    async def test_taking_a_seat_makes_the_member_attending(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, event_id, "Santa")

        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)

        rsvp = await db_session.scalar(
            select(EventRSVP).where(
                EventRSVP.event_id == event_id, EventRSVP.user_id == w.santa.id
            )
        )
        assert rsvp is not None
        assert rsvp.status.value == "going"
        history = await db_session.scalar(
            select(func.count(RSVPHistory.id)).where(RSVPHistory.rsvp_id == rsvp.id)
        )
        assert history == 1

    async def test_one_seat_per_member_per_night(self, db_session: AsyncSession):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        elf = await _seat(w, event_id, "Elf")

        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        with pytest.raises(ValueError, match="already have the Santa seat"):
            await w.service.claim_seat(event_id, elf.id, w.org.id, w.santa)

    async def test_the_database_refuses_a_member_in_two_seats(
        self, db_session: AsyncSession
    ):
        # The backstop for two concurrent claims that both pass the check.
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        first = await _seat(w, event_id, "Elf", 0)
        second = await _seat(w, event_id, "Elf", 1)
        first.user_id = w.elf.id
        second.user_id = w.elf.id
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await db_session.rollback()

    async def test_a_taken_seat_cannot_be_claimed(self, db_session: AsyncSession):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)

        with pytest.raises(ValueError, match="took that seat first"):
            await w.service.claim_seat(event_id, santa.id, w.org.id, w.elf)

    async def test_leaving_before_check_in_withdraws_the_rsvp(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        elf = await _seat(w, event_id, "Elf")
        await w.service.claim_seat(event_id, elf.id, w.org.id, w.elf)

        await w.service.release_seat(
            event_id, elf.id, w.org.id, w.elf, as_manager=False
        )

        rsvp = await db_session.scalar(
            select(EventRSVP).where(
                EventRSVP.event_id == event_id, EventRSVP.user_id == w.elf.id
            )
        )
        assert rsvp.status.value == "not_going"
        assert (await _seat(w, event_id, "Elf")).user_id is None

    async def test_a_checked_in_member_keeps_their_seat(self, db_session: AsyncSession):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        elf = await _seat(w, event_id, "Elf")
        await w.service.claim_seat(event_id, elf.id, w.org.id, w.elf)
        rsvp = await db_session.scalar(
            select(EventRSVP).where(
                EventRSVP.event_id == event_id, EventRSVP.user_id == w.elf.id
            )
        )
        rsvp.checked_in = True
        await db_session.flush()

        with pytest.raises(ValueError, match="already checked in"):
            await w.service.release_seat(
                event_id, elf.id, w.org.id, w.elf, as_manager=False
            )

    async def test_only_a_coordinator_clears_someone_elses_seat(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)

        with pytest.raises(PermissionError):
            await w.service.release_seat(
                event_id, santa.id, w.org.id, w.elf, as_manager=False
            )
        await w.service.release_seat(
            event_id, santa.id, w.org.id, w.coordinator, as_manager=True
        )
        assert (await _seat(w, event_id, "Santa")).user_id is None

    async def test_assigning_a_seated_member_moves_them(self, db_session: AsyncSession):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        elf = await _seat(w, event_id, "Elf")
        await w.service.claim_seat(event_id, elf.id, w.org.id, w.santa)

        await w.service.assign_seat(
            event_id, santa.id, w.santa.id, w.org.id, w.coordinator
        )

        assert (await _seat(w, event_id, "Santa")).user_id == w.santa.id
        assert (await _seat(w, event_id, "Elf")).user_id is None

    async def test_self_signup_can_be_switched_off(self, db_session: AsyncSession):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session, allow_self_signup=False)
        santa = await _seat(w, event_id, "Santa")

        with pytest.raises(ValueError, match="assigned by the coordinator"):
            await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        await w.service.assign_seat(
            event_id, santa.id, w.santa.id, w.org.id, w.coordinator
        )

    async def test_a_cancelled_night_takes_no_crew(self, db_session: AsyncSession):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        event = await db_session.get(Event, event_id)
        event.is_cancelled = True
        await db_session.flush()
        santa = await _seat(w, event_id, "Santa")

        with pytest.raises(ValueError, match="cancelled"):
            await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)


# ---------------------------------------------------------------------------
# The Driver seat and EVOC
# ---------------------------------------------------------------------------


class TestDriverSeat:
    async def test_enforce_blocks_a_member_below_the_engines_level(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session, evoc_mode="enforce")
        driver_seat = await _seat(w, event_id, "Driver")

        with pytest.raises(ValueError, match="blocked"):
            await w.service.claim_seat(event_id, driver_seat.id, w.org.id, w.rookie)
        with pytest.raises(ValueError, match="blocked"):
            await w.service.assign_seat(
                event_id, driver_seat.id, w.rookie.id, w.org.id, w.coordinator
            )
        outcome = await w.service.claim_seat(
            event_id, driver_seat.id, w.org.id, w.driver
        )
        assert outcome.warnings == []

    async def test_warn_seats_the_member_and_says_why(self, db_session: AsyncSession):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session, evoc_mode="warn")
        driver_seat = await _seat(w, event_id, "Driver")

        outcome = await w.service.claim_seat(
            event_id, driver_seat.id, w.org.id, w.rookie
        )

        assert outcome.warnings
        assert outcome.warnings[0]["type"] == "evoc_mismatch"
        assert (await _seat(w, event_id, "Driver")).user_id == w.rookie.id

    async def test_ignore_checks_nothing(self, db_session: AsyncSession):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session, evoc_mode="ignore")
        driver_seat = await _seat(w, event_id, "Driver")

        outcome = await w.service.claim_seat(event_id, driver_seat.id, w.org.id, w.elf)

        assert outcome.warnings == []

    async def test_only_the_driver_seat_is_checked(self, db_session: AsyncSession):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session, evoc_mode="enforce")
        santa = await _seat(w, event_id, "Santa")

        outcome = await w.service.claim_seat(event_id, santa.id, w.org.id, w.rookie)

        assert outcome.warnings == []

    async def test_candidates_are_judged_by_the_same_rule(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session, evoc_mode="enforce")
        _event, plan = await w.service.get_night(event_id, w.org.id)

        _plan, _unit, candidates = await w.service.driver_candidates(
            event_id, plan.units[0].id, w.org.id
        )

        verdicts = {c["user_id"]: c["allowed"] for c in candidates}
        assert verdicts == {w.driver.id: True, w.rookie.id: False}
        assert candidates[0]["user_id"] == w.driver.id

    async def test_tightening_a_night_rechecks_its_driver(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session, evoc_mode="ignore")
        driver_seat = await _seat(w, event_id, "Driver")
        await w.service.claim_seat(event_id, driver_seat.id, w.org.id, w.rookie)
        _event, plan = await w.service.get_night(event_id, w.org.id)
        units = [
            {
                "id": u.id,
                "apparatus_id": u.apparatus_id,
                "seats": [
                    {"id": s.id, "name": s.name, "seat_type": s.seat_type}
                    for s in u.seats
                ],
            }
            for u in plan.units
        ]

        with pytest.raises(ValueError, match="blocked"):
            await w.service.update_night_plan(
                event_id,
                NightPlanUpdate(
                    evoc_mode="enforce",
                    allow_self_signup=True,
                    show_on_schedule=True,
                    units=units,
                ),
                w.org.id,
            )


# ---------------------------------------------------------------------------
# Editing one night
# ---------------------------------------------------------------------------


class TestNightPlan:
    async def _units(self, w, event_id):
        _event, plan = await w.service.get_night(event_id, w.org.id)
        return [
            {
                "id": u.id,
                "apparatus_id": u.apparatus_id,
                "seats": [
                    {"id": s.id, "name": s.name, "seat_type": s.seat_type}
                    for s in u.seats
                ],
            }
            for u in plan.units
        ]

    async def test_a_seat_can_be_added_to_one_night_only(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (first, second) = await _scheduled(
            w, db_session, nights=[_night(0), _night(2)]
        )
        units = await self._units(w, first)
        units[0]["seats"].append({"name": "Elf"})

        await w.service.update_night_plan(
            first,
            NightPlanUpdate(
                evoc_mode="enforce",
                allow_self_signup=True,
                show_on_schedule=True,
                units=units,
            ),
            w.org.id,
        )

        count = await db_session.scalar(
            select(func.count(EventApparatusSeat.id)).where(
                EventApparatusSeat.event_id == first
            )
        )
        other = await db_session.scalar(
            select(func.count(EventApparatusSeat.id)).where(
                EventApparatusSeat.event_id == second
            )
        )
        assert (count, other) == (5, 4)

    async def test_a_filled_seat_is_not_silently_dropped(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        units = await self._units(w, event_id)
        units[0]["seats"] = [s for s in units[0]["seats"] if s["id"] != santa.id]

        with pytest.raises(ValueError, match="Someone is in the Santa seat"):
            await w.service.update_night_plan(
                event_id,
                NightPlanUpdate(
                    evoc_mode="enforce",
                    allow_self_signup=True,
                    show_on_schedule=True,
                    units=units,
                ),
                w.org.id,
            )


# ---------------------------------------------------------------------------
# Hours
# ---------------------------------------------------------------------------


class TestHours:
    async def _credit(self, db: AsyncSession, w: _World, event_id: str):
        rsvp = EventRSVP(
            id=str(uuid.uuid4()),
            organization_id=w.org.id,
            event_id=event_id,
            user_id=w.santa.id,
            checked_in=True,
        )
        db.add(rsvp)
        await db.flush()
        start = FUTURE
        return await AdminHoursService(db).credit_event_attendance(
            organization_id=w.org.id,
            user_id=w.santa.id,
            event_id=event_id,
            rsvp_id=rsvp.id,
            event_title="Santamobile 2026",
            check_in_at=start,
            check_out_at=start + timedelta(hours=3),
            duration_minutes=180,
            event_type=EventType.PUBLIC_EDUCATION.value,
            custom_category=None,
        )

    async def _categories(self, db: AsyncSession, event_id: str):
        return list(
            (
                await db.execute(
                    select(AdminHoursEntry.category_id).where(
                        AdminHoursEntry.source_event_id == event_id
                    )
                )
            ).scalars()
        )

    async def test_a_crew_is_credited_to_the_nights_category_instead_of_the_mapping(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)

        assert await self._credit(db_session, w, event_id) == 1

        # Once, under Community Outreach — not also under the Public
        # Education mapping the department set up for ordinary events.
        assert await self._categories(db_session, event_id) == [w.outreach.id]

    async def test_an_ordinary_event_still_follows_the_mapping(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        event = Event(
            id=str(uuid.uuid4()),
            organization_id=w.org.id,
            title="Fire safety talk",
            event_type=EventType.PUBLIC_EDUCATION,
            start_datetime=FUTURE,
            end_datetime=FUTURE + timedelta(hours=1),
        )
        db_session.add(event)
        await db_session.flush()

        await self._credit(db_session, w, event.id)

        assert await self._categories(db_session, event.id) == [w.public_ed.id]

    async def test_a_night_without_a_category_falls_back_to_the_mapping(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(
            w, db_session, admin_hours_category_id=None
        )

        await self._credit(db_session, w, event_id)

        assert await self._categories(db_session, event_id) == [w.public_ed.id]

    async def test_the_event_card_states_the_same_category(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        event = await db_session.get(Event, event_id)

        hours, label = await EventService(db_session).resolve_credited_hours(
            event, w.org.id
        )

        assert (hours, label) == (3.0, "Community Outreach")


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------


class TestOrganizationScoping:
    async def test_another_departments_apparatus_cannot_be_used(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        other = await _world(db_session)

        with pytest.raises(ValueError, match="Invalid apparatus"):
            await w.service.create_template(
                _template_body(
                    w,
                    units=[
                        {
                            "apparatus_id": other.engine.id,
                            "seats": [{"name": "Santa"}],
                        }
                    ],
                ),
                w.org.id,
                w.coordinator.id,
            )

    async def test_another_departments_category_cannot_be_used(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        other = await _world(db_session)

        with pytest.raises(ValueError, match="admin hours category"):
            await w.service.create_template(
                _template_body(w, admin_hours_category_id=other.outreach.id),
                w.org.id,
                w.coordinator.id,
            )

    async def test_a_night_is_invisible_to_another_department(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        other = await _world(db_session)
        template, _s, (event_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, event_id, "Santa")

        assert await other.service.get_night(event_id, other.org.id) is None
        assert await other.service.get_template(template.id, other.org.id) is None
        assert (
            await other.service.claim_seat(event_id, santa.id, other.org.id, other.elf)
            is None
        )

    async def test_another_departments_member_cannot_be_seated(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        other = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, event_id, "Santa")

        with pytest.raises(ValueError, match="Invalid member"):
            await w.service.assign_seat(
                event_id, santa.id, other.elf.id, w.org.id, w.coordinator
            )


# ---------------------------------------------------------------------------
# The scheduling overlay
# ---------------------------------------------------------------------------


class TestCalendar:
    async def test_a_night_shows_unless_its_plan_opts_out(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (shown,) = await _scheduled(w, db_session)
        _t2, _s2, (hidden,) = await _scheduled(
            w, db_session, nights=[_night(5)], show_on_schedule=False, name="Quiet"
        )
        santa = await _seat(w, shown, "Santa")
        await w.service.claim_seat(shown, santa.id, w.org.id, w.santa)

        rows = await w.service.calendar(
            w.org.id,
            FUTURE - timedelta(days=1),
            FUTURE + timedelta(days=10),
            w.santa.id,
        )

        assert [r["event_id"] for r in rows] == [shown]
        assert rows[0]["is_mine"] is True
        assert (rows[0]["filled"], rows[0]["total"]) == (1, 4)

    async def test_the_range_is_bounded(self, db_session: AsyncSession):
        w = await _world(db_session)
        with pytest.raises(ValueError, match="at most"):
            await w.service.calendar(
                w.org.id, FUTURE, FUTURE + timedelta(days=90), w.santa.id
            )


class TestTemplateRules:
    def test_a_training_event_is_refused(self):
        with pytest.raises(ValueError, match="Training"):
            ApparatusEventTemplateCreate(
                name="Driver training",
                event_type="training",
                units=[{"apparatus_id": "x", "seats": [{"name": "Driver"}]}],
            )

    def test_the_same_apparatus_twice_is_refused(self):
        with pytest.raises(ValueError, match="only once"):
            ApparatusEventTemplateCreate(
                name="Parade",
                units=[
                    {"apparatus_id": "x", "seats": [{"name": "Driver"}]},
                    {"apparatus_id": "x", "seats": [{"name": "Waver"}]},
                ],
            )

    def test_a_night_is_used_on_the_departments_date(self):
        # 9 PM in New York on Dec 7 is already Dec 8 in UTC; the EVOC check
        # must look at Dec 7.
        from zoneinfo import ZoneInfo

        from app.utils.org_timezone import local_date

        evening = datetime(2026, 12, 8, 2, 0, tzinfo=timezone.utc)
        assert local_date(evening, ZoneInfo("America/New_York")) == date(2026, 12, 7)


# ---------------------------------------------------------------------------
# Over HTTP: the permission gates and the conflict answer
# ---------------------------------------------------------------------------


class _Http:
    def __init__(self, db, w, client, holder):
        self.db, self.w, self.client, self.holder = db, w, client, holder

    async def act_as(self, member: str, *permissions: str) -> None:
        """Act as one of the world's members, by name, holding exactly
        *permissions*. Ids are read from ``w.ids``: the ORM objects may have
        been expired by an earlier request's rollback."""
        user_id = self.w.ids[member]
        position_id = str(uuid.uuid4())
        await self.db.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, :name, :slug, :perms)"
            ),
            {
                "id": position_id,
                "org": self.w.ids["org"],
                "name": f"Bench {position_id[:6]}",
                "slug": f"bench_{position_id[:6]}",
                "perms": json.dumps(list(permissions)),
            },
        )
        await self.db.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": user_id, "p": position_id},
        )
        await self.db.commit()
        user = await self.db.get(User, user_id)
        await self.db.refresh(user, ["positions"])
        self.holder["user"] = user

    async def call(self, method: str, url: str, **kwargs):
        """One request, then reload the acting member: a refused request rolls
        the session back, which expires everything it had loaded."""
        response = await self.client.request(method, url, **kwargs)
        self.db.expire_all()
        user = self.holder["user"]
        await self.db.refresh(user)
        await self.db.refresh(user, ["positions"])
        return response


@pytest.fixture
async def http(db_session: AsyncSession):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.api.v1.endpoints import apparatus_events as endpoints
    from app.core.database import get_db

    w = await _world(db_session)
    # Committed (a savepoint release, under db_session) so a refused request's
    # rollback cannot take the department with it.
    await db_session.commit()
    w.ids = {
        name: getattr(w, name).id for name in ("coordinator", "santa", "elf", "org")
    }
    holder: dict = {}

    async def get_session_like():
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    app = FastAPI()
    app.include_router(endpoints.router, prefix="/apparatus-events")
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    app.dependency_overrides[get_db] = get_session_like
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield _Http(db_session, w, client, holder)


def _payload(w: _World) -> dict:
    return _template_body(w).model_dump(mode="json")


def _night_json(day_offset: int = 0) -> dict:
    return _night(day_offset).model_dump(mode="json")


class TestOverHttp:
    async def test_a_member_signs_up_but_cannot_coordinate(self, http: _Http):
        w = http.w
        _t, _s, (event_id,) = await _scheduled(w, http.db)
        santa_seat = (await _seat(w, event_id, "Santa")).id
        elf_seat = (await _seat(w, event_id, "Elf")).id
        await http.act_as("santa", "events.view", "apparatus_events.signup")

        assert (
            await http.call("GET", "/apparatus-events/templates")
        ).status_code == 403
        board = await http.call(
            "POST", f"/apparatus-events/events/{event_id}/seats/{santa_seat}/claim"
        )
        assert board.status_code == 200, board.text
        body = board.json()
        assert body["my_seat_id"] == santa_seat
        assert body["can_manage"] is False
        assert body["night_number"] == 1
        assert body["night_count"] == 1

        assigned = await http.call(
            "PUT",
            f"/apparatus-events/events/{event_id}/seats/{elf_seat}/assignment",
            json={"user_id": w.ids["elf"]},
        )
        assert assigned.status_code == 403

    async def test_the_calendar_needs_events_view(self, http: _Http):
        w = http.w
        params = {
            "start": (FUTURE - timedelta(days=1)).isoformat(),
            "end": (FUTURE + timedelta(days=5)).isoformat(),
        }
        await _scheduled(w, http.db)
        await http.act_as("elf", "apparatus_events.signup")
        denied = await http.call("GET", "/apparatus-events/calendar", params=params)
        assert denied.status_code == 403
        await http.act_as("santa", "events.view")
        allowed = await http.call("GET", "/apparatus-events/calendar", params=params)
        assert allowed.status_code == 200
        assert [item["title"] for item in allowed.json()] == ["Santamobile 2026"]

    async def test_a_conflict_answers_409_until_acknowledged(self, http: _Http):
        w = http.w
        await http.act_as("coordinator", "events.manage", "apparatus_events.manage")
        created = await http.call(
            "POST", "/apparatus-events/templates", json=_payload(w)
        )
        assert created.status_code == 201, created.text
        template_id = created.json()["id"]
        assert created.json()["total_seats"] == 4

        first = await http.call(
            "POST",
            f"/apparatus-events/templates/{template_id}/schedule",
            json={"title": "Santamobile 2026", "nights": [_night_json()]},
        )
        assert first.status_code == 201, first.text

        clash = await http.call(
            "POST",
            f"/apparatus-events/templates/{template_id}/schedule",
            json={"title": "Again", "nights": [_night_json()]},
        )
        assert clash.status_code == 409
        assert clash.json()["detail"]["conflicts"][0]["conflicting_title"] == (
            "Santamobile 2026"
        )

        acknowledged = await http.call(
            "POST",
            f"/apparatus-events/templates/{template_id}/schedule",
            json={
                "title": "Again",
                "nights": [_night_json()],
                "acknowledge_conflicts": True,
            },
        )
        assert acknowledged.status_code == 201
