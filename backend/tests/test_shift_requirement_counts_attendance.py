"""
A "shifts completed" requirement is counted from shifts worked, everywhere.

The owner's decision (shifts-three-sources): ``ShiftAttendance`` is the
authority for a SHIFTS requirement. The training graders used to count every
completed training record in the window as a shift, the scheduling Shift
Compliance report counted attendance rows (finalized or not), and the program
ledger counted shift reports, so one requirement read three numbers on three
screens. Every grader now takes its count from ``load_credited_shift_dates``:
attendance on the department's own finalized shifts plus counted external
shifts, inside the requirement's compliance window.

The department below is built so each member reads differently under the old
sources and identically under the new one:

- ``records``  — three completed training records, no shifts. Was "met" on
  every training screen; now 0 of 2.
- ``worked``   — two finalized shifts this year, one last year. Was 0 on the
  training screens; now 2 of 2.
- ``pending``  — one finalized shift, one not yet finalized, and attendance on
  another department's shift. Was 2 on the Shift Compliance report; now 1.
- ``external`` — one finalized shift and one counted external shift, plus a
  rejected one. Now 2 of 2.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Dict

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training as training_endpoints
from app.api.v1.endpoints.training_module_config import get_my_training_summary
from app.models.external_shift_hours import ExternalShiftHours
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    Shift,
    ShiftAttendance,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.competency_matrix_service import CompetencyMatrixService
from app.services.compliance_officer_service import AnnualComplianceReportService
from app.services.scheduling_service import SchedulingService
from app.services.training_compliance import (
    compute_org_compliance_tally,
    counts_shift_attendance,
    evaluate_member_requirement_detail,
    load_credited_shift_dates,
)
from app.services.training_service import TrainingService
from app.utils.org_timezone import resolve_org_today

# The expected count of credited shifts, and whether that meets a target of 2.
EXPECTED = {"records": 0, "worked": 2, "pending": 1, "external": 2}
MET = {name: count >= 2 for name, count in EXPECTED.items()}


def _uid() -> str:
    return str(uuid.uuid4())


@dataclass
class Department:
    org: Organization
    members: Dict[str, User]
    requirement: TrainingRequirement
    today: date


async def _org(db, name: str) -> Organization:
    org = Organization(
        id=_uid(),
        name=name,
        slug=f"shift-source-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, name: str) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=_uid(),
        organization_id=org.id,
        username=f"{name}-{handle}",
        email=f"{handle}@shift-source.test",
        first_name=name,
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        rank="firefighter",
    )
    db.add(user)
    await db.flush()
    await db.execute(
        select(User)
        .options(selectinload(User.positions), selectinload(User.roles))
        .where(User.id == user.id)
        .execution_options(populate_existing=True)
    )
    return user


async def _shift(db, org, on: date, finalized: bool, *attendees: User):
    shift = Shift(
        id=_uid(),
        organization_id=org.id,
        shift_date=on,
        start_time=datetime(on.year, on.month, on.day, 7, tzinfo=timezone.utc),
        is_finalized=finalized,
    )
    db.add(shift)
    await db.flush()
    for user in attendees:
        db.add(
            ShiftAttendance(
                id=_uid(), shift_id=shift.id, user_id=user.id, duration_minutes=720
            )
        )
    await db.flush()


def _external(org, user, on: date, status: str) -> ExternalShiftHours:
    return ExternalShiftHours(
        id=_uid(),
        organization_id=org.id,
        user_id=user.id,
        shift_date=on,
        duration_minutes=600,
        agency_name="Neighbouring FD",
        apparatus_name="Engine 1",
        status=status,
    )


async def _department(db, **requirement_fields) -> Department:
    org = await _org(db, "Shift Source Department")
    other = await _org(db, "Neighbouring Department")
    today = await resolve_org_today(db, org.id)
    members = {name: await _member(db, org, name) for name in EXPECTED}

    for _ in range(3):
        db.add(
            TrainingRecord(
                id=_uid(),
                organization_id=org.id,
                user_id=members["records"].id,
                course_name="Company Drill",
                training_type=TrainingType.CONTINUING_EDUCATION,
                status=TrainingStatus.COMPLETED,
                completion_date=today,
                hours_completed=2.0,
            )
        )
    await db.flush()

    worked, pending, external = (
        members["worked"],
        members["pending"],
        members["external"],
    )
    await _shift(db, org, today, True, worked, pending, external)
    await _shift(db, org, today, True, worked)
    # Last year: outside this year's window.
    await _shift(db, org, date(today.year - 1, 6, 1), True, worked)
    # Not finalized: pending attendance is not credit yet.
    await _shift(db, org, today, False, pending)
    # Another department's finalized shift: never this department's credit.
    await _shift(db, other, today, True, pending)
    db.add(_external(org, external, today, "counted"))
    db.add(_external(org, external, today, "rejected"))
    await db.flush()

    requirement_fields.setdefault("name", "Annual Shifts")
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        requirement_type=RequirementType.SHIFTS,
        required_shifts=2,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        applies_to_all=True,
        active=True,
        **requirement_fields,
    )
    db.add(req)
    await db.flush()
    return Department(org=org, members=members, requirement=req, today=today)


def _by_member(dept: Department, rows: Dict[str, object]) -> Dict[str, object]:
    return {name: rows[user.id] for name, user in dept.members.items()}


@pytest.mark.integration
class TestEveryGraderCountsShiftsWorked:
    async def test_a_new_shifts_requirement_is_counted_from_attendance(
        self, db_session
    ):
        dept = await _department(db_session)
        await db_session.refresh(dept.requirement)
        assert dept.requirement.shift_credited is True
        assert counts_shift_attendance(dept.requirement)

    async def test_the_shared_count(self, db_session):
        dept = await _department(db_session)
        shifts = await load_credited_shift_dates(
            db_session,
            dept.org.id,
            [u.id for u in dept.members.values()],
            [dept.requirement],
            dept.today,
            True,
        )
        counts = {
            name: len(shifts.get(user.id, [])) for name, user in dept.members.items()
        }
        # Bounded to the window: the worked member's shift last year is not
        # even loaded.
        assert counts == EXPECTED

    async def test_compliance_matrix(self, db_session):
        dept = await _department(db_session)
        caller = User(id=_uid(), organization_id=dept.org.id)
        matrix = await training_endpoints.get_compliance_matrix(
            db=db_session, current_user=caller
        )
        cells = _by_member(
            dept,
            {str(row["user_id"]): row["requirements"][0] for row in matrix["members"]},
        )
        assert {n: c["progress_current"] for n, c in cells.items()} == EXPECTED
        assert {n: c["status"] == "completed" for n, c in cells.items()} == MET

    async def test_department_percentage(self, db_session):
        dept = await _department(db_session)
        tally = await compute_org_compliance_tally(db_session, dept.org.id)
        assert tally.graded == len(EXPECTED)
        assert tally.compliant == sum(MET.values())

    async def test_my_training_summary(self, db_session):
        dept = await _department(db_session)
        for name, user in dept.members.items():
            result = await get_my_training_summary(db=db_session, current_user=user)
            [detail] = result["requirements_detail"]
            assert detail["completed_hours"] == EXPECTED[name], name
            assert detail["is_met"] is MET[name], name

    async def test_requirements_progress(self, db_session):
        """``/training/requirements/progress`` and the MCP tool."""
        dept = await _department(db_session)
        service = TrainingService(db_session)
        for name, user in dept.members.items():
            [progress] = await service.get_all_requirements_progress(
                user.id, dept.org.id
            )
            assert progress.completed_hours == EXPECTED[name], name
            assert progress.is_complete is MET[name], name
            # A standalone check loads the member's shifts itself.
            single = await service.check_requirement_progress(
                user.id, dept.requirement.id, dept.org.id
            )
            assert single.completed_hours == EXPECTED[name], name

    async def test_profile_card_and_period_roster(self, db_session):
        dept = await _department(db_session)
        caller = User(id=_uid(), organization_id=dept.org.id)
        roster = await training_endpoints.get_member_period_status(
            start_date=date(dept.today.year, 1, 1),
            end_date=dept.today,
            db=db_session,
            current_user=caller,
        )
        rows = _by_member(dept, {str(r["user_id"]): r for r in roster["members"]})
        for name, user in dept.members.items():
            assert rows[name]["requirements_met"] == int(MET[name]), name
            card = await training_endpoints.get_compliance_summary(
                user_id=uuid.UUID(user.id), db=db_session, current_user=user
            )
            assert card.requirements_met == int(MET[name]), name

    async def test_annual_report(self, db_session):
        dept = await _department(db_session)
        report = await AnnualComplianceReportService(db_session).generate_annual_report(
            dept.org.id, year=dept.today.year
        )
        rows = _by_member(
            dept, {row["user_id"]: row for row in report["member_compliance"]}
        )
        assert {n: r["requirements_met"] == 1 for n, r in rows.items()} == MET
        [analysis] = report["requirement_analysis"]
        assert analysis["members_compliant"] == sum(MET.values())

    async def test_shift_compliance_report(self, db_session):
        dept = await _department(db_session)
        [summary] = await SchedulingService(db_session).get_shift_compliance(
            dept.org.id, dept.today
        )
        rows = _by_member(dept, {m["user_id"]: m for m in summary["members"]})
        assert {n: r["completed_value"] for n, r in rows.items()} == EXPECTED
        assert {n: r["compliant"] for n, r in rows.items()} == MET
        assert summary["compliant_count"] == sum(MET.values())
        # The window it reports is the one it counted.
        assert summary["period_start"] == date(dept.today.year, 1, 1).isoformat()
        assert summary["period_end"] == date(dept.today.year, 12, 31).isoformat()

    async def test_competency_matrix(self, db_session):
        dept = await _department(db_session)
        matrix = await CompetencyMatrixService(db_session).get_competency_matrix(
            dept.org.id
        )
        cells = _by_member(
            dept,
            {
                row["user_id"]: row["statuses"][dept.requirement.id]
                for row in matrix["members"]
            },
        )
        assert {n: c["status"] == "current" for n, c in cells.items()} == MET
        assert cells["records"]["status"] == "not_started"
        assert cells["pending"]["details"] == "1/2 shifts"


@pytest.mark.integration
class TestARequirementNotShiftCredited:
    """An officer who unticks "shift attendance satisfies this requirement"
    keeps it on training records — everywhere, and off the scheduling report."""

    async def test_counts_records_on_the_matrix_and_leaves_the_report(self, db_session):
        dept = await _department(db_session, shift_credited=False)
        caller = User(id=_uid(), organization_id=dept.org.id)
        matrix = await training_endpoints.get_compliance_matrix(
            db=db_session, current_user=caller
        )
        cells = _by_member(
            dept,
            {str(row["user_id"]): row["requirements"][0] for row in matrix["members"]},
        )
        assert cells["records"]["progress_current"] == 3
        assert cells["worked"]["progress_current"] == 0
        assert (
            await SchedulingService(db_session).get_shift_compliance(
                dept.org.id, dept.today
            )
            == []
        )


def _shift_req(**fields):
    defaults = dict(
        id="req-shifts",
        name="Shifts",
        description=None,
        requirement_type=SimpleNamespace(value="shifts"),
        shift_credited=True,
        training_type=None,
        frequency=SimpleNamespace(value="annual"),
        year=None,
        due_date_type=None,
        rolling_period_months=None,
        required_shifts=2,
        recency_days=None,
        include_current_month=None,
        period_start_month=None,
        period_start_day=None,
        period_end_month=None,
        period_end_day=None,
        due_date=None,
        new_member_cutoff_date=None,
        existing_member_deadline=None,
        applies_to_joined_before=None,
    )
    defaults.update(fields)
    return SimpleNamespace(**defaults)


@pytest.mark.unit
class TestTheGraderReadsShiftsNotRecords:
    def test_a_training_record_is_not_a_shift(self):
        req = _shift_req()
        record = SimpleNamespace(
            status=TrainingStatus.COMPLETED,
            completion_date=date(2026, 3, 1),
            training_type=None,
            expiration_date=None,
        )
        ev = evaluate_member_requirement_detail(
            req, [record] * 3, date(2026, 6, 15), shift_dates=[]
        )
        assert ev.progress_current == 0
        assert ev.status == "not_started"

    def test_counts_shifts_inside_the_window_only(self):
        req = _shift_req()
        ev = evaluate_member_requirement_detail(
            req,
            [],
            date(2026, 6, 15),
            shift_dates=[date(2025, 12, 31), date(2026, 2, 1), date(2026, 5, 1)],
        )
        assert ev.progress_current == 2
        assert ev.status == "completed"
        assert ev.completion_date == "2026-05-01"

    def test_a_caller_that_did_not_load_shifts_fails_loudly(self):
        """Zero for everybody would be a plausible number nobody questions."""
        with pytest.raises(ValueError, match="counts shifts worked"):
            evaluate_member_requirement_detail(_shift_req(), [], date(2026, 6, 15))

    def test_my_training_rolling_due_date_anchors_on_the_latest_shift(self):
        req = _shift_req(
            due_date_type=SimpleNamespace(value="rolling"), rolling_period_months=12
        )
        detail = TrainingService.evaluate_requirement_detail(
            req, [], date(2026, 6, 15), shift_dates=[date(2026, 1, 10)]
        )
        assert detail["completed_hours"] == 1
        assert detail["due_date"] == str(date(2026, 1, 10) + timedelta(days=365))
