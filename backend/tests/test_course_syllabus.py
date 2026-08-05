"""
Tests for CourseSyllabusService — the ordered list of classes that makes up a
multi-class course (a recruit school and its fifteen subjects).

Covers appending with defaults inherited from the linked catalog course,
sequence renumbering on delete and reorder, the self-reference guard, org
scoping of the required catalog-course link, and meeting-pattern autofill.

DB is mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import CourseClass, TrainingCourse, TrainingType
from app.schemas.course_cohort import (
    CourseClassAutofill,
    CourseClassCreate,
    CourseClassUpdate,
)
from app.services.course_syllabus_service import CourseSyllabusService

ORG = uuid4()
ACTOR = uuid4()


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _rows(pairs):
    r = MagicMock()
    r.all.return_value = pairs
    return r


class RecordingSession:
    """Async session that returns queued results and records added objects."""

    def __init__(self, results=None):
        self._results = list(results or [])
        self.statements = []
        self.added = []
        self.deleted = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()
        self.rollback = AsyncMock()

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()


def _course(name="Recruit School", course_id=None, **kw):
    course = TrainingCourse(
        id=course_id or str(uuid4()),
        organization_id=str(ORG),
        name=name,
        training_type=TrainingType.ORIENTATION,
    )
    for key, value in kw.items():
        setattr(course, key, value)
    return course


def _klass(sequence, course_id, class_id=None):
    return CourseClass(
        id=class_id or str(uuid4()),
        organization_id=str(ORG),
        course_id=course_id,
        class_course_id=str(uuid4()),
        sequence=sequence,
        day_offset=sequence - 1,
        duration_minutes=60,
    )


class TestAddClass:
    async def test_inherits_defaults_from_the_catalog_course(self):
        container = _course("Recruit School")
        subject = _course("SCBA Operations", credit_hours=3.5, instructor="Capt. Ruiz")

        db = RecordingSession(
            [
                _one(container),  # container course lookup
                _one(subject),  # class course lookup
                _scalar(0),  # existing class count
                _scalar(None),  # max sequence
            ]
        )
        svc = CourseSyllabusService(db)

        created = await svc.add_class(
            course_id=container.id,
            data=CourseClassCreate(class_course_id=subject.id, day_offset=2),
            organization_id=ORG,
            created_by=ACTOR,
        )

        # Officer only supplied the offset; everything else comes from the course.
        assert created.title == "SCBA Operations"
        assert created.credit_hours == 3.5
        assert created.instructor == "Capt. Ruiz"
        assert created.sequence == 1
        assert created.day_offset == 2
        assert db.commit.await_count == 1

    async def test_explicit_values_win_over_course_defaults(self):
        container = _course("Recruit School")
        subject = _course("SCBA Operations", credit_hours=3.5)

        db = RecordingSession([_one(container), _one(subject), _scalar(0), _scalar(4)])
        svc = CourseSyllabusService(db)

        created = await svc.add_class(
            course_id=container.id,
            data=CourseClassCreate(
                class_course_id=subject.id,
                title="SCBA — night evolution",
                credit_hours=6,
            ),
            organization_id=ORG,
            created_by=ACTOR,
        )

        assert created.title == "SCBA — night evolution"
        assert created.credit_hours == 6
        assert created.sequence == 5  # appended after the existing four

    async def test_rejects_a_course_that_contains_itself(self):
        container = _course("Recruit School")
        db = RecordingSession([_one(container), _one(container)])
        svc = CourseSyllabusService(db)

        with pytest.raises(ValueError, match="cannot contain itself"):
            await svc.add_class(
                course_id=container.id,
                data=CourseClassCreate(class_course_id=container.id),
                organization_id=ORG,
                created_by=ACTOR,
            )
        assert db.commit.await_count == 0

    async def test_rejects_a_catalog_course_from_another_org(self):
        container = _course("Recruit School")
        # The org-scoped lookup finds nothing for a foreign course id.
        db = RecordingSession([_one(container), _one(None)])
        svc = CourseSyllabusService(db)

        with pytest.raises(ValueError, match="Invalid class course"):
            await svc.add_class(
                course_id=container.id,
                data=CourseClassCreate(class_course_id=uuid4()),
                organization_id=ORG,
                created_by=ACTOR,
            )

    async def test_rejects_an_unknown_course(self):
        db = RecordingSession([_one(None)])
        svc = CourseSyllabusService(db)

        with pytest.raises(ValueError, match="not found"):
            await svc.add_class(
                course_id=uuid4(),
                data=CourseClassCreate(class_course_id=uuid4()),
                organization_id=ORG,
                created_by=ACTOR,
            )

    async def test_enforces_the_syllabus_length_cap(self):
        container = _course("Recruit School")
        subject = _course("SCBA Operations")
        db = RecordingSession([_one(container), _one(subject), _scalar(200)])
        svc = CourseSyllabusService(db)

        with pytest.raises(ValueError, match="more than 200 classes"):
            await svc.add_class(
                course_id=container.id,
                data=CourseClassCreate(class_course_id=subject.id),
                organization_id=ORG,
                created_by=ACTOR,
            )


class TestUpdateClass:
    async def test_patches_only_supplied_fields(self):
        existing = _klass(3, str(uuid4()))
        existing.title = "Ladders"
        db = RecordingSession([_one(existing)])
        svc = CourseSyllabusService(db)

        updated = await svc.update_class(
            class_id=existing.id,
            data=CourseClassUpdate(day_offset=9),
            organization_id=ORG,
        )

        assert updated.day_offset == 9
        assert updated.title == "Ladders"  # untouched

    async def test_unknown_class_raises(self):
        db = RecordingSession([_one(None)])
        svc = CourseSyllabusService(db)
        with pytest.raises(ValueError, match="Class not found"):
            await svc.update_class(uuid4(), CourseClassUpdate(day_offset=1), ORG)


class TestReorderAndDelete:
    async def test_reorder_renumbers_contiguously(self):
        course_id = str(uuid4())
        a, b, c = (_klass(i, course_id) for i in (1, 2, 3))
        db = RecordingSession(
            [
                _one(_course(course_id=course_id)),
                _scalars([a, b, c]),
                _scalars([c, a, b]),
            ]
        )
        svc = CourseSyllabusService(db)

        await svc.reorder_classes(course_id, [c.id, a.id, b.id], ORG)

        assert (c.sequence, a.sequence, b.sequence) == (1, 2, 3)
        assert db.commit.await_count == 1

    async def test_reorder_rejects_a_partial_list(self):
        course_id = str(uuid4())
        a, b = _klass(1, course_id), _klass(2, course_id)
        db = RecordingSession([_one(_course(course_id=course_id)), _scalars([a, b])])
        svc = CourseSyllabusService(db)

        with pytest.raises(ValueError, match="exactly once"):
            await svc.reorder_classes(course_id, [a.id], ORG)

    async def test_delete_closes_the_gap_in_the_ordering(self):
        course_id = str(uuid4())
        a, b, c = (_klass(i, course_id) for i in (1, 2, 3))
        db = RecordingSession([_one(b), _scalars([a, c])])
        svc = CourseSyllabusService(db)

        await svc.delete_class(b.id, ORG)

        assert db.deleted == [b]
        assert (a.sequence, c.sequence) == (1, 2)

    async def test_delete_unknown_class_raises(self):
        db = RecordingSession([_one(None)])
        svc = CourseSyllabusService(db)
        with pytest.raises(ValueError, match="Class not found"):
            await svc.delete_class(uuid4(), ORG)


class TestAutofillOffsets:
    async def test_meeting_pattern_sets_every_offset(self):
        course_id = str(uuid4())
        rows = [_klass(i, course_id) for i in range(1, 7)]
        db = RecordingSession([_one(_course(course_id=course_id)), _scalars(rows)])
        svc = CourseSyllabusService(db)

        result = await svc.autofill_offsets(
            course_id=course_id,
            data=CourseClassAutofill(
                meeting_days=[1, 3],  # Tuesday and Thursday
                start_weekday=0,  # course starts on a Monday
                default_start_time="19:00",
                default_duration_minutes=180,
            ),
            organization_id=ORG,
        )

        assert [r.day_offset for r in result] == [1, 3, 8, 10, 15, 17]
        assert all(r.start_time == "19:00" for r in result)
        assert all(r.duration_minutes == 180 for r in result)

    async def test_times_are_left_alone_without_defaults(self):
        course_id = str(uuid4())
        rows = [_klass(i, course_id) for i in (1, 2)]
        for row in rows:
            row.start_time = "08:00"
        db = RecordingSession([_one(_course(course_id=course_id)), _scalars(rows)])
        svc = CourseSyllabusService(db)

        result = await svc.autofill_offsets(
            course_id=course_id,
            data=CourseClassAutofill(meeting_days=[1, 3]),
            organization_id=ORG,
        )

        assert all(r.start_time == "08:00" for r in result)

    async def test_empty_syllabus_raises(self):
        course_id = str(uuid4())
        db = RecordingSession([_one(_course(course_id=course_id)), _scalars([])])
        svc = CourseSyllabusService(db)

        with pytest.raises(ValueError, match="no classes"):
            await svc.autofill_offsets(
                course_id=course_id,
                data=CourseClassAutofill(meeting_days=[1]),
                organization_id=ORG,
            )


class TestListClasses:
    async def test_returns_rows_paired_with_their_catalog_course(self):
        course_id = str(uuid4())
        row = _klass(1, course_id)
        subject = _course("SCBA Operations")
        db = RecordingSession(
            [_one(_course(course_id=course_id)), _rows([(row, subject)])]
        )
        svc = CourseSyllabusService(db)

        result = await svc.list_classes(course_id, ORG)

        assert result == [(row, subject)]

    async def test_unknown_course_raises(self):
        db = RecordingSession([_one(None)])
        svc = CourseSyllabusService(db)
        with pytest.raises(ValueError, match="not found"):
            await svc.list_classes(uuid4(), ORG)
