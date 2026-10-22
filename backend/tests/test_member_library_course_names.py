"""
A member sees the library course's name for a record linked to one.

An imported record keeps the name it arrived with (the CSV's spelling, the
provider's title) even after an officer maps it to a library course. Members
are shown the library name; officers keep the stored one, because the record
edit form sends ``course_name`` back on save.
"""

import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.training import MAX_TRAINING_RECORDS_PAGE, list_records
from app.api.v1.endpoints.training_module_config import (
    get_my_training_records,
    get_my_training_summary,
)
from app.models.training import (
    TrainingCourse,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, Position, User, UserStatus, user_positions
from app.services.training_course_names import library_course_names

pytestmark = [pytest.mark.integration]

CSV_SPELLING = "HAZMAT awareness (2019 cert)"
LIBRARY_NAME = "Hazardous Materials Awareness"


async def _member(db_session, org_id) -> User:
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
    return await _loaded(db_session, member.id)


async def _training_officer(db_session, org_id) -> User:
    position = Position(
        organization_id=org_id,
        name="Training Officer",
        slug=f"training-officer-{uuid.uuid4().hex[:6]}",
        permissions=["training.manage"],
    )
    db_session.add(position)
    officer = await _member(db_session, org_id)
    await db_session.execute(
        user_positions.insert().values(user_id=officer.id, position_id=position.id)
    )
    await db_session.flush()
    return await _loaded(db_session, officer.id)


async def _loaded(db_session, user_id) -> User:
    """The caller as the auth dependency hands it over: positions loaded."""
    # populate_existing: the identity map may already hold this user with an
    # empty positions collection from before a position was assigned.
    result = await db_session.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == user_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _course(db_session, org_id, name=LIBRARY_NAME) -> TrainingCourse:
    course = TrainingCourse(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        training_type=TrainingType.CERTIFICATION,
    )
    db_session.add(course)
    await db_session.flush()
    return course


async def _imported(db_session, org_id, user_id, course_id, name=CSV_SPELLING):
    record = TrainingRecord(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=user_id,
        course_id=course_id,
        course_name=name,
        training_type=TrainingType.CERTIFICATION,
        completion_date=date(2019, 5, 1),
        expiration_date=date(2030, 5, 1),
        hours_completed=8,
        status=TrainingStatus.COMPLETED,
    )
    db_session.add(record)
    await db_session.flush()
    return record


async def _history(db_session, user, search=None):
    return await get_my_training_records(
        year=None,
        search=search,
        training_type=None,
        page=1,
        page_size=25,
        db=db_session,
        current_user=user,
    )


async def _records(db_session, user, **params):
    defaults = {
        "user_id": None,
        "status": None,
        "start_date": None,
        "end_date": None,
        "skip": 0,
        "limit": MAX_TRAINING_RECORDS_PAGE,
    }
    return await list_records(
        response=Response(),
        db=db_session,
        current_user=user,
        **{**defaults, **params},
    )


class TestMyTraining:
    async def test_history_shows_the_library_name_for_a_linked_record(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        course = await _course(db_session, org_id)
        await _imported(db_session, org_id, member.id, course.id)
        await _imported(db_session, org_id, member.id, None, name="Unmapped CSV class")

        items = (await _history(db_session, member))["items"]

        assert sorted(i["course_name"] for i in items) == [
            LIBRARY_NAME,
            "Unmapped CSV class",
        ]

    async def test_summary_and_certifications_show_the_library_name(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        course = await _course(db_session, org_id)
        await _imported(db_session, org_id, member.id, course.id)

        summary = await get_my_training_summary(db=db_session, current_user=member)

        assert [r["course_name"] for r in summary["training_records"]] == [LIBRARY_NAME]
        assert [c["course_name"] for c in summary["certifications"]] == [LIBRARY_NAME]

    async def test_search_finds_a_record_by_the_name_the_member_sees(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        course = await _course(db_session, org_id)
        await _imported(db_session, org_id, member.id, course.id)

        by_library = await _history(db_session, member, search="hazardous materials")
        by_stored = await _history(db_session, member, search="2019 cert")

        assert by_library["total"] == 1
        assert by_stored["total"] == 1


class TestRecordsEndpoint:
    async def test_a_member_sees_the_library_name_without_it_being_stored(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        course = await _course(db_session, org_id)
        record = await _imported(db_session, org_id, member.id, course.id)

        rows = await _records(db_session, member)
        await db_session.flush()
        await db_session.refresh(record)

        assert [r.course_name for r in rows] == [LIBRARY_NAME]
        assert record.course_name == CSV_SPELLING

    async def test_an_officer_gets_the_stored_name_the_edit_form_saves_back(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _training_officer(db_session, org_id)
        member = await _member(db_session, org_id)
        course = await _course(db_session, org_id)
        await _imported(db_session, org_id, member.id, course.id)

        rows = await _records(db_session, officer, user_id=uuid.UUID(member.id))

        assert [r.course_name for r in rows] == [CSV_SPELLING]


class TestLibraryCourseNames:
    async def test_another_departments_course_is_not_resolved(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        other = Organization(
            id=str(uuid.uuid4()),
            name="Other Department",
            slug=f"other-{uuid.uuid4().hex[:8]}",
        )
        db_session.add(other)
        await db_session.flush()
        foreign = await _course(db_session, other.id, name="Their Course")
        own = await _course(db_session, org_id)

        names = await library_course_names(
            db_session, org_id, [foreign.id, own.id, None]
        )

        assert names == {own.id: LIBRARY_NAME}

    async def test_no_linked_records_needs_no_query(self):
        db = SimpleNamespace()

        assert await library_course_names(db, "org", [None, ""]) == {}
