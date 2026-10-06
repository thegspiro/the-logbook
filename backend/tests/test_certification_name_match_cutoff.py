"""
A certification requirement matches a record by course name only for legacy
records.

``certification_record_matches`` accepted the requirement's name as a
substring of any record's course name, so a "CPR Refresher" event credited a
"CPR" certification. The owner kept that match for records completed on or
before the requirement's ``name_match_until`` (set by migration to the day the
rule changed); later records need a linked course, the training type or the
registry code. Every grader goes through the one matcher, so the matrix, the
dashboard percentage, the annual report and My Training all agree.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training as training_endpoints
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.compliance_officer_service import AnnualComplianceReportService
from app.services.training_compliance import (
    certification_record_matches,
    compute_org_compliance_tally,
)
from app.utils.org_timezone import resolve_org_today

CUTOFF = date(2026, 10, 5)


def _req(**fields):
    values = dict(
        name="CPR",
        required_courses=None,
        training_type=None,
        registry_code=None,
        name_match_until=CUTOFF,
    )
    values.update(fields)
    return SimpleNamespace(**values)


def _rec(**fields):
    values = dict(
        course_id=None,
        course_name="CPR Refresher",
        training_type=TrainingType.CONTINUING_EDUCATION,
        certification_number=None,
        completion_date=CUTOFF,
        created_at=None,
    )
    values.update(fields)
    return SimpleNamespace(**values)


@pytest.mark.unit
class TestTheMatcher:
    def test_a_record_completed_by_the_cutoff_still_matches_by_name(self):
        assert certification_record_matches(_req(), _rec())

    def test_a_record_completed_after_the_cutoff_does_not(self):
        assert not certification_record_matches(
            _req(), _rec(completion_date=CUTOFF + timedelta(days=1))
        )

    def test_a_requirement_with_no_cutoff_never_matches_by_name(self):
        assert not certification_record_matches(
            _req(name_match_until=None), _rec(completion_date=date(2020, 1, 1))
        )

    def test_an_undated_record_is_dated_by_when_it_was_entered(self):
        before = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
        after = datetime(2026, 10, 9, 12, tzinfo=timezone.utc)
        assert certification_record_matches(
            _req(), _rec(completion_date=None, created_at=before)
        )
        assert not certification_record_matches(
            _req(), _rec(completion_date=None, created_at=after)
        )
        assert not certification_record_matches(_req(), _rec(completion_date=None))

    def test_the_other_matches_have_no_cutoff(self):
        late = CUTOFF + timedelta(days=30)
        assert certification_record_matches(
            _req(required_courses=["c-1"]), _rec(course_id="c-1", completion_date=late)
        )
        assert certification_record_matches(
            _req(training_type=TrainingType.CERTIFICATION),
            _rec(training_type=TrainingType.CERTIFICATION, completion_date=late),
        )
        assert certification_record_matches(
            _req(registry_code="BLS"),
            _rec(certification_number="AHA-BLS-1", completion_date=late),
        )


def _uid() -> str:
    return str(uuid.uuid4())


async def _member(db, org, name: str) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=_uid(),
        organization_id=org.id,
        username=f"{name.lower()}-{handle}",
        email=f"{handle}@name-match.test",
        first_name=name,
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == user.id)
        .execution_options(populate_existing=True)
    )
    return user


async def _department(db):
    """A "CPR" certification whose cut-off is ten days ago.

    Legacy holds a "CPR Refresher" record completed before the cut-off;
    Recent one completed after it; Linked a record for the linked CPR course,
    completed after the cut-off under an unrelated name.
    """
    org = Organization(
        id=_uid(),
        name="Name Match Department",
        slug=f"name-match-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    today = await resolve_org_today(db, org.id)
    cutoff = today - timedelta(days=10)

    course = TrainingCourse(
        id=_uid(),
        organization_id=org.id,
        name="Heartsaver",
        code="HS",
        training_type=TrainingType.CERTIFICATION,
    )
    db.add(course)
    await db.flush()
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        name="CPR",
        requirement_type=RequirementType.CERTIFICATION,
        frequency=RequirementFrequency.ONE_TIME,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        active=True,
        applies_to_all=True,
        required_courses=[course.id],
        name_match_until=cutoff,
    )
    db.add(req)

    legacy = await _member(db, org, "Legacy")
    recent = await _member(db, org, "Recent")
    linked = await _member(db, org, "Linked")

    def record(member, completed, **fields):
        fields.setdefault("course_name", "CPR Refresher")
        return TrainingRecord(
            id=_uid(),
            organization_id=org.id,
            user_id=member.id,
            training_type=TrainingType.CONTINUING_EDUCATION,
            status=TrainingStatus.COMPLETED,
            completion_date=completed,
            expiration_date=today + timedelta(days=365),
            hours_completed=4.0,
            **fields,
        )

    db.add_all(
        [
            record(legacy, cutoff - timedelta(days=30)),
            record(recent, cutoff + timedelta(days=1)),
            record(
                linked,
                cutoff + timedelta(days=1),
                course_id=course.id,
                course_name="Heartsaver Class",
            ),
        ]
    )
    await db.flush()
    return org, today, req, legacy, recent, linked


@pytest.mark.integration
class TestEveryGraderAppliesTheCutoff:
    async def test_matrix_dashboard_report_and_my_training_agree(self, db_session):
        org, today, req, legacy, recent, linked = await _department(db_session)
        caller = User(id=_uid(), organization_id=org.id)

        matrix = await training_endpoints.get_compliance_matrix(
            db=db_session, current_user=caller
        )
        cells = {
            str(row["user_id"]): row["requirements"][0]["status"]
            for row in matrix["members"]
        }
        assert cells == {
            legacy.id: "completed",
            recent.id: "not_started",
            linked.id: "completed",
        }

        tally = await compute_org_compliance_tally(db_session, org.id)
        assert (tally.compliant, tally.graded) == (2, 3)

        report = await AnnualComplianceReportService(db_session).generate_annual_report(
            org.id, year=today.year
        )
        statuses = {r["user_id"]: r["status"] for r in report["member_compliance"]}
        assert statuses == {
            legacy.id: "compliant",
            recent.id: "non_compliant",
            linked.id: "compliant",
        }

        for member, met in ((legacy, True), (recent, False), (linked, True)):
            card = await training_endpoints.get_compliance_summary(
                user_id=uuid.UUID(member.id), db=db_session, current_user=member
            )
            assert (card.requirements_met == 1) is met, member.first_name
