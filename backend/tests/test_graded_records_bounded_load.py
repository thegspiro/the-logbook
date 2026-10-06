"""
The department-wide compliance graders load only the records they can read.

``get_compliance_matrix``, ``get_training_dashboard_summary``,
``compute_org_compliance_tally`` and the other callers of
``load_graded_records`` used to load every training record each member ever
had (TR2-4, TR4-2). They now load what ``graded_records_clause`` selects. The
owner's bar for that change was identical results, so these tests grade one
realistic department twice — once through the bounded load, once with the
clause replaced by ``TRUE`` (the old, unbounded load) — and require every
figure to match: each matrix cell's status, progress and as-of, the dashboard
summary, the department percentage, the period roster, the annual report and
the profile card.

The department has requirements of every type, frequency and due-date type
the grader handles, and eight years of records per member: in and out of
every window, expired and active certificates, completed records with no
completion date, records completed after the evaluation date, in-progress,
scheduled, cancelled and failed rows, waivers, grandfathered members, a
membership-scoped requirement and a compliance profile.
"""

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select, true
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training as training_endpoints
from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
    TrainingWaiver,
)
from app.models.user import Organization, User, UserStatus
from app.services import training_compliance
from app.services.compliance_officer_service import AnnualComplianceReportService
from app.services.training_compliance import (
    compute_org_compliance_pct,
    compute_org_compliance_tally,
    evaluate_member_requirement_detail,
    graded_records_clause,
    load_graded_records,
    member_join_date,
)
from app.services.training_waiver_service import fetch_org_waivers
from app.utils.org_timezone import resolve_org_today

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


class _Dept:
    """Ids and rows of the department under test."""

    def __init__(self, org: Organization, today: date):
        self.org = org
        self.today = today
        self.members: list[User] = []
        self.requirements: list[TrainingRequirement] = []
        self.courses: list[str] = []


async def _member(db, dept: _Dept, name: str, **fields) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=_uid(),
        organization_id=dept.org.id,
        username=f"{name.lower()}-{handle}",
        email=f"{handle}@bounded.test",
        first_name=name,
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        **fields,
    )
    db.add(user)
    await db.flush()
    # Warm the lazy relationships the graders read, as the auth dependency
    # does for a real caller.
    await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == user.id)
        .execution_options(populate_existing=True)
    )
    dept.members.append(user)
    return user


async def _req(db, dept: _Dept, name: str, req_type, frequency, **fields):
    fields.setdefault("applies_to_all", True)
    fields.setdefault("due_date_type", DueDateType.CALENDAR_PERIOD)
    req = TrainingRequirement(
        id=_uid(),
        organization_id=dept.org.id,
        name=name,
        requirement_type=req_type,
        frequency=frequency,
        active=True,
        **fields,
    )
    db.add(req)
    await db.flush()
    dept.requirements.append(req)
    return req


def _record(dept: _Dept, user: User, **fields) -> TrainingRecord:
    fields.setdefault("status", TrainingStatus.COMPLETED)
    fields.setdefault("hours_completed", 4.0)
    fields.setdefault("training_type", TrainingType.CONTINUING_EDUCATION)
    fields.setdefault("course_name", "Company Drill")
    return TrainingRecord(
        id=_uid(), organization_id=dept.org.id, user_id=user.id, **fields
    )


async def _build_department(db) -> _Dept:
    org = Organization(
        id=_uid(),
        name="Bounded Load Department",
        slug=f"bounded-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    today = await resolve_org_today(db, org.id)
    dept = _Dept(org, today)

    for code in ("FF1", "HAZ"):
        course = TrainingCourse(
            id=_uid(),
            organization_id=org.id,
            name=f"Course {code}",
            code=code,
            training_type=TrainingType.REFRESHER,
        )
        db.add(course)
        dept.courses.append(course.id)
    await db.flush()

    veteran_hired = today - timedelta(days=3650)
    recruit_hired = today - timedelta(days=100)
    cutoff = today - timedelta(days=365)
    alpha = await _member(db, dept, "Alpha", hire_date=veteran_hired)
    bravo = await _member(db, dept, "Bravo", hire_date=recruit_hired)
    charlie = await _member(
        db, dept, "Charlie", hire_date=veteran_hired, membership_type="administrative"
    )
    delta = await _member(db, dept, "Delta", hire_date=recruit_hired)
    await _member(db, dept, "Echo", hire_date=veteran_hired)  # no records at all
    exempt = await _member(
        db, dept, "Foxtrot", hire_date=veteran_hired, compliance_exempt=True
    )

    hours, cert = RequirementType.HOURS, RequirementType.CERTIFICATION
    annual, one_time = RequirementFrequency.ANNUAL, RequirementFrequency.ONE_TIME
    ce = TrainingType.CONTINUING_EDUCATION
    await _req(
        db, dept, "Annual Hours", hours, annual, required_hours=24, training_type=ce
    )
    await _req(
        db,
        dept,
        "Winter Hours",
        hours,
        annual,
        required_hours=8,
        period_start_month=11,
        period_end_month=1,
    )
    await _req(
        db,
        dept,
        "Quarterly Hours",
        hours,
        RequirementFrequency.QUARTERLY,
        required_hours=6,
    )
    await _req(
        db,
        dept,
        "Monthly Hours",
        hours,
        RequirementFrequency.MONTHLY,
        required_hours=2,
        include_current_month=True,
    )
    biannual = await _req(
        db,
        dept,
        "Biannual Hours",
        hours,
        RequirementFrequency.BIANNUAL,
        required_hours=40,
        training_type=ce,
    )
    await _req(
        db,
        dept,
        "Rolling Hours",
        hours,
        annual,
        required_hours=12,
        due_date_type=DueDateType.ROLLING,
        rolling_period_months=18,
    )
    await _req(
        db,
        dept,
        "Cert Period Hours",
        hours,
        annual,
        required_hours=10,
        due_date_type=DueDateType.CERTIFICATION_PERIOD,
    )
    await _req(db, dept, "Lifetime Hours", hours, one_time, required_hours=100)
    await _req(
        db,
        dept,
        "Past Year Hours",
        hours,
        annual,
        required_hours=4,
        year=today.year - 3,
    )
    await _req(
        db,
        dept,
        "Course Hours",
        hours,
        annual,
        required_hours=4,
        required_courses=[dept.courses[0]],
    )
    # A freshness cutoff that falls after its own window closes.
    await _req(
        db,
        dept,
        "Stale Window Hours",
        hours,
        annual,
        required_hours=4,
        year=today.year - 2,
        recency_days=30,
    )
    await _req(
        db,
        dept,
        "Academy Courses",
        RequirementType.COURSES,
        one_time,
        required_courses=list(dept.courses),
    )
    await _req(
        db,
        dept,
        "Annual Courses",
        RequirementType.COURSES,
        annual,
        required_courses=[dept.courses[1]],
    )
    # Name matching on either side of a legacy cut-off (name_match_until),
    # and not at all on a requirement with none.
    await _req(
        db, dept, "CPR", cert, annual, name_match_until=today - timedelta(days=365)
    )
    await _req(db, dept, "CPR Fresh", cert, one_time, recency_days=400)
    await _req(db, dept, "Hazmat Ops", cert, annual, name_match_until=today)
    await _req(db, dept, "Basic Life Support", cert, annual, registry_code="BLS")
    await _req(
        db,
        dept,
        "Shift Count",
        RequirementType.SHIFTS,
        RequirementFrequency.QUARTERLY,
        required_shifts=2,
        training_type=TrainingType.SPECIALTY,
    )
    await _req(
        db,
        dept,
        "Call Count",
        RequirementType.CALLS,
        annual,
        required_calls=3,
        training_type=TrainingType.ORIENTATION,
    )
    await _req(db, dept, "Skills Check", RequirementType.SKILLS_EVALUATION, annual)
    await _req(
        db,
        dept,
        "Skills Check Lifetime",
        RequirementType.CHECKLIST,
        one_time,
    )
    await _req(
        db,
        dept,
        "Written Test",
        RequirementType.KNOWLEDGE_TEST,
        one_time,
        training_type=TrainingType.SKILLS_PRACTICE,
        recency_days=200,
    )
    admin_only = await _req(
        db,
        dept,
        "Admin Hours",
        hours,
        annual,
        required_hours=6,
        applies_to_all=False,
        required_membership_types=["administrative"],
    )
    await _req(
        db,
        dept,
        "New Standard",
        cert,
        annual,
        new_member_cutoff_date=cutoff,
        existing_member_deadline=today + timedelta(days=60),
    )
    await _req(
        db,
        dept,
        "Old Standard",
        hours,
        annual,
        required_hours=4,
        applies_to_joined_before=cutoff,
    )

    config = ComplianceConfig(
        id=_uid(),
        organization_id=org.id,
        threshold_type="percentage",
        compliant_threshold=80.0,
        at_risk_threshold=50.0,
        include_current_month=False,
    )
    db.add(config)
    await db.flush()
    db.add(
        ComplianceProfile(
            id=_uid(),
            config_id=config.id,
            name="Administrative",
            membership_types=["administrative"],
            required_requirement_ids=[
                admin_only.id,
                biannual.id,
                dept.requirements[0].id,
            ],
            compliant_threshold_override=60.0,
            is_active=True,
            priority=10,
        )
    )
    db.add(
        TrainingWaiver(
            id=_uid(),
            organization_id=org.id,
            user_id=alpha.id,
            start_date=today - timedelta(days=200),
            end_date=today - timedelta(days=100),
        )
    )

    # Eight years of history, varied per member so their standings differ.
    rows: list[TrainingRecord] = []
    for i, member in enumerate((alpha, bravo, charlie, delta, exempt)):
        for step in range(0, 100):
            if (step + i) % (i + 2) == 0:
                continue
            when = today - timedelta(days=29 * step + 3 * i)
            kind = (step + i) % 9
            if kind == 0:
                rows.append(
                    _record(
                        dept,
                        member,
                        completion_date=when,
                        course_name="CPR Renewal",
                        training_type=TrainingType.CERTIFICATION,
                        expiration_date=when + timedelta(days=730),
                        certification_number=f"AHA-BLS-{step}",
                    )
                )
            elif kind == 1:
                rows.append(
                    _record(
                        dept,
                        member,
                        completion_date=when,
                        course_id=dept.courses[step % 2],
                        course_name="Academy Block",
                        training_type=TrainingType.REFRESHER,
                    )
                )
            elif kind == 2:
                rows.append(
                    _record(
                        dept,
                        member,
                        completion_date=when,
                        expiration_date=when + timedelta(days=365),
                    )
                )
            elif kind == 3:
                rows.append(
                    _record(
                        dept,
                        member,
                        status=TrainingStatus.IN_PROGRESS,
                        completion_date=None if step % 2 else when,
                        course_name="Skills Check Station",
                        training_type=TrainingType.SKILLS_PRACTICE,
                    )
                )
            elif kind == 4:
                status = (
                    TrainingStatus.SCHEDULED,
                    TrainingStatus.CANCELLED,
                    TrainingStatus.FAILED,
                )[step % 3]
                rows.append(_record(dept, member, status=status, completion_date=when))
            elif kind == 5:
                rows.append(
                    _record(
                        dept,
                        member,
                        completion_date=None,
                        course_name="CPR Instructor",
                    )
                )
            elif kind == 6:
                rows.append(
                    _record(
                        dept,
                        member,
                        completion_date=when,
                        training_type=TrainingType.SPECIALTY,
                        course_name="Duty Shift",
                    )
                )
            elif kind == 7:
                rows.append(
                    _record(
                        dept,
                        member,
                        completion_date=when,
                        training_type=TrainingType.ORIENTATION,
                        course_name="Call Response",
                    )
                )
            else:
                rows.append(
                    _record(
                        dept,
                        member,
                        completion_date=when,
                        training_type=TrainingType.SKILLS_PRACTICE,
                        course_name="Written Test",
                    )
                )
        # A lapsed certificate, years old: only a full-history load finds it.
        rows.append(
            _record(
                dept,
                member,
                completion_date=today - timedelta(days=1500 + i),
                course_name="Hazmat Ops Awareness",
                training_type=TrainingType.SPECIALTY,
                expiration_date=today - timedelta(days=770),
            )
        )
        # Completed after the evaluation date of an org that stops at last
        # month, and dated in the future outright.
        rows.append(_record(dept, member, completion_date=today))
        rows.append(
            _record(
                dept,
                member,
                completion_date=today + timedelta(days=10),
                course_name="CPR Renewal",
                expiration_date=today + timedelta(days=700),
            )
        )
    # Enough recent hours that the profile's narrower list passes Charlie,
    # graded as of the end of last month (include_current_month=False).
    last_month_end = today.replace(day=1) - timedelta(days=1)
    for days_before in (3, 6, 9):
        rows.append(
            _record(
                dept,
                charlie,
                completion_date=last_month_end - timedelta(days=days_before),
                hours_completed=15.0,
            )
        )
    db.add_all(rows)
    await db.flush()
    return dept


async def _load_full(db, dept: _Dept) -> list[TrainingRecord]:
    result = await db.execute(
        select(TrainingRecord)
        .where(TrainingRecord.organization_id == dept.org.id)
        .order_by(TrainingRecord.id)
    )
    return list(result.scalars().all())


def _unbounded(monkeypatch):
    monkeypatch.setattr(
        training_compliance, "graded_records_clause", lambda *_a, **_k: true()
    )


def _strip_generated(value):
    if isinstance(value, dict):
        return {k: _strip_generated(v) for k, v in value.items() if k != "generated_at"}
    if isinstance(value, list):
        return [_strip_generated(v) for v in value]
    return value


async def _every_figure(db, dept: _Dept) -> dict:
    """Every caller of load_graded_records, run once against the department."""
    caller = User(id=_uid(), organization_id=dept.org.id)
    figures = {
        "matrix": await training_endpoints.get_compliance_matrix(
            db=db, current_user=caller
        ),
        "summary": await training_endpoints.get_training_dashboard_summary(
            expiration_days=365, db=db, current_user=caller
        ),
        "tally": await compute_org_compliance_tally(db, dept.org.id),
        "pct": await compute_org_compliance_pct(db, dept.org.id),
        "roster": await training_endpoints.get_member_period_status(
            start_date=dept.today - timedelta(days=500),
            end_date=dept.today,
            db=db,
            current_user=caller,
        ),
        "annual_report": await AnnualComplianceReportService(db).generate_annual_report(
            dept.org.id, year=dept.today.year
        ),
        "monthly_report": await AnnualComplianceReportService(
            db
        ).generate_monthly_report(
            dept.org.id, year=dept.today.year, month=dept.today.month
        ),
    }
    for member in dept.members:
        card = await training_endpoints.get_compliance_summary(
            user_id=uuid.UUID(member.id), db=db, current_user=member
        )
        figures[f"card-{member.first_name}"] = card.model_dump()
    return _strip_generated(figures)


class TestBoundedLoadGradesIdentically:
    async def test_every_caller_reports_the_same_figures(self, db_session, monkeypatch):
        dept = await _build_department(db_session)

        bounded = await _every_figure(db_session, dept)
        _unbounded(monkeypatch)
        full = await _every_figure(db_session, dept)

        assert bounded == full
        # The fixture has to actually grade something for the comparison to
        # mean anything: a mix of standings and cell statuses.
        cells = {
            cell["status"]
            for row in bounded["matrix"]["members"]
            for cell in row["requirements"]
        }
        assert {
            "completed",
            "expired",
            "in_progress",
            "not_started",
            "catch_up",
        } <= cells
        standings = {row["standing"] for row in bounded["matrix"]["members"]}
        assert len(standings) > 1

    @pytest.mark.parametrize("org_include_current_month", [True, False])
    async def test_every_cell_matches_on_many_evaluation_dates(
        self, db_session, org_include_current_month
    ):
        """Per requirement, through its own clause, on dates chosen to land in
        and between every kind of window (quarter ends, the gap in a
        cross-year window, a year boundary)."""
        dept = await _build_department(db_session)
        full = await _load_full(db_session, dept)
        waivers = await fetch_org_waivers(db_session, dept.org.id)
        year = dept.today.year
        dates = [
            dept.today,
            date(year, 1, 10),
            date(year, 2, 15),
            date(year, 3, 31),
            date(year - 1, 12, 31),
            date(year - 2, 11, 15),
            date(year - 3, 7, 1),
        ]
        member_ids = [m.id for m in dept.members]
        checked = 0
        for today in dates:
            for req in dept.requirements:
                bounded = await load_graded_records(
                    db_session,
                    dept.org.id,
                    member_ids,
                    [req],
                    today,
                    org_include_current_month,
                )
                for member in dept.members:
                    kwargs = {
                        "waivers": waivers.get(member.id, []),
                        "org_include_current_month": org_include_current_month,
                        "join_date": member_join_date(member),
                    }
                    want = evaluate_member_requirement_detail(
                        req,
                        [r for r in full if r.user_id == member.id],
                        today,
                        **kwargs,
                    )
                    got = evaluate_member_requirement_detail(
                        req,
                        [r for r in bounded if r.user_id == member.id],
                        today,
                        **kwargs,
                    )
                    assert got == want, (req.name, member.first_name, today)
                    checked += 1
        assert checked == len(dates) * len(dept.requirements) * len(dept.members)


class TestTheLoadIsActuallyBounded:
    async def test_windowed_requirements_load_only_their_windows(self, db_session):
        dept = await _build_department(db_session)
        windowed = [
            r
            for r in dept.requirements
            if r.name in {"Annual Hours", "Quarterly Hours", "Rolling Hours"}
        ]
        member_ids = [m.id for m in dept.members]
        loaded = await load_graded_records(
            db_session, dept.org.id, member_ids, windowed, dept.today, True
        )
        total = await db_session.scalar(
            select(func.count(TrainingRecord.id)).where(
                TrainingRecord.organization_id == dept.org.id
            )
        )

        earliest = dept.today.replace(day=1)
        for _ in range(18):
            earliest = (earliest - timedelta(days=1)).replace(day=1)
        assert loaded
        assert len(loaded) < total / 3
        for record in loaded:
            assert record.status == TrainingStatus.COMPLETED
            assert record.completion_date is not None
            assert earliest <= record.completion_date <= date(dept.today.year, 12, 31)

        sql = str(
            graded_records_clause(windowed, dept.today, True).compile(
                dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}
            )
        )
        assert "BETWEEN" in sql

    async def test_an_unbounded_requirement_still_skips_unread_statuses(
        self, db_session
    ):
        """A certification with no freshness cutoff needs the member's whole
        completed history, but never a scheduled, cancelled or failed row."""
        dept = await _build_department(db_session)
        member_ids = [m.id for m in dept.members]
        loaded = await load_graded_records(
            db_session,
            dept.org.id,
            member_ids,
            dept.requirements,
            dept.today,
            False,
        )
        full = await _load_full(db_session, dept)
        unread = {
            TrainingStatus.SCHEDULED,
            TrainingStatus.CANCELLED,
            TrainingStatus.FAILED,
        }
        assert any(r.status in unread for r in full)
        assert not any(r.status in unread for r in loaded)
        assert {r.id for r in loaded} == {
            r.id
            for r in full
            if r.status in {TrainingStatus.COMPLETED, TrainingStatus.IN_PROGRESS}
        }

    async def test_no_requirements_load_nothing(self, db_session):
        dept = await _build_department(db_session)
        loaded = await load_graded_records(
            db_session,
            dept.org.id,
            [m.id for m in dept.members],
            [],
            dept.today,
            True,
        )
        assert loaded == []
