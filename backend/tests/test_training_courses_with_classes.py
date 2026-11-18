"""``GET /training/courses?with_classes=true``: only courses with a syllabus.

The cohort wizard offers the department's courses to generate a cohort from
and says "The course must already have classes on its syllabus", but its list
was every active course, so a component course with an empty syllabus was
offered beside the multi-class course built from it, and choosing one failed
only at the preview (workflow review W27-4). The wizard now asks for courses
with at least one class.

Without the parameter the list is unchanged, so no other caller sees a
difference.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import training as training_endpoint
from app.core.database import get_db
from app.models.training import CourseClass, TrainingCourse, TrainingType
from app.models.user import Organization
from tests.test_finance_budget_owners import _user

pytestmark = pytest.mark.integration


async def _org(db: AsyncSession, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"with-classes-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _course(db: AsyncSession, org_id: str, name: str, active: bool = True):
    course = TrainingCourse(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        training_type=TrainingType.CERTIFICATION,
        active=active,
    )
    db.add(course)
    await db.flush()
    return course


async def _class(db: AsyncSession, org_id: str, course, taught, sequence: int):
    db.add(
        CourseClass(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            course_id=course.id,
            class_course_id=taught.id,
            sequence=sequence,
        )
    )
    await db.flush()


def _client(db: AsyncSession, user) -> AsyncClient:
    app = FastAPI()
    app.include_router(training_endpoint.router, prefix="/training")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = await _org(db_session, "With Classes VFD")
    officer = await _user(db_session, org.id, "officer", [])
    pump = await _course(db_session, org.id, "Pump Operations")
    vehicle = await _course(db_session, org.id, "Vehicle Familiarization")
    driver = await _course(db_session, org.id, "Driver Operator Course")
    await _class(db_session, org.id, driver, pump, 1)
    await _class(db_session, org.id, driver, vehicle, 2)
    return {"db": db_session, "org": org, "officer": officer}


async def test_with_classes_lists_only_courses_with_a_syllabus(dept):
    async with _client(dept["db"], dept["officer"]) as client:
        response = await client.get("/training/courses", params={"with_classes": True})

    assert response.status_code == 200
    assert [c["name"] for c in response.json()] == ["Driver Operator Course"]


async def test_without_the_parameter_every_active_course_is_listed(dept):
    async with _client(dept["db"], dept["officer"]) as client:
        response = await client.get("/training/courses")

    assert response.status_code == 200
    assert [c["name"] for c in response.json()] == [
        "Driver Operator Course",
        "Pump Operations",
        "Vehicle Familiarization",
    ]


async def test_with_classes_still_leaves_out_an_inactive_course(dept):
    db, org = dept["db"], dept["org"]
    retired = await _course(db, org.id, "Retired Academy", active=False)
    pump = await _course(db, org.id, "Pump Refresher")
    await _class(db, org.id, retired, pump, 1)

    async with _client(db, dept["officer"]) as client:
        response = await client.get("/training/courses", params={"with_classes": True})

    assert [c["name"] for c in response.json()] == ["Driver Operator Course"]


async def test_another_departments_syllabus_does_not_count(dept):
    db, org = dept["db"], dept["org"]
    other = await _org(db, "Other VFD")
    theirs = await _course(db, other.id, "Their Academy")
    ours = await _course(db, org.id, "Hose Handling")
    # Rows that should never exist, built to prove the filter is scoped by
    # course, not by any class row anywhere.
    await _class(db, other.id, theirs, ours, 1)

    async with _client(db, dept["officer"]) as client:
        response = await client.get("/training/courses", params={"with_classes": True})

    assert [c["name"] for c in response.json()] == ["Driver Operator Course"]
