"""
Tests for CourseCohortService — generating and running one cohort of a
multi-class course.

Covers the schedule preview (computed dates, roll warnings, room conflicts),
generation (one Event + TrainingSession per class, one transaction, pipeline
linkage, roster RSVPs), idempotent regeneration, and the management operations
(reschedule, cancel, shift, roster add/remove).

DB is mocked; no MySQL.
"""

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.models.event import EventRSVP
from app.models.training import (
    CohortClassStatus,
    CohortMemberStatus,
    CohortStatus,
    CourseClass,
    CourseCohort,
    CourseCohortClass,
    CourseCohortMember,
    TrainingCourse,
    TrainingType,
)
from app.schemas.course_cohort import (
    CohortAdHocClassCreate,
    CohortClassOverride,
    CohortClassReschedule,
    CohortMemberAdd,
    CohortSchedulePreviewRequest,
    CohortShiftRequest,
    CourseCohortCreate,
    CourseCohortUpdate,
)
from app.services.course_cohort_service import CourseCohortService

ORG = uuid4()
ACTOR = uuid4()


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    r.scalars.return_value.first.return_value = items[0] if items else None
    return r


def _rows(items):
    r = MagicMock()
    r.all.return_value = items
    return r


class RecordingSession:
    """Async session that returns queued results and records added objects."""

    def __init__(self, results=None):
        self._results = list(results or [])
        self.statements = []
        self.added = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()
        self.rollback = AsyncMock()

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()

    def added_of(self, cls):
        return [o for o in self.added if isinstance(o, cls)]


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


def _klass(sequence, course_id, offset, section=None, class_course_id=None):
    return CourseClass(
        id=str(uuid4()),
        organization_id=str(ORG),
        course_id=course_id,
        class_course_id=class_course_id or str(uuid4()),
        sequence=sequence,
        section_name=section,
        title=f"Class {sequence}",
        day_offset=offset,
        start_time="19:00",
        duration_minutes=180,
        credit_hours=3.0,
        is_required=True,
    )


def _cohort(course_id, program_id=None, **kw):
    cohort = CourseCohort(
        id=str(uuid4()),
        organization_id=str(ORG),
        course_id=course_id,
        name="Recruit School — Fall 2026",
        start_date=date(2026, 9, 8),
        status=CohortStatus.SCHEDULED,
        program_id=program_id,
        requires_rsvp=True,
        auto_create_records=True,
        date_roll_policy="none",
    )
    for key, value in kw.items():
        setattr(cohort, key, value)
    return cohort


def _cohort_class(cohort, sequence, start=None, event_id="evt-1", **kw):
    start = start or datetime(2026, 9, 8, 23, 0, tzinfo=timezone.utc)
    row = CourseCohortClass(
        id=str(uuid4()),
        organization_id=str(ORG),
        cohort_id=cohort.id,
        course_class_id=str(uuid4()),
        sequence=sequence,
        title=f"Class {sequence}",
        scheduled_start=start,
        scheduled_end=start + timedelta(hours=3),
        event_id=event_id,
        status=CohortClassStatus.SCHEDULED,
        credit_hours=3.0,
    )
    for key, value in kw.items():
        setattr(row, key, value)
    return row


def _session_stub(event_id="evt-1"):
    """Stand-in for the TrainingSession that create_training_session returns."""
    return MagicMock(id=str(uuid4()), event_id=event_id)


def _patch_session_service(sessions=None, error=None):
    """Patch TrainingSessionService so no Event/TrainingSession rows are needed."""
    created = list(sessions or [])

    async def _create(**kwargs):
        if error:
            return None, error
        return (created.pop(0) if created else _session_stub()), None

    service = MagicMock()
    service.create_training_session = AsyncMock(side_effect=_create)
    return (
        patch(
            "app.services.training_session_service.TrainingSessionService",
            return_value=service,
        ),
        service,
    )


class TestPreviewSchedule:
    async def test_resolves_every_offset_into_a_real_date(self):
        course = _course()
        syllabus = [
            (_klass(1, course.id, 0), _course("Orientation")),
            (_klass(2, course.id, 1), _course("SCBA")),
            (_klass(3, course.id, 3), _course("Ladders")),
        ]
        db = RecordingSession([_one(course), _rows(syllabus), _one("America/New_York")])
        svc = CourseCohortService(db)

        result = await svc.preview_schedule(
            CohortSchedulePreviewRequest(
                course_id=course.id, start_date=date(2026, 9, 8)
            ),
            ORG,
        )

        # "Class B the day after A, class C two days later" — exactly the shape
        # the officer described.
        assert [c["scheduled_start"].date() for c in result["classes"]] == [
            date(2026, 9, 8),
            date(2026, 9, 9),
            date(2026, 9, 11),
        ]
        # 19:00 EDT is 23:00 UTC.
        assert result["classes"][0]["scheduled_start"].hour == 23
        assert result["timezone"] == "America/New_York"
        assert result["course_name"] == "Recruit School"

    async def test_reports_a_roll_warning_per_class(self):
        course = _course()
        # Offset 4 from Tuesday 2026-09-08 lands on Saturday the 12th.
        syllabus = [(_klass(1, course.id, 4), _course("SCBA"))]
        db = RecordingSession([_one(course), _rows(syllabus), _one("America/New_York")])
        svc = CourseCohortService(db)

        result = await svc.preview_schedule(
            CohortSchedulePreviewRequest(
                course_id=course.id,
                start_date=date(2026, 9, 8),
                date_roll_policy="next_business_day",
            ),
            ORG,
        )

        assert result["classes"][0]["scheduled_start"].date() == date(2026, 9, 14)
        assert any("weekend" in w for w in result["classes"][0]["warnings"])

    async def test_flags_an_archived_catalog_course(self):
        course = _course()
        syllabus = [(_klass(1, course.id, 0), _course("Retired Class", active=False))]
        db = RecordingSession([_one(course), _rows(syllabus), _one("America/New_York")])
        svc = CourseCohortService(db)

        result = await svc.preview_schedule(
            CohortSchedulePreviewRequest(
                course_id=course.id, start_date=date(2026, 9, 8)
            ),
            ORG,
        )

        assert any("archived" in w for w in result["classes"][0]["warnings"])

    async def test_suggests_federal_holidays_inside_the_course_span(self):
        course = _course()
        syllabus = [
            (_klass(1, course.id, 0), _course("A")),
            (_klass(2, course.id, 60), _course("B")),
        ]
        db = RecordingSession([_one(course), _rows(syllabus), _one("America/New_York")])
        svc = CourseCohortService(db)

        result = await svc.preview_schedule(
            CohortSchedulePreviewRequest(
                course_id=course.id, start_date=date(2026, 9, 1)
            ),
            ORG,
        )

        # Labor Day 2026 falls inside a course running September into November.
        assert "2026-09-07" in result["suggested_blackout_dates"]

    async def test_creates_nothing(self):
        course = _course()
        db = RecordingSession(
            [
                _one(course),
                _rows([(_klass(1, course.id, 0), _course("A"))]),
                _one("America/New_York"),
            ]
        )
        svc = CourseCohortService(db)

        await svc.preview_schedule(
            CohortSchedulePreviewRequest(
                course_id=course.id, start_date=date(2026, 9, 8)
            ),
            ORG,
        )

        assert db.added == []
        assert db.commit.await_count == 0

    async def test_empty_syllabus_raises(self):
        course = _course()
        db = RecordingSession([_one(course), _rows([])])
        svc = CourseCohortService(db)

        with pytest.raises(ValueError, match="no classes"):
            await svc.preview_schedule(
                CohortSchedulePreviewRequest(
                    course_id=course.id, start_date=date(2026, 9, 8)
                ),
                ORG,
            )

    async def test_unknown_course_raises(self):
        db = RecordingSession([_one(None)])
        svc = CourseCohortService(db)

        with pytest.raises(ValueError, match="not found"):
            await svc.preview_schedule(
                CohortSchedulePreviewRequest(
                    course_id=uuid4(), start_date=date(2026, 9, 8)
                ),
                ORG,
            )


class TestCreateCohort:
    def _db_for_generation(self, course, syllabus, tz="America/New_York"):
        return RecordingSession([_one(course), _rows(syllabus), _one(tz)])

    async def test_generates_one_class_row_per_syllabus_row(self):
        course = _course()
        syllabus = [
            (_klass(1, course.id, 0), _course("Orientation")),
            (_klass(2, course.id, 1), _course("SCBA")),
            (_klass(3, course.id, 3), _course("Ladders")),
        ]
        db = self._db_for_generation(course, syllabus)
        patcher, session_service = _patch_session_service()
        svc = CourseCohortService(db)

        with patcher:
            cohort, warnings = await svc.create_cohort(
                CourseCohortCreate(
                    course_id=course.id,
                    name="Recruit School — Fall 2026",
                    start_date=date(2026, 9, 8),
                ),
                ORG,
                ACTOR,
            )

        classes = db.added_of(CourseCohortClass)
        assert len(classes) == 3
        assert [c.sequence for c in classes] == [1, 2, 3]
        assert [c.scheduled_start.date() for c in classes] == [
            date(2026, 9, 8),
            date(2026, 9, 9),
            date(2026, 9, 11),
        ]
        assert cohort.status == CohortStatus.SCHEDULED
        assert cohort.generated_at is not None
        assert warnings == []

    async def test_creates_an_event_and_session_per_class(self):
        course = _course()
        syllabus = [
            (_klass(1, course.id, 0), _course("Orientation")),
            (_klass(2, course.id, 1), _course("SCBA")),
        ]
        db = self._db_for_generation(course, syllabus)
        patcher, session_service = _patch_session_service(
            [_session_stub("evt-a"), _session_stub("evt-b")]
        )
        svc = CourseCohortService(db)

        with patcher:
            await svc.create_cohort(
                CourseCohortCreate(
                    course_id=course.id,
                    name="Fall 2026",
                    start_date=date(2026, 9, 8),
                ),
                ORG,
                ACTOR,
            )

        assert session_service.create_training_session.await_count == 2
        assert [c.event_id for c in db.added_of(CourseCohortClass)] == [
            "evt-a",
            "evt-b",
        ]

    async def test_generation_is_a_single_transaction(self):
        """Sessions are created with commit=False so a failure rolls back whole.

        Otherwise a syllabus that fails on class 8 would leave seven events on
        the department calendar with no cohort to manage them.
        """
        course = _course()
        syllabus = [(_klass(i, course.id, i - 1), _course(f"C{i}")) for i in (1, 2, 3)]
        db = self._db_for_generation(course, syllabus)
        patcher, session_service = _patch_session_service()
        svc = CourseCohortService(db)

        with patcher:
            await svc.create_cohort(
                CourseCohortCreate(
                    course_id=course.id, name="Fall", start_date=date(2026, 9, 8)
                ),
                ORG,
                ACTOR,
            )

        assert db.commit.await_count == 1
        for call in session_service.create_training_session.await_args_list:
            assert call.kwargs["commit"] is False

    async def test_per_class_date_override_wins(self):
        course = _course()
        klass = _klass(1, course.id, 0)
        db = self._db_for_generation(course, [(klass, _course("SCBA"))])
        patcher, _ = _patch_session_service()
        svc = CourseCohortService(db)
        moved = datetime(2026, 10, 1, 18, 0, tzinfo=timezone.utc)

        with patcher:
            await svc.create_cohort(
                CourseCohortCreate(
                    course_id=course.id,
                    name="Fall",
                    start_date=date(2026, 9, 8),
                    classes=[
                        CohortClassOverride(
                            course_class_id=klass.id,
                            scheduled_start=moved,
                            scheduled_end=moved + timedelta(hours=2),
                        )
                    ],
                ),
                ORG,
                ACTOR,
            )

        assert db.added_of(CourseCohortClass)[0].scheduled_start == moved

    async def test_skipped_classes_are_not_generated(self):
        course = _course()
        keep, drop = _klass(1, course.id, 0), _klass(2, course.id, 1)
        db = self._db_for_generation(
            course, [(keep, _course("A")), (drop, _course("B"))]
        )
        patcher, _ = _patch_session_service()
        svc = CourseCohortService(db)

        with patcher:
            await svc.create_cohort(
                CourseCohortCreate(
                    course_id=course.id,
                    name="Fall",
                    start_date=date(2026, 9, 8),
                    classes=[CohortClassOverride(course_class_id=drop.id, skip=True)],
                ),
                ORG,
                ACTOR,
            )

        classes = db.added_of(CourseCohortClass)
        assert len(classes) == 1
        # Sequences stay contiguous even though a syllabus row was skipped.
        assert classes[0].sequence == 1
        assert classes[0].course_class_id == keep.id

    async def test_a_failing_class_is_reported_not_fatal(self):
        course = _course()
        db = self._db_for_generation(
            course, [(_klass(1, course.id, 0), _course("SCBA"))]
        )
        patcher, _ = _patch_session_service(error="Location is already booked")
        svc = CourseCohortService(db)

        with patcher:
            cohort, warnings = await svc.create_cohort(
                CourseCohortCreate(
                    course_id=course.id, name="Fall", start_date=date(2026, 9, 8)
                ),
                ORG,
                ACTOR,
            )

        assert any("already booked" in w for w in warnings)
        # The class row still exists with no event, so regenerate can repair it.
        assert db.added_of(CourseCohortClass)[0].event_id is None

    async def test_empty_syllabus_raises_before_anything_is_written(self):
        course = _course()
        db = RecordingSession([_one(course), _rows([])])
        svc = CourseCohortService(db)

        with pytest.raises(ValueError, match="no classes"):
            await svc.create_cohort(
                CourseCohortCreate(
                    course_id=course.id, name="Fall", start_date=date(2026, 9, 8)
                ),
                ORG,
                ACTOR,
            )
        assert db.added == []
        assert db.commit.await_count == 0

    async def test_course_from_another_org_is_not_found(self):
        db = RecordingSession([_one(None)])
        svc = CourseCohortService(db)

        with pytest.raises(ValueError, match="not found"):
            await svc.create_cohort(
                CourseCohortCreate(
                    course_id=uuid4(), name="Fall", start_date=date(2026, 9, 8)
                ),
                ORG,
                ACTOR,
            )


class TestRosterOnGeneration:
    async def test_members_are_added_enrolled_and_rsvpd(self):
        course = _course()
        program_id = str(uuid4())
        user_a, user_b = uuid4(), uuid4()
        klass = _klass(1, course.id, 0)

        db = RecordingSession(
            [
                _one(course),  # course lookup
                _rows([(klass, _course("SCBA"))]),  # syllabus
                _one("America/New_York"),  # org timezone
                _one(program_id),  # assert_in_org: program
                _scalars(
                    [MagicMock(id=str(user_a)), MagicMock(id=str(user_b))]
                ),  # valid users
                _scalars([]),  # existing roster
                _scalars([MagicMock(id=str(uuid4()))]),  # existing enrolment (user a)
                _scalars([MagicMock(id=str(uuid4()))]),  # existing enrolment (user b)
                _scalars([_cohort_class(_cohort(course.id), 1)]),  # classes to invite
                _rows([]),  # existing RSVPs
            ]
        )
        patcher, _ = _patch_session_service()
        svc = CourseCohortService(db)

        with patcher:
            await svc.create_cohort(
                CourseCohortCreate(
                    course_id=course.id,
                    name="Fall",
                    start_date=date(2026, 9, 8),
                    program_id=program_id,
                    member_user_ids=[user_a, user_b],
                ),
                ORG,
                ACTOR,
            )

        members = db.added_of(CourseCohortMember)
        assert {m.user_id for m in members} == {str(user_a), str(user_b)}
        assert all(m.status == CohortMemberStatus.ACTIVE for m in members)
        # Two members × one class = two RSVPs, so the classes hit their calendars.
        assert len(db.added_of(EventRSVP)) == 2


class TestRegenerateMissing:
    async def test_only_classes_without_an_event_are_created(self):
        cohort = _cohort(str(uuid4()))
        pending = _cohort_class(cohort, 2, event_id=None)
        db = RecordingSession(
            [
                _one(cohort),
                _scalars([pending]),
                _one(None),  # class course lookup
                _scalars([]),  # roster
            ]
        )
        patcher, session_service = _patch_session_service([_session_stub("evt-new")])
        svc = CourseCohortService(db)

        with patcher:
            created, warnings = await svc.regenerate_missing(cohort.id, ORG, ACTOR)

        assert created == 1
        assert pending.event_id == "evt-new"
        assert session_service.create_training_session.await_count == 1

    async def test_rerunning_a_complete_cohort_creates_nothing(self):
        cohort = _cohort(str(uuid4()))
        # The query filters event_id IS NULL, so a fully generated cohort
        # returns no rows and nothing is created — regeneration is idempotent.
        db = RecordingSession([_one(cohort), _scalars([])])
        patcher, session_service = _patch_session_service()
        svc = CourseCohortService(db)

        with patcher:
            created, warnings = await svc.regenerate_missing(cohort.id, ORG, ACTOR)

        assert created == 0
        assert session_service.create_training_session.await_count == 0

    async def test_unknown_cohort_raises(self):
        db = RecordingSession([_one(None)])
        svc = CourseCohortService(db)
        with pytest.raises(ValueError, match="Cohort not found"):
            await svc.regenerate_missing(uuid4(), ORG, ACTOR)


class TestRescheduleAndCancel:
    async def test_reschedule_moves_the_class_and_its_event(self):
        cohort = _cohort(str(uuid4()))
        row = _cohort_class(cohort, 1)
        db = RecordingSession([_one(row)])
        svc = CourseCohortService(db)
        new_start = datetime(2026, 10, 5, 23, 0, tzinfo=timezone.utc)

        with patch(
            "app.services.course_cohort_service.EventService"
        ) as event_service_cls:
            event_service_cls.return_value.update_event = AsyncMock()
            updated = await svc.reschedule_class(
                row.id,
                CohortClassReschedule(
                    scheduled_start=new_start,
                    scheduled_end=new_start + timedelta(hours=3),
                ),
                ORG,
                ACTOR,
            )
            event_service_cls.return_value.update_event.assert_awaited_once()

        assert updated.scheduled_start == new_start

    async def test_reschedule_of_a_cancelled_class_is_rejected(self):
        cohort = _cohort(str(uuid4()))
        row = _cohort_class(cohort, 1, status=CohortClassStatus.CANCELLED)
        db = RecordingSession([_one(row)])
        svc = CourseCohortService(db)
        start = datetime(2026, 10, 5, 23, 0, tzinfo=timezone.utc)

        with pytest.raises(ValueError, match="cancelled"):
            await svc.reschedule_class(
                row.id,
                CohortClassReschedule(
                    scheduled_start=start, scheduled_end=start + timedelta(hours=1)
                ),
                ORG,
                ACTOR,
            )

    async def test_cancel_cancels_the_event_rather_than_deleting_it(self):
        cohort = _cohort(str(uuid4()))
        row = _cohort_class(cohort, 1)
        db = RecordingSession([_one(row)])
        svc = CourseCohortService(db)

        with patch(
            "app.services.course_cohort_service.EventService"
        ) as event_service_cls:
            event_service_cls.return_value.cancel_event = AsyncMock()
            updated = await svc.cancel_class(row.id, "Instructor ill", ORG, ACTOR)
            # Members who RSVP'd must see a cancellation, not a vanished event.
            event_service_cls.return_value.cancel_event.assert_awaited_once()

        assert updated.status == CohortClassStatus.CANCELLED
        assert updated.cancellation_reason == "Instructor ill"


class TestShiftRemaining:
    async def test_moves_each_class_by_the_requested_days(self):
        cohort = _cohort(str(uuid4()))
        first = _cohort_class(
            cohort, 1, start=datetime(2026, 10, 1, 23, 0, tzinfo=timezone.utc)
        )
        second = _cohort_class(
            cohort, 2, start=datetime(2026, 10, 3, 23, 0, tzinfo=timezone.utc)
        )
        db = RecordingSession([_one(cohort), _scalars([first, second])])
        svc = CourseCohortService(db)

        with patch(
            "app.services.course_cohort_service.EventService"
        ) as event_service_cls:
            event_service_cls.return_value.update_event = AsyncMock()
            moved = await svc.shift_remaining(
                cohort.id, CohortShiftRequest(days=7), ORG, ACTOR
            )

        assert moved == 2
        assert first.scheduled_start.date() == date(2026, 10, 8)
        assert second.scheduled_start.date() == date(2026, 10, 10)
        # Duration is preserved — the whole window slides.
        assert (first.scheduled_end - first.scheduled_start) == timedelta(hours=3)

    async def test_negative_days_pull_the_schedule_forward(self):
        cohort = _cohort(str(uuid4()))
        row = _cohort_class(
            cohort, 1, start=datetime(2026, 10, 8, 23, 0, tzinfo=timezone.utc)
        )
        db = RecordingSession([_one(cohort), _scalars([row])])
        svc = CourseCohortService(db)

        with patch(
            "app.services.course_cohort_service.EventService"
        ) as event_service_cls:
            event_service_cls.return_value.update_event = AsyncMock()
            await svc.shift_remaining(
                cohort.id, CohortShiftRequest(days=-2), ORG, ACTOR
            )

        assert row.scheduled_start.date() == date(2026, 10, 6)

    async def test_zero_days_is_rejected_by_the_schema(self):
        with pytest.raises(ValueError):
            CohortShiftRequest(days=0)


class TestRosterManagement:
    async def test_remove_member_is_a_soft_withdrawal(self):
        member = CourseCohortMember(
            id=str(uuid4()),
            organization_id=str(ORG),
            cohort_id=str(uuid4()),
            user_id=str(uuid4()),
            status=CohortMemberStatus.ACTIVE,
        )
        db = RecordingSession([_one(member)])
        svc = CourseCohortService(db)

        await svc.remove_member(member.cohort_id, member.user_id, ORG)

        # Credit already earned must survive a roster removal.
        assert member.status == CohortMemberStatus.WITHDRAWN
        assert member.withdrawn_at is not None

    async def test_remove_unknown_member_raises(self):
        db = RecordingSession([_one(None)])
        svc = CourseCohortService(db)
        with pytest.raises(ValueError, match="not on this cohort"):
            await svc.remove_member(uuid4(), uuid4(), ORG)

    async def test_existing_roster_members_are_not_duplicated(self):
        cohort = _cohort(str(uuid4()))
        user_id = uuid4()
        db = RecordingSession(
            [
                _one(cohort),
                _scalar(1),  # count before
                _scalars([MagicMock(id=str(user_id))]),  # valid users
                _scalars([str(user_id)]),  # already on the roster
                _scalar(1),  # count after
            ]
        )
        svc = CourseCohortService(db)

        added, warnings = await svc.add_members(
            cohort.id,
            CohortMemberAdd(user_ids=[user_id], enroll_in_program=False),
            ORG,
            ACTOR,
        )

        assert added == 0
        assert db.added_of(CourseCohortMember) == []

    async def test_a_member_from_another_org_is_reported_not_added(self):
        cohort = _cohort(str(uuid4()))
        db = RecordingSession(
            [
                _one(cohort),
                _scalar(0),
                _scalars([]),  # org-scoped user lookup finds nothing
                _scalars([]),
                _scalar(0),
            ]
        )
        svc = CourseCohortService(db)

        added, warnings = await svc.add_members(
            cohort.id,
            CohortMemberAdd(user_ids=[uuid4()], enroll_in_program=False),
            ORG,
            ACTOR,
        )

        assert added == 0
        assert any("not in this organization" in w for w in warnings)


class TestCancelCohort:
    async def test_cancels_the_cohort_and_its_remaining_classes(self):
        cohort = _cohort(str(uuid4()))
        first, second = _cohort_class(cohort, 1), _cohort_class(cohort, 2)
        db = RecordingSession([_one(cohort), _scalars([first, second])])
        svc = CourseCohortService(db)

        with patch(
            "app.services.course_cohort_service.EventService"
        ) as event_service_cls:
            event_service_cls.return_value.cancel_event = AsyncMock()
            result = await svc.cancel_cohort(cohort.id, "Class cancelled", ORG, ACTOR)
            assert event_service_cls.return_value.cancel_event.await_count == 2

        assert result.status == CohortStatus.CANCELLED
        assert all(c.status == CohortClassStatus.CANCELLED for c in (first, second))


class TestUpdateCohort:
    async def test_blackout_dates_are_reassigned_not_mutated_in_place(self):
        """Plain JSON columns do not track in-place mutation.

        Assigning a fresh list is what makes SQLAlchemy emit the UPDATE; an
        in-place edit of the existing list would silently no-op.
        """
        cohort = _cohort(str(uuid4()), blackout_dates=["2026-11-26"])
        original = cohort.blackout_dates
        db = RecordingSession([_one(cohort)])
        svc = CourseCohortService(db)

        updated = await svc.update_cohort(
            cohort.id,
            CourseCohortUpdate(blackout_dates=["2026-11-26", "2026-12-25"]),
            ORG,
        )

        assert updated.blackout_dates == ["2026-11-26", "2026-12-25"]
        assert updated.blackout_dates is not original

    async def test_status_string_is_coerced_to_the_enum(self):
        cohort = _cohort(str(uuid4()))
        db = RecordingSession([_one(cohort)])
        svc = CourseCohortService(db)

        updated = await svc.update_cohort(
            cohort.id, CourseCohortUpdate(status="in_progress"), ORG
        )

        assert updated.status == CohortStatus.IN_PROGRESS

    async def test_unknown_cohort_raises(self):
        db = RecordingSession([_one(None)])
        svc = CourseCohortService(db)
        with pytest.raises(ValueError, match="Cohort not found"):
            await svc.update_cohort(uuid4(), CourseCohortUpdate(name="X"), ORG)


class TestAdHocClass:
    async def test_adds_a_class_that_was_never_on_the_syllabus(self):
        cohort = _cohort(str(uuid4()))
        subject = _course("Make-up SCBA")
        start = datetime(2026, 11, 2, 23, 0, tzinfo=timezone.utc)
        db = RecordingSession(
            [
                _one(cohort),
                _one(subject),
                _scalar(3),  # existing class count
                _scalar(3),  # max sequence
                _scalars([]),  # roster to invite
            ]
        )
        patcher, _ = _patch_session_service([_session_stub("evt-adhoc")])
        svc = CourseCohortService(db)

        with patcher:
            created = await svc.add_ad_hoc_class(
                cohort.id,
                CohortAdHocClassCreate(
                    title="Make-up SCBA",
                    class_course_id=subject.id,
                    scheduled_start=start,
                    scheduled_end=start + timedelta(hours=2),
                ),
                ORG,
                ACTOR,
            )

        # No syllabus row: this class exists only for this cohort.
        assert created.course_class_id is None
        assert created.sequence == 4
        assert created.event_id == "evt-adhoc"

    async def test_rejects_a_course_from_another_org(self):
        cohort = _cohort(str(uuid4()))
        db = RecordingSession([_one(cohort), _one(None)])
        svc = CourseCohortService(db)
        start = datetime(2026, 11, 2, 23, 0, tzinfo=timezone.utc)

        with pytest.raises(ValueError, match="Invalid class course"):
            await svc.add_ad_hoc_class(
                cohort.id,
                CohortAdHocClassCreate(
                    title="X",
                    class_course_id=uuid4(),
                    scheduled_start=start,
                    scheduled_end=start + timedelta(hours=1),
                ),
                ORG,
                ACTOR,
            )
