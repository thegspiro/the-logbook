"""
CC-2: a cohort's room, with a per-class override, conflict-checked at preview.

The double-booking check existed but nothing set a location, so the warning
could never fire. The preview now takes the cohort's room and the per-class
overrides, resolves each class's room exactly as generation does (wizard pick,
then the syllabus row's own room, then the cohort's), and reports a clash on
the room the class will actually book.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.location import Location
from app.models.training import (
    CourseClass,
    CourseCohortClass,
    TrainingCourse,
    TrainingType,
)
from app.schemas.course_cohort import (
    CohortClassOverride,
    CohortSchedulePreviewRequest,
    CourseCohortCreate,
)
from app.services.course_cohort_service import CourseCohortService

pytestmark = pytest.mark.integration

START = date(2027, 3, 1)


async def _seed(db_session, org_id: str, admin_id: str):
    hall = Location(organization_id=org_id, name="Training Hall")
    tower = Location(organization_id=org_id, name="Burn Tower")
    annex = Location(organization_id=org_id, name="Annex")
    container = TrainingCourse(
        organization_id=org_id,
        name="Recruit School",
        training_type=TrainingType.CERTIFICATION,
    )
    taught = TrainingCourse(
        organization_id=org_id,
        name="SCBA Operations",
        training_type=TrainingType.CERTIFICATION,
    )
    db_session.add_all([hall, tower, annex, container, taught])
    await db_session.flush()

    plain = CourseClass(
        organization_id=org_id,
        course_id=container.id,
        class_course_id=taught.id,
        sequence=1,
        day_offset=0,
        start_time="09:00",
        duration_minutes=180,
    )
    live_fire = CourseClass(
        organization_id=org_id,
        course_id=container.id,
        class_course_id=taught.id,
        sequence=2,
        day_offset=1,
        start_time="09:00",
        duration_minutes=180,
        location_id=tower.id,
    )
    db_session.add_all([plain, live_fire])
    # Something already holds the hall on the first class's morning.
    db_session.add(
        Event(
            organization_id=org_id,
            title="Board Meeting",
            start_datetime=datetime(2027, 3, 1, 9, 30, tzinfo=timezone.utc),
            end_datetime=datetime(2027, 3, 1, 10, 30, tzinfo=timezone.utc),
            location_id=hall.id,
            created_by=admin_id,
        )
    )
    await db_session.flush()
    return hall, tower, annex, container, plain, live_fire


class TestPreviewLocations:
    async def test_cohort_room_is_checked_and_a_syllabus_room_keeps_precedence(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        hall, tower, _, container, plain, live_fire = await _seed(
            db_session, org_id, admin_id
        )

        result = await CourseCohortService(db_session).preview_schedule(
            CohortSchedulePreviewRequest(
                course_id=container.id, start_date=START, location_id=hall.id
            ),
            org_id,
        )

        first, second = result["classes"]
        assert (first["location_id"], first["location_source"]) == (
            hall.id,
            "cohort",
        )
        assert first["location_name"] == "Training Hall"
        assert any("Location already booked" in w for w in first["warnings"])
        assert (second["location_id"], second["location_source"]) == (
            tower.id,
            "syllabus",
        )
        assert not any("Location already booked" in w for w in second["warnings"])

    async def test_a_per_class_override_moves_the_class_out_of_the_clash(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        hall, _, annex, container, plain, _ = await _seed(db_session, org_id, admin_id)

        result = await CourseCohortService(db_session).preview_schedule(
            CohortSchedulePreviewRequest(
                course_id=container.id,
                start_date=START,
                location_id=hall.id,
                classes=[
                    CohortClassOverride(course_class_id=plain.id, location_id=annex.id)
                ],
            ),
            org_id,
        )

        first = result["classes"][0]
        assert (first["location_id"], first["location_source"]) == (annex.id, "class")
        assert not any("Location already booked" in w for w in first["warnings"])

    async def test_a_room_from_another_department_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        _, _, _, container, plain, _ = await _seed(db_session, org_id, admin_id)
        foreign = str(uuid.uuid4())

        svc = CourseCohortService(db_session)
        with pytest.raises(ValueError, match="location"):
            await svc.preview_schedule(
                CohortSchedulePreviewRequest(
                    course_id=container.id, start_date=START, location_id=foreign
                ),
                org_id,
            )
        with pytest.raises(ValueError, match="location"):
            await svc.preview_schedule(
                CohortSchedulePreviewRequest(
                    course_id=container.id,
                    start_date=START,
                    classes=[
                        CohortClassOverride(
                            course_class_id=plain.id, location_id=foreign
                        )
                    ],
                ),
                org_id,
            )


class TestGenerationBooksTheResolvedRoom:
    async def test_generated_classes_carry_the_room_the_preview_showed(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        hall, tower, annex, container, plain, live_fire = await _seed(
            db_session, org_id, admin_id
        )
        svc = CourseCohortService(db_session)
        overrides = [
            CohortClassOverride(course_class_id=plain.id, location_id=annex.id)
        ]

        preview = await svc.preview_schedule(
            CohortSchedulePreviewRequest(
                course_id=container.id,
                start_date=START,
                location_id=hall.id,
                classes=overrides,
            ),
            org_id,
        )
        cohort, _ = await svc.create_cohort(
            CourseCohortCreate(
                course_id=container.id,
                name="Spring Academy",
                start_date=START,
                location_id=hall.id,
                classes=overrides,
            ),
            org_id,
            admin_id,
        )

        rows = (
            await db_session.execute(
                select(CourseCohortClass).where(
                    CourseCohortClass.cohort_id == cohort.id,
                    CourseCohortClass.organization_id == org_id,
                )
            )
        ).scalars()
        booked = {str(c.course_class_id): str(c.location_id) for c in rows}
        assert booked == {
            str(c["course_class_id"]): str(c["location_id"]) for c in preview["classes"]
        }
        assert booked == {str(plain.id): annex.id, str(live_fire.id): tower.id}
        assert str(cohort.location_id) == hall.id
