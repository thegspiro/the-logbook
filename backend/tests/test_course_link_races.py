"""Course Links stays true to what its writes actually changed.

Two read-then-write races (pitfall #27), each found by review and confirmed:

* ``_apply`` read the unlinked records with a plain SELECT and then always
  recorded a link, with an undo row for every record read, whatever its
  guarded UPDATE changed. A second link of the same name racing the first
  read the records as unlinked from its snapshot, changed none of them, and
  still committed a link claiming them all — whose undo then reverted the
  first link's records.
* ``unlink`` decided keep-or-revert from a plain read and reverted by id
  alone, so a record an officer re-linked between that read and the UPDATE
  lost the officer's course.

Each test reproduces the stale read in one session: it hands the write the
rows a concurrent request's snapshot would have held.
"""

import uuid
from datetime import date
from unittest.mock import AsyncMock

import pymysql
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import selectinload
from sqlalchemy.sql import Select, Update

from app.api.v1.endpoints import training as training_endpoints
from app.api.v1.endpoints.training import (
    link_course_name,
    link_suggested_course_names,
)
from app.models.training import (
    TrainingCourse,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.training_course_link import TrainingCourseLink, TrainingCourseLinkRecord
from app.models.user import User, UserStatus
from app.schemas.training import CourseLinkRequest
from app.services.training_course_links import TrainingCourseLinkService, name_key

pytestmark = [pytest.mark.integration]


@pytest.fixture(autouse=True)
def _no_audit(monkeypatch):
    monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())


async def _seed(db, org_id):
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
    db.add(member)
    courses = {}
    for name in ("CPR Refresher", "BLS Provider"):
        courses[name] = TrainingCourse(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            name=name,
            training_type=TrainingType.CERTIFICATION,
            active=True,
        )
        db.add(courses[name])
    records = [
        TrainingRecord(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            user_id=member.id,
            course_name="CPR Refresher",
            training_type=TrainingType.CONTINUING_EDUCATION,
            completion_date=date(2020 + i, 5, 1),
            hours_completed=4,
            status=TrainingStatus.COMPLETED,
        )
        for i in range(2)
    ]
    db.add_all(records)
    await db.flush()
    return member, courses["CPR Refresher"], courses["BLS Provider"], records


async def _course_of(db, record_id):
    return (
        await db.execute(
            select(TrainingRecord.course_id)
            .where(TrainingRecord.id == record_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


def _is_unlinked_read(statement) -> bool:
    return (
        isinstance(statement, Select)
        and "training_records.course_id IS NULL" in str(statement)
        and "training_records.category_id" in str(statement)
    )


class TestAStaleLinkRecordsNothing:
    async def test_a_link_that_changed_no_record_is_not_recorded(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, admin = setup_org_and_admin
        _member, cpr, _bls, records = await _seed(db_session, org_id)
        service = TrainingCourseLinkService(db_session)
        await service.link(org_id, name_key("CPR Refresher"), cpr.id, admin)
        await db_session.commit()

        # The second request's snapshot still saw both records unlinked.
        real_execute = db_session.execute
        stale = [(r.id, None, TrainingType.CONTINUING_EDUCATION) for r in records]

        class _StaleRows:
            def all(self):
                return stale

        async def execute(statement, *args, **kwargs):
            if _is_unlinked_read(statement):
                await real_execute(statement, *args, **kwargs)
                return _StaleRows()
            return await real_execute(statement, *args, **kwargs)

        monkeypatch.setattr(db_session, "execute", execute)
        changed = await service._apply(
            org_id, ["CPR Refresher"], cpr, name_key("CPR Refresher"), "CPR", admin
        )
        monkeypatch.undo()
        await db_session.commit()

        assert changed == 0
        links = (
            await db_session.execute(
                select(func.count())
                .select_from(TrainingCourseLink)
                .where(TrainingCourseLink.organization_id == org_id)
            )
        ).scalar_one()
        assert links == 1
        undo_rows = (
            await db_session.execute(
                select(func.count())
                .select_from(TrainingCourseLinkRecord)
                .join(
                    TrainingCourseLink,
                    TrainingCourseLink.id == TrainingCourseLinkRecord.link_id,
                )
                .where(TrainingCourseLink.organization_id == org_id)
            )
        ).scalar_one()
        assert undo_rows == 2
        for record in records:
            assert await _course_of(db_session, record.id) == cpr.id

    async def test_the_unlinked_read_locks_the_records(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        """Half 2 of pitfall #27: a plain read answers from the snapshot, so a
        concurrent link must read the records with a lock to see them as the
        first link left them."""
        org_id, admin = setup_org_and_admin
        _member, cpr, _bls, _records = await _seed(db_session, org_id)
        seen = []
        real_execute = db_session.execute

        async def execute(statement, *args, **kwargs):
            if _is_unlinked_read(statement):
                seen.append(statement._for_update_arg is not None)
            return await real_execute(statement, *args, **kwargs)

        monkeypatch.setattr(db_session, "execute", execute)
        await TrainingCourseLinkService(db_session).link(
            org_id, name_key("CPR Refresher"), cpr.id, admin
        )

        assert seen == [True]


class TestUndoKeepsAnOfficersRelink:
    async def test_a_record_relinked_after_the_undos_read_keeps_its_course(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, admin = setup_org_and_admin
        _member, cpr, bls, records = await _seed(db_session, org_id)
        service = TrainingCourseLinkService(db_session)
        await service.link(org_id, name_key("CPR Refresher"), cpr.id, admin)
        await db_session.commit()
        link_id = (
            await db_session.execute(
                select(TrainingCourseLink.id).where(
                    TrainingCourseLink.organization_id == org_id
                )
            )
        ).scalar_one()
        relinked = records[0]

        # Another officer saves the record with BLS after the undo has read
        # it, and before the undo writes.
        real_execute = db_session.execute
        done = []

        async def execute(statement, *args, **kwargs):
            if (
                not done
                and isinstance(statement, Update)
                and str(statement).startswith("UPDATE training_records SET course_id")
            ):
                done.append(True)
                await real_execute(
                    update(TrainingRecord)
                    .where(TrainingRecord.id == relinked.id)
                    .values(course_id=bls.id)
                )
            return await real_execute(statement, *args, **kwargs)

        monkeypatch.setattr(db_session, "execute", execute)
        result = await service.unlink(org_id, link_id, admin)
        monkeypatch.undo()

        assert done == [True]
        assert await _course_of(db_session, relinked.id) == bls.id
        assert await _course_of(db_session, records[1].id) is None
        assert (result.reverted, result.kept) == (1, 1)


class TestALockConflictIsARetry:
    """Two overlapping links take record locks by name and then by id, so
    InnoDB can roll one back. The officer is told to try again, not shown a
    server error."""

    @pytest.mark.parametrize("door", ["link", "link_suggested"])
    async def test_a_deadlock_between_two_links_answers_409(
        self, db_session, setup_org_and_admin, monkeypatch, door
    ):
        org_id, _admin = setup_org_and_admin
        member, cpr, _bls, _records = await _seed(db_session, org_id)
        officer = (
            await db_session.execute(
                select(User)
                .options(selectinload(User.positions))
                .where(User.id == member.id)
            )
        ).scalar_one()

        async def deadlock(*args, **kwargs):
            raise OperationalError(
                "SELECT ...", {}, pymysql.err.OperationalError(1213, "Deadlock")
            )

        monkeypatch.setattr(TrainingCourseLinkService, "_apply", deadlock)
        if door == "link":
            call = link_course_name(
                payload=CourseLinkRequest(
                    key=name_key("CPR Refresher"), course_id=cpr.id
                ),
                db=db_session,
                current_user=officer,
            )
        else:
            call = link_suggested_course_names(db=db_session, current_user=officer)
        with pytest.raises(HTTPException) as refused:
            await call

        assert refused.value.status_code == 409
