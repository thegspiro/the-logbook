"""The session-attendance requirement: attend a share of the linked sessions.

Pins the rule agreed with the department:

  * the requirement is met by attending ``required_attendance_pct`` of the
    sessions linked to it that were held in its window;
  * a session held before the member joined is not charged to them;
  * a waiver or leave covering a session's day excuses it, unless the member
    attended anyway; a waiver scoped to another requirement does not;
  * nothing charged yet is met, not failed;
  * only finalized, uncancelled sessions count as held, dated on the
    department's calendar;
  * every grader reads the one rule, and a caller that forgets to load the
    sessions fails loudly instead of reading everyone as compliant;
  * a session links only to attendance requirements in its own organization.
"""

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.event import Event, EventType
from app.models.training import (
    RequirementFrequency,
    RequirementSource,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingSessionRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User
from app.services.training_compliance import (
    HeldSession,
    evaluate_member_requirement,
    evaluate_member_requirement_detail,
    load_graded_records,
    load_held_sessions,
    tally_session_attendance,
)
from app.services.training_service import TrainingService
from app.services.training_session_service import TrainingSessionService
from app.services.training_waiver_service import (
    SOURCE_LEAVE,
    SOURCE_WAIVER,
    WaiverPeriod,
)

TODAY = date(2026, 11, 4)
REQ_ID = "req-attend"


def _req(pct=60.0, **kw):
    fields = dict(
        id=REQ_ID,
        name="Company drills",
        requirement_type=RequirementType.SESSION_ATTENDANCE,
        frequency=RequirementFrequency.ANNUAL,
        required_attendance_pct=pct,
        due_date_type=None,
        rolling_period_months=None,
        period_start_month=None,
        period_start_day=None,
        period_end_month=None,
        period_end_day=None,
        include_current_month=None,
        recency_days=None,
        year=None,
        due_date=None,
        training_type=None,
        description=None,
        new_member_cutoff_date=None,
        existing_member_deadline=None,
        allows_chief_override=False,
    )
    fields.update(kw)
    return SimpleNamespace(**fields)


def _held(*days):
    return [HeldSession(f"ev-{d.isoformat()}", d) for d in days]


def _attended(*days):
    return [
        SimpleNamespace(
            status=TrainingStatus.COMPLETED,
            source_event_id=f"ev-{d.isoformat()}",
            completion_date=d,
            expiration_date=None,
            course_id=None,
            course_name="Drill",
            training_type=TrainingType.CONTINUING_EDUCATION,
            hours_completed=2,
            certification_number=None,
            category_id=None,
        )
        for d in days
    ]


FIVE = [date(2026, m, 16) for m in (1, 2, 3, 4, 5)]


def _waiver(start, end, requirement_ids=None, source=SOURCE_WAIVER):
    return WaiverPeriod(start, end, requirement_ids=requirement_ids, source=source)


@pytest.mark.unit
class TestTheRule:
    def test_three_of_five_meets_sixty_percent(self):
        tally = tally_session_attendance(
            _req(), _attended(*FIVE[:3]), _held(*FIVE), TODAY
        )
        assert (tally.attended, tally.charged, tally.needed) == (3, 5, 3)
        assert tally.met

    def test_two_of_five_falls_short(self):
        tally = tally_session_attendance(
            _req(), _attended(*FIVE[:2]), _held(*FIVE), TODAY
        )
        assert (tally.attended, tally.needed) == (2, 3)
        assert not tally.met

    def test_a_drill_before_the_member_joined_is_not_charged(self):
        tally = tally_session_attendance(
            _req(),
            _attended(FIVE[3]),
            _held(*FIVE),
            TODAY,
            join_date=date(2026, 4, 1),
        )
        assert (tally.attended, tally.charged, tally.needed) == (1, 2, 2)

    def test_a_drill_outside_the_window_or_after_the_cut_off_is_not_charged(self):
        held = _held(date(2025, 12, 18), *FIVE, date(2026, 11, 19))
        tally = tally_session_attendance(_req(), _attended(*FIVE), held, TODAY)
        assert tally.held == 5

    def test_a_waived_drill_drops_out(self):
        tally = tally_session_attendance(
            _req(),
            _attended(*FIVE[:2]),
            _held(*FIVE),
            TODAY,
            waivers=[_waiver(FIVE[4], FIVE[4], requirement_ids=[REQ_ID])],
        )
        # 60% of the four still charged is 3 (2.4 rounds up).
        assert (tally.charged, tally.needed, tally.base_needed) == (4, 3, 3)

    def test_leave_of_absence_excuses_every_drill_it_covers(self):
        tally = tally_session_attendance(
            _req(),
            _attended(FIVE[0]),
            _held(*FIVE),
            TODAY,
            waivers=[_waiver(FIVE[1], FIVE[4], source=SOURCE_LEAVE)],
        )
        assert (tally.attended, tally.charged, tally.needed) == (1, 1, 1)
        assert tally.met

    def test_a_waiver_for_another_requirement_excuses_nothing(self):
        tally = tally_session_attendance(
            _req(),
            [],
            _held(*FIVE),
            TODAY,
            waivers=[_waiver(FIVE[0], FIVE[4], requirement_ids=["other"])],
        )
        assert tally.charged == 5

    def test_a_drill_attended_during_leave_still_counts(self):
        tally = tally_session_attendance(
            _req(),
            _attended(FIVE[1]),
            _held(*FIVE),
            TODAY,
            waivers=[_waiver(FIVE[1], FIVE[4], source=SOURCE_LEAVE)],
        )
        assert (tally.attended, tally.charged) == (1, 2)

    def test_nothing_held_is_met(self):
        tally = tally_session_attendance(_req(), [], [], TODAY)
        assert tally.met

    def test_a_record_not_from_a_linked_session_does_not_count(self):
        stray = _attended(FIVE[0])[0]
        stray.source_event_id = "some-other-event"
        tally = tally_session_attendance(_req(), [stray], _held(*FIVE), TODAY)
        assert tally.attended == 0


@pytest.mark.unit
class TestEveryGraderReadsIt:
    def test_the_compliance_grader(self):
        held = {REQ_ID: _held(*FIVE)}
        ev = evaluate_member_requirement_detail(
            _req(), _attended(*FIVE[:3]), TODAY, held_sessions=held
        )
        assert ev.status == "completed"
        assert (ev.progress_current, ev.progress_required, ev.progress_unit) == (
            3,
            3,
            "sessions",
        )
        status, _, _ = evaluate_member_requirement(
            _req(), _attended(FIVE[0]), TODAY, held_sessions=held
        )
        assert status == "in_progress"

    def test_the_my_training_grader_agrees(self):
        held = {REQ_ID: _held(*FIVE)}
        met = TrainingService.evaluate_requirement_detail(
            _req(), _attended(*FIVE[:3]), TODAY, held_sessions=held
        )
        short = TrainingService.evaluate_requirement_detail(
            _req(), _attended(FIVE[0]), TODAY, held_sessions=held
        )
        assert met["is_met"]
        assert met["completed_hours"] == 3
        assert not short["is_met"]
        assert short["required_hours"] == 3
        assert met["due_date"] == "2026-12-31"

    def test_nothing_held_is_met_on_both(self):
        held = {REQ_ID: []}
        ev = evaluate_member_requirement_detail(_req(), [], TODAY, held_sessions=held)
        detail = TrainingService.evaluate_requirement_detail(
            _req(), [], TODAY, held_sessions=held
        )
        assert ev.status == "completed"
        assert detail["is_met"]

    def test_the_matrix_states_the_target_as_a_share(self):
        from app.api.v1.endpoints.training import (
            _requirement_target,
            _requirement_target_unit,
        )

        assert _requirement_target(_req(60)) == 60
        assert _requirement_target_unit(_req(60)) == "percent_of_sessions"

    def test_a_caller_that_did_not_load_the_sessions_fails_loudly(self):
        with pytest.raises(ValueError, match="load_held_sessions"):
            evaluate_member_requirement_detail(_req(), [], TODAY)
        with pytest.raises(ValueError, match="load_held_sessions"):
            TrainingService.evaluate_requirement_detail(_req(), [], TODAY)


# ---------------------------------------------------------------------------
# Against real tables
# ---------------------------------------------------------------------------


async def _org(db, tz="America/New_York"):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Attendance Test Department",
        slug=f"attend-{uuid.uuid4().hex[:8]}",
        timezone=tz,
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org):
    handle = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@attend.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def _requirement(db, org, requirement_type=RequirementType.SESSION_ATTENDANCE):
    requirement = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Drills {uuid.uuid4().hex[:6]}",
        requirement_type=requirement_type,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ANNUAL,
        required_attendance_pct=50,
        required_hours=10,
    )
    db.add(requirement)
    await db.flush()
    return requirement


async def _drill(db, org, start, *, finalized=True, cancelled=False, link=None):
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Company Drill",
        event_type=EventType.TRAINING,
        start_datetime=start,
        end_datetime=start.replace(hour=(start.hour + 2) % 24),
        is_cancelled=cancelled,
    )
    db.add(event)
    await db.flush()
    session = TrainingSession(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        event_id=event.id,
        course_name="Company Drill",
        training_type=TrainingType.CONTINUING_EDUCATION,
        credit_hours=2,
        is_finalized=finalized,
    )
    db.add(session)
    await db.flush()
    for requirement in link or []:
        db.add(
            TrainingSessionRequirement(
                organization_id=org.id,
                session_id=session.id,
                requirement_id=requirement.id,
            )
        )
    await db.flush()
    return session


async def _record(db, org, user, session, completion_date):
    record = TrainingRecord(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        source_event_id=session.event_id,
        course_name="Company Drill",
        training_type=TrainingType.CONTINUING_EDUCATION,
        completion_date=completion_date,
        hours_completed=2,
        status=TrainingStatus.COMPLETED,
    )
    db.add(record)
    await db.flush()
    return record


def _utc(y, m, d, h):
    return datetime(y, m, d, h, tzinfo=timezone.utc)


@pytest.mark.integration
class TestWhatCountsAsHeld:
    async def test_finalized_uncancelled_sessions_on_the_local_calendar(
        self, db_session
    ):
        org = await _org(db_session)
        req = await _requirement(db_session, org)
        # 01:00 UTC on 5 March is the evening of 4 March in New York.
        evening = await _drill(db_session, org, _utc(2026, 3, 5, 1), link=[req])
        await _drill(db_session, org, _utc(2026, 4, 2, 23), finalized=False, link=[req])
        await _drill(db_session, org, _utc(2026, 5, 7, 23), cancelled=True, link=[req])
        await _drill(db_session, org, _utc(2026, 6, 4, 23))  # optional: unlinked

        held = await load_held_sessions(db_session, org.id, [req])

        assert held == {req.id: [HeldSession(evening.event_id, date(2026, 3, 4))]}

    async def test_another_organizations_links_are_not_read(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        req = await _requirement(db_session, org)
        foreign = await _drill(db_session, other, _utc(2026, 3, 5, 23))
        db_session.add(
            TrainingSessionRequirement(
                organization_id=other.id,
                session_id=foreign.id,
                requirement_id=req.id,
            )
        )
        await db_session.flush()

        assert await load_held_sessions(db_session, org.id, [req]) == {req.id: []}

    async def test_other_requirement_types_load_nothing(self, db_session):
        org = await _org(db_session)
        hours = await _requirement(db_session, org, RequirementType.HOURS)
        assert await load_held_sessions(db_session, org.id, [hours]) == {}


@pytest.mark.integration
class TestGradingFromTheDatabase:
    async def test_the_records_load_and_grade(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        req = await _requirement(db_session, org)
        first = await _drill(db_session, org, _utc(2026, 2, 19, 23), link=[req])
        await _drill(db_session, org, _utc(2026, 3, 19, 23), link=[req])
        await _drill(db_session, org, _utc(2026, 4, 16, 23), link=[req])
        await _record(db_session, org, member, first, date(2026, 2, 19))

        records = await load_graded_records(
            db_session, org.id, [member.id], [req], TODAY, True
        )
        held = await load_held_sessions(db_session, org.id, [req])
        ev = evaluate_member_requirement_detail(req, records, TODAY, held_sessions=held)

        # 50% of three is two; one attended.
        assert ev.status == "in_progress"
        assert (ev.progress_current, ev.progress_required) == (1, 2)

    async def test_a_drill_record_loads_even_when_misdated(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        req = await _requirement(db_session, org)
        drill = await _drill(db_session, org, _utc(2026, 2, 19, 23), link=[req])
        # A record whose date drifted outside the window is still the
        # member's attendance at a linked session, read by event.
        await _record(db_session, org, member, drill, date(2025, 6, 1))

        records = await load_graded_records(
            db_session, org.id, [member.id], [req], TODAY, True
        )

        assert [str(r.source_event_id) for r in records] == [drill.event_id]

    async def test_the_progress_check_projects_the_same_answer(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        req = await _requirement(db_session, org)
        first = await _drill(db_session, org, _utc(2026, 2, 19, 23), link=[req])
        await _drill(db_session, org, _utc(2026, 3, 19, 23), link=[req])
        await _record(db_session, org, member, first, date(2026, 2, 19))

        progress = await TrainingService(db_session).check_requirement_progress(
            member.id, req.id, org.id, today=TODAY
        )

        # 50% of two is one, and one was attended.
        assert progress.is_complete
        assert (progress.completed_hours, progress.required_hours) == (1, 1)
        assert progress.due_date == date(2026, 12, 31)


@pytest.mark.integration
class TestLinkingSessions:
    async def test_links_replace_the_whole_set(self, db_session):
        org = await _org(db_session)
        active, senior = await _requirement(db_session, org), await _requirement(
            db_session, org
        )
        drill = await _drill(db_session, org, _utc(2026, 2, 19, 23), link=[active])
        service = TrainingSessionService(db_session)

        session, error = await service.set_attendance_requirements(
            drill.id, [str(senior.id), str(senior.id)], org.id
        )

        assert error is None
        assert session is not None
        assert await service.attendance_requirement_ids([drill.id]) == {
            drill.id: [senior.id]
        }

    async def test_an_empty_set_makes_the_session_optional(self, db_session):
        org = await _org(db_session)
        req = await _requirement(db_session, org)
        drill = await _drill(db_session, org, _utc(2026, 2, 19, 23), link=[req])
        service = TrainingSessionService(db_session)

        await service.set_attendance_requirements(drill.id, [], org.id)

        assert await service.attendance_requirement_ids([drill.id]) == {drill.id: []}

    async def test_a_requirement_of_another_type_is_refused(self, db_session):
        org = await _org(db_session)
        hours = await _requirement(db_session, org, RequirementType.HOURS)
        drill = await _drill(db_session, org, _utc(2026, 2, 19, 23))

        session, error = await TrainingSessionService(
            db_session
        ).set_attendance_requirements(drill.id, [hours.id], org.id)

        assert session is None
        assert error == "Invalid attendance requirement"

    async def test_another_organizations_requirement_is_refused(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        foreign = await _requirement(db_session, other)
        drill = await _drill(db_session, org, _utc(2026, 2, 19, 23))

        _, error = await TrainingSessionService(db_session).set_attendance_requirements(
            drill.id, [foreign.id], org.id
        )

        assert error == "Invalid attendance requirement"
        links = await db_session.execute(
            select(TrainingSessionRequirement).where(
                TrainingSessionRequirement.session_id == drill.id
            )
        )
        assert links.scalars().all() == []

    async def test_another_organizations_session_is_not_found(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        req = await _requirement(db_session, org)
        foreign = await _drill(db_session, other, _utc(2026, 2, 19, 23))

        _, error = await TrainingSessionService(db_session).set_attendance_requirements(
            foreign.id, [req.id], org.id
        )

        assert error == "Training session not found"


@pytest.mark.integration
class TestTheCountsTowardAttendanceFlag:
    async def test_only_events_with_a_linked_session_are_flagged(self, db_session):
        org = await _org(db_session)
        req = await _requirement(db_session, org)
        linked = await _drill(db_session, org, _utc(2026, 2, 19, 23), link=[req])
        optional = await _drill(db_session, org, _utc(2026, 3, 19, 23))

        flagged = await TrainingSessionService(
            db_session
        ).events_counting_toward_attendance(
            [linked.event_id, optional.event_id], org.id
        )

        assert flagged == {linked.event_id}

    async def test_another_organizations_events_are_not_flagged(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        req = await _requirement(db_session, other)
        foreign = await _drill(db_session, other, _utc(2026, 2, 19, 23), link=[req])

        flagged = await TrainingSessionService(
            db_session
        ).events_counting_toward_attendance([foreign.event_id], org.id)

        assert flagged == set()
