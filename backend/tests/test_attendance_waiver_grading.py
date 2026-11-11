"""An approved session waiver request excuses its session, and nothing else.

Owner decision 2 (2026-11-10): an approved request excuses the session from
both the attended and the held counts, a member who came anyway is still
credited, and it covers every attendance requirement the session counts
toward, including one linked after the approval. It is matched on the event,
never on the day, so:

  * another session held the same day stays charged;
  * no month of an hours, shifts or calls requirement is pro-rated by it;
  * the missed-mandatory list drops that event and no other.

Shown on the rule (``tally_session_attendance``), on a real grader with the
waivers its loaders return (``evaluate_member_requirement_detail``), on the
events list, on the compliance exports and on the evaluation figure.
"""

import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from app.models.attendance_waiver import (
    AttendanceWaiverRequest,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.event import EventRSVP
from app.models.training import (
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingSessionRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import LeaveType, MemberLeaveOfAbsence
from app.services.evaluation_data_service import Coverage, EvaluationDataService
from app.services.event_service import EventService
from app.services.training_compliance import (
    HeldSession,
    evaluate_member_requirement_detail,
    load_held_sessions,
    monthly_hours,
    tally_session_attendance,
)
from app.services.training_enhancement_service import ReportExportService
from app.services.training_waiver_service import (
    SOURCE_LEAVE,
    SOURCE_SESSION_EXCUSAL,
    WaiverPeriod,
    adjust_required,
    excused_month_reasons,
    fetch_org_waivers,
    fetch_user_waivers,
    month_waivers,
)
from tests.waiver_request_support import (
    load,
    make_member,
    make_org,
    make_requirement,
    make_session,
    uid,
    utc,
)

DAY = date(2026, 3, 4)
SESSION_ATTENDANCE_SOURCE = "training.session_attendance_pct"
TODAY = date(2026, 11, 4)


def _req(req_id="req-a", **kw):
    fields = dict(
        id=req_id,
        name="Company drills",
        requirement_type=RequirementType.SESSION_ATTENDANCE,
        frequency=RequirementFrequency.ANNUAL,
        required_attendance_pct=100.0,
        required_hours=None,
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


def _excusal(event_id, day=DAY):
    return WaiverPeriod(
        day,
        day,
        requirement_ids=None,
        source=SOURCE_SESSION_EXCUSAL,
        event_id=event_id,
    )


def _attended(*event_ids):
    return [
        SimpleNamespace(
            status=TrainingStatus.COMPLETED,
            source_event_id=event_id,
            completion_date=DAY,
            expiration_date=None,
            course_id=None,
            course_name="Drill",
            training_type=TrainingType.CONTINUING_EDUCATION,
            hours_completed=2,
            certification_number=None,
            category_id=None,
        )
        for event_id in event_ids
    ]


MORNING = HeldSession("ev-morning", DAY)
EVENING = HeldSession("ev-evening", DAY)


@pytest.mark.unit
class TestTheRule:
    def test_only_the_named_session_is_excused(self):
        tally = tally_session_attendance(
            _req(), [], [MORNING, EVENING], TODAY, waivers=[_excusal("ev-morning")]
        )
        # The evening drill the same day is still owed.
        assert (tally.held, tally.charged, tally.needed) == (2, 1, 1)
        assert not tally.met

    def test_it_covers_every_requirement_the_session_counts_toward(self):
        """Matched on the event, so a requirement linked after the approval
        is covered as well; no requirement id is stored to go stale."""
        for req_id in ("req-a", "req-linked-later"):
            tally = tally_session_attendance(
                _req(req_id), [], [MORNING], TODAY, waivers=[_excusal("ev-morning")]
            )
            assert (tally.held, tally.charged) == (1, 0)

    def test_attending_anyway_is_credited(self):
        tally = tally_session_attendance(
            _req(),
            _attended("ev-morning"),
            [MORNING, EVENING],
            TODAY,
            waivers=[_excusal("ev-morning")],
        )
        assert (tally.attended, tally.charged, tally.held) == (1, 2, 2)

    def test_an_excusal_with_no_event_excuses_nothing(self):
        tally = tally_session_attendance(
            _req(), [], [MORNING], TODAY, waivers=[_excusal(None)]
        )
        assert tally.charged == 1

    def test_a_leave_still_excuses_the_whole_day(self):
        leave = WaiverPeriod(DAY, DAY, source=SOURCE_LEAVE)
        tally = tally_session_attendance(
            _req(), [], [MORNING, EVENING], TODAY, waivers=[leave]
        )
        assert tally.charged == 0


@pytest.mark.unit
class TestNoMonthIsExcused:
    def test_month_waivers_drops_it(self):
        assert (
            month_waivers([_excusal("ev")], date(2026, 1, 1), date(2026, 12, 31)) == {}
        )

    def test_an_hours_target_is_not_pro_rated(self):
        assert adjust_required(
            12, date(2026, 1, 1), date(2026, 12, 31), [_excusal("ev")], "req-hours"
        ) == (12, 0, 12)

    def test_no_month_is_reported_excused(self):
        assert excused_month_reasons(
            [_excusal("ev")], date(2026, 1, 1), date(2026, 12, 31)
        ) == {"leave_months": 0, "waiver_months": 0}
        months = monthly_hours(
            [],
            date(2026, 3, 1),
            date(2026, 3, 31),
            month_waivers([_excusal("ev")], date(2026, 3, 1), date(2026, 3, 31)),
        )
        assert months[0]["waived"] is False

    def test_a_real_hours_grader_keeps_its_target(self):
        hours = _req(
            "req-hours",
            requirement_type=RequirementType.HOURS,
            required_hours=12,
            required_attendance_pct=None,
        )
        ev = evaluate_member_requirement_detail(
            hours, [], TODAY, waivers=[_excusal("ev")]
        )
        assert (ev.progress_required, ev.base_required, ev.waived_months) == (
            12,
            12,
            0,
        )


# ---------------------------------------------------------------------------
# From the database
# ---------------------------------------------------------------------------


def _leave(org_id, user_id) -> MemberLeaveOfAbsence:
    """A leave in another year, so it excuses nothing these tests grade."""
    return MemberLeaveOfAbsence(
        id=uid(),
        organization_id=org_id,
        user_id=user_id,
        leave_type=LeaveType.MEDICAL,
        start_date=date(2025, 1, 1),
        end_date=date(2025, 2, 1),
        active=True,
    )


async def _request(db, org_id, user_id, event_id, status, day=DAY, **extra):
    request = AttendanceWaiverRequest(
        id=uid(),
        organization_id=org_id,
        workflow=AttendanceWaiverWorkflow.TRAINING_SESSION,
        user_id=user_id,
        event_id=event_id,
        event_title_snapshot="Company Drill",
        event_start_snapshot=datetime(
            day.year, day.month, day.day, 23, tzinfo=timezone.utc
        ),
        session_date=day,
        status=status,
        submitted_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
        **extra,
    )
    db.add(request)
    await db.flush()
    return request


@pytest.mark.integration
class TestTheLoaders:
    async def test_only_approved_requests_reach_grading(self, db_session):
        org = await make_org(db_session)
        member = await make_member(db_session, org, "Sam")
        drills = [
            await make_session(db_session, org, utc(2026, 3, 4, 14 + n))
            for n in range(5)
        ]
        await _request(
            db_session, org, member, drills[0], AttendanceWaiverStatus.APPROVED
        )
        await _request(
            db_session,
            org,
            member,
            drills[1],
            AttendanceWaiverStatus.APPROVED,
            chief_override=True,
        )
        for drill, status in zip(
            drills[2:],
            (
                AttendanceWaiverStatus.PENDING,
                AttendanceWaiverStatus.DENIED,
                AttendanceWaiverStatus.WITHDRAWN,
            ),
        ):
            await _request(db_session, org, member, drill, status)
        # Approved, but its event is gone: nothing left to excuse.
        await _request(db_session, org, member, None, AttendanceWaiverStatus.APPROVED)

        periods = await fetch_user_waivers(db_session, org, member)
        excused = sorted(
            p.event_id for p in periods if p.source == SOURCE_SESSION_EXCUSAL
        )
        assert excused == sorted(drills[:2])
        assert all(
            (p.start_date, p.end_date, p.requirement_ids) == (DAY, DAY, None)
            for p in periods
        )
        by_user = await fetch_org_waivers(db_session, org)
        assert sorted(p.event_id for p in by_user[member]) == sorted(drills[:2])

    # The early return above is taken only when nobody has a leave or a
    # waiver; any department with one on file takes the merge below, for
    # every member, so the excusal has to survive that path too.

    async def test_an_excusal_survives_the_members_own_leave(self, db_session):
        org = await make_org(db_session)
        member = await make_member(db_session, org, "Sam")
        drill = await make_session(db_session, org, utc(2026, 3, 4, 23))
        await _request(db_session, org, member, drill, AttendanceWaiverStatus.APPROVED)
        db_session.add(_leave(org, member))
        await db_session.flush()

        periods = await fetch_user_waivers(db_session, org, member)

        assert sorted((p.source, p.event_id) for p in periods) == [
            (SOURCE_LEAVE, None),
            (SOURCE_SESSION_EXCUSAL, drill),
        ]

    async def test_an_excusal_survives_someone_elses_leave(self, db_session):
        org = await make_org(db_session)
        member = await make_member(db_session, org, "Sam")
        on_leave = await make_member(db_session, org, "Lee")
        drill = await make_session(db_session, org, utc(2026, 3, 4, 23))
        await _request(db_session, org, member, drill, AttendanceWaiverStatus.APPROVED)
        db_session.add(_leave(org, on_leave))
        await db_session.flush()

        by_user = await fetch_org_waivers(db_session, org)

        assert [(p.source, p.event_id) for p in by_user[member]] == [
            (SOURCE_SESSION_EXCUSAL, drill)
        ]
        assert [p.source for p in by_user[on_leave]] == [SOURCE_LEAVE]

    async def test_another_departments_requests_are_not_read(self, db_session):
        org, other = await make_org(db_session), await make_org(db_session)
        member = await make_member(db_session, org, "Sam")
        drill = await make_session(db_session, org, utc(2026, 3, 4, 23))
        await _request(db_session, org, member, drill, AttendanceWaiverStatus.APPROVED)
        assert await fetch_user_waivers(db_session, other, member) == []
        assert await fetch_org_waivers(db_session, other) == {}


@pytest.mark.integration
class TestARealGrader:
    async def test_one_of_two_drills_that_day_is_excused(self, db_session):
        org = await make_org(db_session, tz="UTC")
        member = await load(db_session, await make_member(db_session, org, "Sam"))
        req = await make_requirement(db_session, org, required_attendance_pct=100)
        morning = await make_session(
            db_session, org, utc(2026, 3, 4, 9), link=[req], finalized=True
        )
        await make_session(
            db_session, org, utc(2026, 3, 4, 18), link=[req], finalized=True
        )
        await _request(
            db_session, org, member.id, morning, AttendanceWaiverStatus.APPROVED
        )

        waivers = await fetch_user_waivers(db_session, org, member.id)
        held = await load_held_sessions(db_session, org, [req])
        ev = evaluate_member_requirement_detail(
            req, [], TODAY, waivers=waivers, held_sessions=held
        )
        # 100% of the one charged drill; it would be both without the excusal.
        assert (ev.progress_current, ev.progress_required, ev.base_required) == (
            0,
            1,
            2,
        )
        assert ev.status != "completed"

        tally = tally_session_attendance(
            req, [], held[str(req.id)], TODAY, waivers=waivers
        )
        assert (tally.held, tally.charged) == (2, 1)

    async def test_a_requirement_linked_after_approval_is_covered(self, db_session):
        org = await make_org(db_session, tz="UTC")
        member = await make_member(db_session, org, "Sam")
        first = await make_requirement(db_session, org)
        later = await make_requirement(db_session, org, required_attendance_pct=100)
        drill = await make_session(
            db_session, org, utc(2026, 3, 4, 9), link=[first], finalized=True
        )
        await _request(db_session, org, member, drill, AttendanceWaiverStatus.APPROVED)
        session_id = (
            await db_session.execute(
                text("SELECT id FROM training_sessions WHERE event_id = :e"),
                {"e": drill},
            )
        ).scalar_one()
        db_session.add(
            TrainingSessionRequirement(
                organization_id=org, session_id=session_id, requirement_id=later.id
            )
        )
        await db_session.flush()

        waivers = await fetch_user_waivers(db_session, org, member)
        held = await load_held_sessions(db_session, org, [later])
        tally = tally_session_attendance(
            later, [], held[str(later.id)], TODAY, waivers=waivers
        )
        assert (tally.held, tally.charged) == (1, 0)

    async def test_an_hours_requirement_is_not_pro_rated(self, db_session):
        org = await make_org(db_session, tz="UTC")
        member = await make_member(db_session, org, "Sam")
        hours = await make_requirement(
            db_session,
            org,
            requirement_type=RequirementType.HOURS,
            required_hours=12,
            required_attendance_pct=None,
        )
        drill = await make_session(db_session, org, utc(2026, 3, 4, 9))
        await _request(db_session, org, member, drill, AttendanceWaiverStatus.APPROVED)

        waivers = await fetch_user_waivers(db_session, org, member)
        ev = evaluate_member_requirement_detail(hours, [], TODAY, waivers=waivers)
        assert (ev.progress_required, ev.waived_months) == (12, 0)


@pytest.mark.integration
class TestTheEvaluationFigure:
    """``training.session_attendance_pct`` on a member evaluation reads the
    same excusals: the excused session drops out of held, another session that
    day stays, and a member who came anyway is credited with both."""

    @pytest.mark.parametrize(
        ("came_anyway", "figure"),
        [
            (False, {"available": True, "value": 0.0, "attended": 0, "held": 1}),
            (True, {"available": True, "value": 50.0, "attended": 1, "held": 2}),
        ],
        ids=["missed", "came-anyway"],
    )
    async def test_only_the_excused_session_drops_out(
        self, db_session, came_anyway, figure
    ):
        org = await make_org(db_session, tz="UTC")
        member = await load(db_session, await make_member(db_session, org, "Sam"))
        morning = await make_session(db_session, org, utc(2026, 3, 4, 9))
        await make_session(db_session, org, utc(2026, 3, 4, 18))
        await _request(
            db_session, org, member.id, morning, AttendanceWaiverStatus.APPROVED
        )
        if came_anyway:
            db_session.add(
                EventRSVP(
                    organization_id=org,
                    event_id=morning,
                    user_id=member.id,
                    checked_in=True,
                )
            )
            await db_session.flush()

        values = await EvaluationDataService(db_session).compute(
            org,
            member,
            Coverage(start=date(2026, 3, 1), end=date(2026, 3, 31), excluded=()),
            [SESSION_ATTENDANCE_SOURCE],
            ZoneInfo("UTC"),
        )

        assert values[SESSION_ATTENDANCE_SOURCE] == figure


@pytest.mark.integration
class TestTheMissedList:
    async def test_an_excused_event_is_not_missed(self, db_session):
        org = await make_org(db_session, tz="UTC")
        member = await make_member(db_session, org, "Sam")
        now = datetime.now(timezone.utc)
        excused = await make_session(db_session, org, now - timedelta(days=3))
        missed = await make_session(
            db_session, org, now - timedelta(days=3, hours=4), title="Pump Drill"
        )
        await db_session.execute(
            text("UPDATE events SET is_mandatory = 1 WHERE id IN (:a, :b)"),
            {"a": excused, "b": missed},
        )
        await _request(
            db_session,
            org,
            member,
            excused,
            AttendanceWaiverStatus.APPROVED,
            day=(now - timedelta(days=3)).date(),
        )
        # Another member's excusal for the same event excuses only them.
        other = await make_member(db_session, org, "Olive")

        service = EventService(db_session)
        rows = await service.list_missed_mandatory_events(
            organization_id=uuid.UUID(org),
            user_id=uuid.UUID(member),
            since=now - timedelta(days=30),
        )
        assert {str(r["event"].id) for r in rows} == {missed}
        theirs = await service.list_missed_mandatory_events(
            organization_id=uuid.UUID(org),
            user_id=uuid.UUID(other),
            since=now - timedelta(days=30),
        )
        assert {str(r["event"].id) for r in theirs} == {excused, missed}


@pytest.mark.integration
class TestTheExports:
    """The compliance CSV and the forecast grade with the same waivers as the
    screens. They passed none at all before, so an excused session (and a
    leave, a waiver or a Chief's override) still read as owed there: "Not Met"
    in the export for a member the matrix showed as met (Pitfall #29)."""

    async def _department(self, db, excused: bool, leave_elsewhere: bool = False):
        org = await make_org(db, tz="UTC")
        member = await make_member(db, org, "Sam")
        if leave_elsewhere:
            # Takes the loaders past their early return, as any department
            # with one leave on file does for every member.
            db.add(_leave(org, await make_member(db, org, "Lee")))
        # Joined long before the drills, so both are charged to them.
        await db.execute(
            text("UPDATE users SET hire_date = '2020-01-01' WHERE id = :id"),
            {"id": member},
        )
        req = await make_requirement(
            db,
            org,
            name="Drill attendance",
            frequency=RequirementFrequency.ONE_TIME,
            required_attendance_pct=100,
        )
        now = datetime.now(timezone.utc).replace(microsecond=0)
        came = await make_session(
            db, org, now - timedelta(days=10), link=[req], finalized=True
        )
        missed = await make_session(
            db, org, now - timedelta(days=9), link=[req], finalized=True
        )
        db.add(
            TrainingRecord(
                id=uid(),
                organization_id=org,
                user_id=member,
                source_event_id=came,
                course_name="Company Drill",
                training_type=TrainingType.CONTINUING_EDUCATION,
                completion_date=(now - timedelta(days=10)).date(),
                hours_completed=2,
                status=TrainingStatus.COMPLETED,
            )
        )
        await db.flush()
        if excused:
            await _request(
                db,
                org,
                member,
                missed,
                AttendanceWaiverStatus.APPROVED,
                day=(now - timedelta(days=9)).date(),
            )
        return org, member, now

    @pytest.mark.parametrize(("excused", "cell"), [(False, "Not Met"), (True, "Met")])
    async def test_the_compliance_csv(self, db_session, excused, cell):
        org, _, now = await self._department(db_session, excused)
        csv_text = await ReportExportService(db_session).generate_compliance_csv(
            org, start_date=(now - timedelta(days=60)).date()
        )
        header, row = list(csv.reader(io.StringIO(csv_text)))[:2]
        assert row[header.index("Drill attendance (Status)")] == cell

    @pytest.mark.parametrize(("excused", "pct"), [(False, 0.0), (True, 100.0)])
    async def test_the_forecast(self, db_session, excused, pct):
        org, member, _ = await self._department(db_session, excused)
        (forecast,) = await ReportExportService(
            db_session
        ).generate_compliance_forecast(org)
        assert forecast["user_id"] == member
        assert forecast["current_compliance_percentage"] == pct

    async def test_the_forecast_with_a_leave_on_file(self, db_session):
        org, member, _ = await self._department(
            db_session, excused=True, leave_elsewhere=True
        )
        forecasts = await ReportExportService(db_session).generate_compliance_forecast(
            org
        )
        (forecast,) = [f for f in forecasts if f["user_id"] == member]
        assert forecast["current_compliance_percentage"] == 100.0
