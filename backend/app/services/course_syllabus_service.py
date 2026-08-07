"""
Course Syllabus Service

Business logic for the syllabus of a multi-class course: the ordered list of
classes that make up something like a recruit school, each described relative
to the course start rather than on a fixed calendar date.

The syllabus is a *template*. It is turned into real dated events only when a
cohort is generated from it (see ``course_cohort_service``).
"""

from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.location import Location
from app.models.training import (
    CourseClass,
    ProgramPhase,
    TrainingCategory,
    TrainingCourse,
    TrainingRequirement,
)
from app.models.user import User
from app.schemas.course_cohort import (
    MAX_CLASSES_PER_COURSE,
    CourseClassAutofill,
    CourseClassCreate,
    CourseClassUpdate,
)
from app.utils.org_scoping import assert_in_org
from app.utils.scheduling_dates import offsets_from_meeting_pattern


class CourseSyllabusService:
    """Service for managing a course's class syllabus"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_course(
        self, course_id: UUID, organization_id: UUID
    ) -> Optional[TrainingCourse]:
        """Fetch a course, always scoped to the caller's organization."""
        result = await self.db.execute(
            select(TrainingCourse).where(
                TrainingCourse.id == str(course_id),
                TrainingCourse.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def _get_class(
        self, class_id: UUID, organization_id: UUID
    ) -> Optional[CourseClass]:
        """Fetch a syllabus row, always scoped to the caller's organization."""
        result = await self.db.execute(
            select(CourseClass).where(
                CourseClass.id == str(class_id),
                CourseClass.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def _validate_references(self, data: object, organization_id: UUID) -> None:
        """Reject any client-supplied foreign key that is not in the caller's org.

        Raises ValueError, which the endpoint layer turns into a 400 via
        ``safe_error_detail``.
        """
        optional_refs = (
            ("instructor_id", User, "instructor"),
            ("location_id", Location, "location"),
            ("category_id", TrainingCategory, "training category"),
            ("requirement_id", TrainingRequirement, "training requirement"),
        )
        for attr, model, label in optional_refs:
            value = getattr(data, attr, None)
            if value:
                await assert_in_org(self.db, model, value, organization_id, label=label)

        # ProgramPhase has no organization_id of its own; it is reached through
        # its program, so scope it that way rather than via assert_in_org.
        phase_id = getattr(data, "phase_id", None)
        if phase_id:
            from app.models.training import TrainingProgram

            result = await self.db.execute(
                select(ProgramPhase.id)
                .join(TrainingProgram, ProgramPhase.program_id == TrainingProgram.id)
                .where(
                    ProgramPhase.id == str(phase_id),
                    TrainingProgram.organization_id == str(organization_id),
                )
            )
            if result.scalar_one_or_none() is None:
                raise ValueError("Invalid program phase")

    async def list_classes(
        self, course_id: UUID, organization_id: UUID
    ) -> List[Tuple[CourseClass, Optional[TrainingCourse]]]:
        """Return the syllabus in order, each row paired with its catalog course."""
        course = await self._get_course(course_id, organization_id)
        if not course:
            raise ValueError("Training course not found")

        # The org predicate belongs on the JOIN, not the WHERE: this is an
        # outer join, so a row whose class_course_id somehow pointed out of the
        # org yields NULL for the course (name/code simply absent) instead of
        # rendering another organization's catalog entry into the response.
        # add_class validates the FK in-org, so this is defence in depth against
        # the MM-1 shape rather than a live leak.
        result = await self.db.execute(
            select(CourseClass, TrainingCourse)
            .outerjoin(
                TrainingCourse,
                (CourseClass.class_course_id == TrainingCourse.id)
                & (TrainingCourse.organization_id == str(organization_id)),
            )
            .where(
                CourseClass.course_id == str(course_id),
                CourseClass.organization_id == str(organization_id),
            )
            .order_by(CourseClass.sequence)
        )
        return [(row[0], row[1]) for row in result.all()]

    async def add_class(
        self,
        course_id: UUID,
        data: CourseClassCreate,
        organization_id: UUID,
        created_by: UUID,
    ) -> CourseClass:
        """Append (or insert) a class on the syllabus.

        Defaults title, credit hours, and duration from the linked catalog
        course so the officer only fills in what differs.
        """
        course = await self._get_course(course_id, organization_id)
        if not course:
            raise ValueError("Training course not found")

        class_course = await self._get_course(data.class_course_id, organization_id)
        if not class_course:
            raise ValueError("Invalid class course")
        if str(class_course.id) == str(course_id):
            raise ValueError("A course cannot contain itself as one of its classes")

        await self._validate_references(data, organization_id)

        count_result = await self.db.execute(
            select(func.count(CourseClass.id)).where(
                CourseClass.course_id == str(course_id)
            )
        )
        existing_count = count_result.scalar() or 0
        if existing_count >= MAX_CLASSES_PER_COURSE:
            raise ValueError(
                f"A course cannot have more than {MAX_CLASSES_PER_COURSE} classes"
            )

        max_result = await self.db.execute(
            select(func.max(CourseClass.sequence)).where(
                CourseClass.course_id == str(course_id)
            )
        )
        next_sequence = (max_result.scalar() or 0) + 1

        course_class = CourseClass(
            organization_id=str(organization_id),
            course_id=str(course_id),
            class_course_id=str(data.class_course_id),
            sequence=next_sequence,
            section_name=data.section_name,
            title=data.title or class_course.name,
            description=data.description,
            day_offset=data.day_offset,
            start_time=data.start_time,
            duration_minutes=data.duration_minutes,
            credit_hours=(
                data.credit_hours
                if data.credit_hours is not None
                else class_course.credit_hours
            ),
            instructor_id=str(data.instructor_id) if data.instructor_id else None,
            instructor=data.instructor or class_course.instructor,
            location_id=str(data.location_id) if data.location_id else None,
            location=data.location,
            category_id=str(data.category_id) if data.category_id else None,
            requirement_id=str(data.requirement_id) if data.requirement_id else None,
            phase_id=str(data.phase_id) if data.phase_id else None,
            is_required=data.is_required,
            counts_toward_certification=data.counts_toward_certification,
            created_by=str(created_by),
        )
        self.db.add(course_class)
        await self.db.flush()

        # An explicit position means the officer wants it inserted mid-syllabus.
        if data.sequence and data.sequence < next_sequence:
            await self._move_to_position(course_id, course_class, data.sequence)

        await self.db.commit()
        await self.db.refresh(course_class)
        return course_class

    async def _move_to_position(
        self, course_id: UUID, course_class: CourseClass, position: int
    ) -> None:
        """Renumber the syllabus so ``course_class`` sits at ``position``."""
        result = await self.db.execute(
            select(CourseClass)
            .where(CourseClass.course_id == str(course_id))
            .order_by(CourseClass.sequence)
        )
        rows = [c for c in result.scalars().all() if c.id != course_class.id]
        index = max(0, min(position - 1, len(rows)))
        rows.insert(index, course_class)
        await self._renumber(rows)

    async def _renumber(self, rows: List[CourseClass]) -> None:
        """Assign contiguous 1..N sequences without tripping the unique index.

        The two-pass shift into a temporary range is required because
        ``uq_course_class_sequence`` is checked per statement, so writing the
        final numbers directly would collide with rows not yet moved.
        """
        for offset, row in enumerate(rows, start=1):
            row.sequence = -offset
        await self.db.flush()
        for offset, row in enumerate(rows, start=1):
            row.sequence = offset
        await self.db.flush()

    async def update_class(
        self, class_id: UUID, data: CourseClassUpdate, organization_id: UUID
    ) -> CourseClass:
        """Patch a syllabus row."""
        course_class = await self._get_class(class_id, organization_id)
        if not course_class:
            raise ValueError("Class not found")

        if data.class_course_id:
            class_course = await self._get_course(data.class_course_id, organization_id)
            if not class_course:
                raise ValueError("Invalid class course")
            if str(class_course.id) == str(course_class.course_id):
                raise ValueError("A course cannot contain itself as one of its classes")

        await self._validate_references(data, organization_id)

        updates = data.model_dump(exclude_unset=True)
        for field, value in updates.items():
            if field in (
                "class_course_id",
                "instructor_id",
                "location_id",
                "category_id",
                "requirement_id",
                "phase_id",
            ):
                setattr(course_class, field, str(value) if value else None)
            else:
                setattr(course_class, field, value)

        await self.db.commit()
        await self.db.refresh(course_class)
        return course_class

    async def delete_class(self, class_id: UUID, organization_id: UUID) -> None:
        """Remove a syllabus row and close the gap in the ordering.

        Already-generated cohorts are unaffected: their ``course_class_id``
        is SET NULL, so the cohort keeps its own record of the class.
        """
        course_class = await self._get_class(class_id, organization_id)
        if not course_class:
            raise ValueError("Class not found")

        course_id = course_class.course_id
        await self.db.delete(course_class)
        await self.db.flush()

        result = await self.db.execute(
            select(CourseClass)
            .where(CourseClass.course_id == course_id)
            .order_by(CourseClass.sequence)
        )
        await self._renumber(list(result.scalars().all()))
        await self.db.commit()

    async def reorder_classes(
        self, course_id: UUID, class_ids: List[UUID], organization_id: UUID
    ) -> List[CourseClass]:
        """Reorder the syllabus to exactly the given sequence of class ids."""
        course = await self._get_course(course_id, organization_id)
        if not course:
            raise ValueError("Training course not found")

        result = await self.db.execute(
            select(CourseClass).where(
                CourseClass.course_id == str(course_id),
                CourseClass.organization_id == str(organization_id),
            )
        )
        existing = {c.id: c for c in result.scalars().all()}
        requested = [str(cid) for cid in class_ids]

        if set(requested) != set(existing.keys()) or len(requested) != len(existing):
            raise ValueError("Reorder must list every class in the course exactly once")

        await self._renumber([existing[cid] for cid in requested])
        await self.db.commit()

        refreshed = await self.db.execute(
            select(CourseClass)
            .where(CourseClass.course_id == str(course_id))
            .order_by(CourseClass.sequence)
        )
        return list(refreshed.scalars().all())

    async def autofill_offsets(
        self, course_id: UUID, data: CourseClassAutofill, organization_id: UUID
    ) -> List[CourseClass]:
        """Recompute every class's ``day_offset`` from a weekly meeting pattern.

        "Fifteen classes, Tuesdays and Thursdays" becomes offsets 1, 3, 8, 10, …
        counted from the course start weekday. Times and durations are only
        overwritten when the caller supplies defaults.
        """
        course = await self._get_course(course_id, organization_id)
        if not course:
            raise ValueError("Training course not found")

        result = await self.db.execute(
            select(CourseClass)
            .where(
                CourseClass.course_id == str(course_id),
                CourseClass.organization_id == str(organization_id),
            )
            .order_by(CourseClass.sequence)
        )
        rows = list(result.scalars().all())
        if not rows:
            raise ValueError("This course has no classes to schedule yet")

        offsets = offsets_from_meeting_pattern(
            class_count=len(rows),
            meeting_days=data.meeting_days,
            start_weekday=data.start_weekday,
        )
        for row, offset in zip(rows, offsets):
            row.day_offset = offset
            if data.default_start_time:
                row.start_time = data.default_start_time
            if data.default_duration_minutes:
                row.duration_minutes = data.default_duration_minutes

        await self.db.commit()
        return rows
