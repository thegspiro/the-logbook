"""A COURSES requirement names the courses its count is made of.

The requirement card read "0/4" and nothing said which four courses were
meant. ``course_checklist`` lists them, ticked by exactly the test the count
uses, and names a course only when it belongs to the member's organization.
"""

import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.api.v1.endpoints.training_module_config import get_my_training_summary
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
from app.models.user import User, UserStatus
from app.services.training_requirement_courses import (
    course_checklist_entries,
    load_required_course_catalog,
)
from app.services.training_service import TrainingService
from tests.test_training_compliance import _make_record, _make_requirement

CATALOG = {"c1": ("Hazmat Awareness", "HM-1"), "c2": ("Ground Ladders", None)}


@pytest.mark.unit
class TestCourseChecklistEntries:
    def test_lists_every_required_course_in_order_with_its_latest_completion(self):
        records = [
            SimpleNamespace(course_id="c2", completion_date=date(2026, 2, 1)),
            SimpleNamespace(course_id="c2", completion_date=date(2026, 5, 9)),
            SimpleNamespace(course_id=None, completion_date=date(2026, 5, 9)),
        ]

        entries = course_checklist_entries(["c1", "c2"], records, CATALOG)

        assert entries == [
            {
                "course_id": "c1",
                "name": "Hazmat Awareness",
                "code": "HM-1",
                "completed": False,
                "completed_on": None,
            },
            {
                "course_id": "c2",
                "name": "Ground Ladders",
                "code": None,
                "completed": True,
                "completed_on": "2026-05-09",
            },
        ]

    def test_an_id_outside_the_catalog_is_listed_without_a_name(self):
        entries = course_checklist_entries(["gone"], [], CATALOG)

        assert entries == [
            {
                "course_id": "gone",
                "name": None,
                "code": None,
                "completed": False,
                "completed_on": None,
            }
        ]

    def test_a_record_without_a_date_still_ticks_the_course_it_counts_for(self):
        records = [SimpleNamespace(course_id="c1", completion_date=None)]

        [entry] = course_checklist_entries(["c1"], records, CATALOG)

        assert entry["completed"] is True
        assert entry["completed_on"] is None


@pytest.mark.unit
class TestEvaluateRequirementDetail:
    TODAY = date(2026, 6, 30)

    def _courses_requirement(self):
        return _make_requirement(
            requirement_type=SimpleNamespace(value="courses"),
            required_courses=["c1", "c2"],
            required_hours=None,
        )

    def test_the_ticked_courses_add_up_to_the_count(self):
        records = [
            _make_record(id="r1", course_id="c2", completion_date=date(2026, 4, 2)),
            # Outside the annual window: neither counted nor ticked.
            _make_record(id="r2", course_id="c1", completion_date=date(2025, 4, 2)),
        ]

        detail = TrainingService.evaluate_requirement_detail(
            self._courses_requirement(), records, self.TODAY, course_catalog=CATALOG
        )

        assert detail["completed_hours"] == 1
        assert detail["required_hours"] == 2
        assert [(c["name"], c["completed"]) for c in detail["course_checklist"]] == [
            ("Hazmat Awareness", False),
            ("Ground Ladders", True),
        ]

    def test_null_without_a_catalog_and_for_other_requirement_types(self):
        without = TrainingService.evaluate_requirement_detail(
            self._courses_requirement(), [], self.TODAY
        )
        hours = TrainingService.evaluate_requirement_detail(
            _make_requirement(required_hours=4.0),
            [],
            self.TODAY,
            course_catalog=CATALOG,
        )

        assert without["course_checklist"] is None
        assert hours["course_checklist"] is None


async def _course(db_session, org_id, name) -> TrainingCourse:
    course = TrainingCourse(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        code=name[:3].upper(),
        training_type=TrainingType.CONTINUING_EDUCATION,
    )
    db_session.add(course)
    await db_session.flush()
    return course


async def _other_org(db_session) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"other-{org_id[:8]}"},
    )
    return org_id


@pytest.mark.integration
class TestMyTrainingCourseChecklist:
    async def test_the_member_sees_which_courses_the_requirement_names(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        other_org = await _other_org(db_session)
        done = await _course(db_session, org_id, "Hazmat Awareness")
        pending = await _course(db_session, org_id, "Ground Ladders")
        foreign = await _course(db_session, other_org, "Other Dept Secret Course")

        member = User(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            username=f"m{uuid.uuid4().hex[:10]}",
            email=f"{uuid.uuid4().hex[:8]}@dept.test",
            first_name="Pat",
            last_name="Member",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        db_session.add(member)
        await db_session.flush()
        db_session.add(
            TrainingRequirement(
                id=str(uuid.uuid4()),
                organization_id=org_id,
                name="Annual Operations Training",
                requirement_type=RequirementType.COURSES,
                required_courses=[done.id, pending.id, foreign.id],
                frequency=RequirementFrequency.ANNUAL,
                due_date_type=DueDateType.CALENDAR_PERIOD,
                active=True,
                applies_to_all=True,
            )
        )
        db_session.add(
            TrainingRecord(
                id=str(uuid.uuid4()),
                organization_id=org_id,
                user_id=member.id,
                course_id=done.id,
                course_name="Hazmat Awareness",
                training_type=TrainingType.CONTINUING_EDUCATION,
                completion_date=date.today(),
                hours_completed=2,
                status=TrainingStatus.COMPLETED,
            )
        )
        await db_session.flush()

        summary = await get_my_training_summary(db=db_session, current_user=member)

        [detail] = [
            r
            for r in summary["requirements_detail"]
            if r["name"] == "Annual Operations Training"
        ]
        assert detail["completed_hours"] == 1
        assert [
            (c["course_id"], c["name"], c["completed"])
            for c in detail["course_checklist"]
        ] == [
            (done.id, "Hazmat Awareness", True),
            (pending.id, "Ground Ladders", False),
            # Another department's course id: listed, never named.
            (foreign.id, None, False),
        ]
        assert detail["course_checklist"][0]["completed_on"] == (
            date.today().isoformat()
        )

    async def test_the_catalog_loader_reads_only_the_callers_organization(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        other_org = await _other_org(db_session)
        mine = await _course(db_session, org_id, "Hazmat Awareness")
        theirs = await _course(db_session, other_org, "Other Dept Secret Course")
        req = SimpleNamespace(
            requirement_type=RequirementType.COURSES,
            required_courses=[mine.id, theirs.id],
        )

        catalog = await load_required_course_catalog(db_session, org_id, [req])

        assert catalog == {mine.id: ("Hazmat Awareness", "HAZ")}
