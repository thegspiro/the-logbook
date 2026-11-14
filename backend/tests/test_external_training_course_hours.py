"""
A completion the provider reports with no hours takes its mapped course's hours.

Target Solutions reports a policy acknowledgment — a Code of Conduct, a
Whistleblower policy — as 0 hours, while the department counts it as an hour
on the library course it is mapped to. The import credited only what the
provider reported, so the member's record read 0 whatever the course said.

Hours the provider does report are what the course was accredited for and
always win. Mapping a course corrects the records already imported from it, and
migration de53b573ad3c corrects the ones imported before either existed.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from app.models.training import TrainingCourse, TrainingType
from app.services.external_course_mapping import course_hours
from tests.test_external_training_course_mapping import (
    _map,
    _mapping,
    _record,
    _setup,
    _upload_report,
)

CONDUCT = ("FCVFD Code of Conduct", "1472902")
_REVISION = "de53b573ad3c"


def _row(title, course_id, transcript, hours="0", email="pat@dept.test", day=6):
    """A Target Solutions completion row whose "Duration (hours)" is ``hours``.

    Another member's row (``email``) gets its own employee id: a same-day
    repeat of one employee's acknowledgment is set aside as a duplicate.
    """
    employee = "1001" if email == "pat@dept.test" else "2002"
    return (
        f'{employee},{email},"{title}",Admin,,11/{day}/2026,,11/{day}/2026,7:31 PM,12,'
        f"Completed,1,,{course_id},{transcript},,{hours},,"
    )


async def _course(db_session, ctx, name, credit_hours=None, duration_hours=None):
    course = TrainingCourse(
        id=str(uuid.uuid4()),
        organization_id=ctx.org.id,
        name=name,
        training_type=TrainingType.CONTINUING_EDUCATION,
        credit_hours=credit_hours,
        duration_hours=duration_hours,
        active=True,
    )
    db_session.add(course)
    await db_session.flush()
    return course


async def _hours(db_session, ctx, transcript):
    record = await _record(db_session, ctx, transcript)
    await db_session.refresh(record)
    return record.hours_completed, record.credit_hours


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("course_hours_mig", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.unit
class TestCourseHours:
    def test_credit_hours_win(self):
        assert course_hours(1.0, 3.0) == 1.0

    def test_duration_stands_in_for_blank_credit(self):
        assert course_hours(None, 2.5) == 2.5

    def test_zero_credit_is_the_officers_answer(self):
        # A course set to 0 credit hours credits nothing, even with a duration.
        assert course_hours(0, 2.0) is None

    def test_no_hours_at_all(self):
        assert course_hours(None, None) is None


@pytest.mark.integration
class TestImportTakesTheCoursesHours:
    async def test_a_zero_hour_completion_takes_the_mapped_courses_hours(
        self, db_session
    ):
        ctx = await _setup(db_session)
        conduct = await _course(db_session, ctx, "FCVFD Code of Conduct", 1.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-0", email="x@y.test"))
        await _map(
            db_session, ctx, await _mapping(db_session, ctx, CONDUCT[1]), conduct.id
        )

        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1"))

        assert await _hours(db_session, ctx, "T-1") == (1.0, 1.0)

    async def test_a_blank_duration_takes_the_mapped_courses_hours(self, db_session):
        ctx = await _setup(db_session)
        conduct = await _course(db_session, ctx, "Conduct", duration_hours=0.5)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-0", email="x@y.test"))
        await _map(
            db_session, ctx, await _mapping(db_session, ctx, CONDUCT[1]), conduct.id
        )

        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1", hours=""))

        assert await _hours(db_session, ctx, "T-1") == (0.5, 0.5)

    async def test_hours_the_provider_reported_win(self, db_session):
        ctx = await _setup(db_session)
        conduct = await _course(db_session, ctx, "Conduct", 2.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-0", email="x@y.test"))
        await _map(
            db_session, ctx, await _mapping(db_session, ctx, CONDUCT[1]), conduct.id
        )

        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1", hours="0.5"))

        assert await _hours(db_session, ctx, "T-1") == (0.5, 0.5)

    async def test_an_unmapped_zero_hour_completion_stays_zero(self, db_session):
        ctx = await _setup(db_session)

        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1"))

        assert await _hours(db_session, ctx, "T-1") == (0.0, 0.0)


@pytest.mark.integration
class TestMappingCorrectsPastRecords:
    async def test_mapping_credits_records_already_imported(self, db_session):
        ctx = await _setup(db_session)
        conduct = await _course(db_session, ctx, "Conduct", 1.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1"))
        assert (await _hours(db_session, ctx, "T-1"))[0] == 0.0

        await _map(
            db_session, ctx, await _mapping(db_session, ctx, CONDUCT[1]), conduct.id
        )

        assert await _hours(db_session, ctx, "T-1") == (1.0, 1.0)

    async def test_remapping_moves_hours_and_unmapping_takes_them_back(
        self, db_session
    ):
        ctx = await _setup(db_session)
        one = await _course(db_session, ctx, "Conduct", 1.0)
        two = await _course(db_session, ctx, "Conduct (long)", 2.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1"))
        mapping = await _mapping(db_session, ctx, CONDUCT[1])

        await _map(db_session, ctx, mapping, one.id)
        await _map(db_session, ctx, mapping, two.id)
        assert await _hours(db_session, ctx, "T-1") == (2.0, 2.0)

        await _map(db_session, ctx, mapping, None)
        assert await _hours(db_session, ctx, "T-1") == (0.0, None)

    async def test_hours_an_officer_entered_are_left_alone(self, db_session):
        ctx = await _setup(db_session)
        conduct = await _course(db_session, ctx, "Conduct", 1.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1"))
        record = await _record(db_session, ctx, "T-1")
        record.hours_completed = 3.0
        await db_session.flush()

        await _map(
            db_session, ctx, await _mapping(db_session, ctx, CONDUCT[1]), conduct.id
        )

        assert (await _hours(db_session, ctx, "T-1"))[0] == 3.0

    async def test_hours_the_provider_reported_are_left_alone(self, db_session):
        ctx = await _setup(db_session)
        conduct = await _course(db_session, ctx, "Conduct", 2.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1", hours="0.5"))

        await _map(
            db_session, ctx, await _mapping(db_session, ctx, CONDUCT[1]), conduct.id
        )

        assert await _hours(db_session, ctx, "T-1") == (0.5, 0.5)

    async def test_credit_hours_an_officer_entered_are_left_alone(self, db_session):
        # The record edit screen sets credit hours apart from hours completed,
        # so a record whose hours still match the course can carry an
        # officer's credit. Re-mapping must not replace that credit.
        ctx = await _setup(db_session)
        one = await _course(db_session, ctx, "Conduct", 1.0)
        two = await _course(db_session, ctx, "Conduct (long)", 2.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1"))
        mapping = await _mapping(db_session, ctx, CONDUCT[1])
        await _map(db_session, ctx, mapping, one.id)
        record = await _record(db_session, ctx, "T-1")
        record.credit_hours = 3.0
        await db_session.flush()

        await _map(db_session, ctx, mapping, two.id)

        assert await _hours(db_session, ctx, "T-1") == (1.0, 3.0)

    async def test_remapping_between_equal_courses_credits_records_left_at_zero(
        self, db_session
    ):
        # Imported while its course credited nothing; the course was given an
        # hour afterwards. Re-mapping to another one-hour course must still
        # credit the record, though both courses credit the same.
        ctx = await _setup(db_session)
        first = await _course(db_session, ctx, "Conduct")
        second = await _course(db_session, ctx, "Conduct 2027", 1.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-1"))
        mapping = await _mapping(db_session, ctx, CONDUCT[1])
        await _map(db_session, ctx, mapping, first.id)
        assert (await _hours(db_session, ctx, "T-1"))[0] == 0.0
        first.credit_hours = 1.0
        await db_session.flush()

        await _map(db_session, ctx, mapping, second.id)

        assert await _hours(db_session, ctx, "T-1") == (1.0, 1.0)


@pytest.mark.integration
class TestMigrationCorrectsRecordsAlreadyImported:
    """The migration's statements, run against rows the old code left behind."""

    async def _imported_at_zero(self, db_session, ctx, transcript, hours="0", day=6):
        # Mapped first, then imported, as the department's courses were —
        # then put back to what the code before this change wrote.
        await _upload_report(
            db_session, ctx, _row(*CONDUCT, transcript, hours=hours, day=day)
        )
        record = await _record(db_session, ctx, transcript)
        if hours == "0":
            record.hours_completed = 0.0
            record.credit_hours = 0.0
        await db_session.flush()
        return record

    async def test_upgrade_credits_the_course_and_downgrade_restores_zero(
        self, db_session
    ):
        migration = _load_migration()
        ctx = await _setup(db_session)
        conduct = await _course(db_session, ctx, "Conduct", 1.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-0", email="x@y.test"))
        await _map(
            db_session, ctx, await _mapping(db_session, ctx, CONDUCT[1]), conduct.id
        )
        await self._imported_at_zero(db_session, ctx, "T-1")
        await self._imported_at_zero(db_session, ctx, "T-2", hours="0.5", day=4)
        typed = await self._imported_at_zero(db_session, ctx, "T-3", day=5)
        typed.hours_completed = 3.0
        await db_session.flush()

        await db_session.execute(text(migration.UPGRADE_SQL))
        assert await _hours(db_session, ctx, "T-1") == (1.0, 1.0)
        assert await _hours(db_session, ctx, "T-2") == (0.5, 0.5)
        assert (await _hours(db_session, ctx, "T-3"))[0] == 3.0

        # A second run changes nothing.
        await db_session.execute(text(migration.UPGRADE_SQL))
        assert await _hours(db_session, ctx, "T-1") == (1.0, 1.0)

        await db_session.execute(text(migration.DOWNGRADE_SQL))
        assert await _hours(db_session, ctx, "T-1") == (0.0, 0.0)
        assert await _hours(db_session, ctx, "T-2") == (0.5, 0.5)
        assert (await _hours(db_session, ctx, "T-3"))[0] == 3.0

    async def test_a_record_linked_to_another_course_is_left_alone(self, db_session):
        migration = _load_migration()
        ctx = await _setup(db_session)
        conduct = await _course(db_session, ctx, "Conduct", 1.0)
        other = await _course(db_session, ctx, "Other", 4.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-0", email="x@y.test"))
        await _map(
            db_session, ctx, await _mapping(db_session, ctx, CONDUCT[1]), conduct.id
        )
        record = await self._imported_at_zero(db_session, ctx, "T-1")
        record.course_id = other.id
        await db_session.flush()

        await db_session.execute(text(migration.UPGRADE_SQL))

        assert (await _hours(db_session, ctx, "T-1"))[0] == 0.0

    async def test_credit_hours_an_officer_entered_survive_both_directions(
        self, db_session
    ):
        migration = _load_migration()
        ctx = await _setup(db_session)
        conduct = await _course(db_session, ctx, "Conduct", 1.0)
        await _upload_report(db_session, ctx, _row(*CONDUCT, "T-0", email="x@y.test"))
        await _map(
            db_session, ctx, await _mapping(db_session, ctx, CONDUCT[1]), conduct.id
        )
        # Hours still zero, but an officer recorded three credit hours.
        zero_hours = await self._imported_at_zero(db_session, ctx, "T-1")
        zero_hours.credit_hours = 3.0
        # Hours match the course, but an officer recorded three credit hours.
        matching = await self._imported_at_zero(db_session, ctx, "T-2", day=5)
        matching.hours_completed = 1.0
        matching.credit_hours = 3.0
        await db_session.flush()

        await db_session.execute(text(migration.UPGRADE_SQL))
        assert await _hours(db_session, ctx, "T-1") == (0.0, 3.0)

        await db_session.execute(text(migration.DOWNGRADE_SQL))
        assert await _hours(db_session, ctx, "T-2") == (1.0, 3.0)
