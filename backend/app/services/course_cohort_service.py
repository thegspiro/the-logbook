"""
Course Cohort Service

Turns a course syllabus into a real, running class schedule.

A cohort is one run of a multi-class course — "Recruit School — Fall 2026",
starting 2026-09-08. Generating it walks the course's syllabus, converts each
class's relative timing into concrete UTC datetimes, and creates an Event plus a
linked TrainingSession for each. Students then see the classes on their
calendar, check in through the existing QR flow, and the resulting hours feed
the training pipeline through machinery that already exists.

Two design points worth knowing before editing this file:

* **The cohort class row is the stable identity.** The Event and TrainingSession
  are its current realization. Keeping them separate is what lets a class be
  rescheduled or cancelled without losing the cohort's record of it, and what
  makes regeneration idempotent (see ``uq_cohort_class_source``).
* **Generation is one transaction.** Every session is created with
  ``commit=False`` so a failure half-way cannot leave a cohort with seven of
  fifteen classes booked.
"""

import copy
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import EventRSVP
from app.models.location import Location
from app.models.training import (
    CohortClassStatus,
    CohortMemberStatus,
    CohortStatus,
    CourseClass,
    CourseCohort,
    CourseCohortClass,
    CourseCohortMember,
    ProgramEnrollment,
    ProgramPhase,
    TrainingCategory,
    TrainingCourse,
    TrainingProgram,
    TrainingRequirement,
    TrainingSession,
)
from app.models.user import Organization, User
from app.schemas.course_cohort import (
    CohortAdHocClassCreate,
    CohortClassReschedule,
    CohortMemberAdd,
    CohortSchedulePreviewRequest,
    CohortShiftRequest,
    CourseCohortCreate,
    CourseCohortUpdate,
)
from app.schemas.event import EventUpdate
from app.schemas.training_program import ProgramEnrollmentCreate
from app.schemas.training_session import TrainingSessionCreate
from app.services.event_service import EventService
from app.services.location_service import LocationService
from app.utils.org_scoping import assert_in_org
from app.utils.scheduling_dates import (
    DEFAULT_TIMEZONE,
    resolve_class_datetimes,
    us_federal_holidays_between,
)

# Bounds the generation transaction. A syllabus longer than this is a data-entry
# mistake, not a course.
MAX_GENERATED_CLASSES = 200


def _counts_toward_certification(value: Optional[bool]) -> bool:
    """Resolve the certification flag, treating an unset value as "counts".

    SQLAlchemy column defaults are applied at INSERT, so a row that has not
    been flushed yet reads ``None`` rather than the column's ``True``. Copying
    that ``None`` straight onto the session payload would fail validation, so
    the default is applied here instead of relying on the column.
    """
    return True if value is None else bool(value)


class CourseCohortService:
    """Service for generating and managing course cohorts"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── lookups (all org-scoped) ─────────────────────────────────────

    async def _get_org_timezone(self, organization_id: UUID) -> str:
        """The organization's IANA timezone, used to resolve wall-clock times."""
        result = await self.db.execute(
            select(Organization.timezone).where(Organization.id == str(organization_id))
        )
        return result.scalar_one_or_none() or DEFAULT_TIMEZONE

    async def _get_course(
        self, course_id: UUID, organization_id: UUID
    ) -> Optional[TrainingCourse]:
        result = await self.db.execute(
            select(TrainingCourse).where(
                TrainingCourse.id == str(course_id),
                TrainingCourse.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def get_cohort(
        self, cohort_id: UUID, organization_id: UUID
    ) -> Optional[CourseCohort]:
        result = await self.db.execute(
            select(CourseCohort).where(
                CourseCohort.id == str(cohort_id),
                CourseCohort.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def _get_cohort_class(
        self, cohort_class_id: UUID, organization_id: UUID
    ) -> Optional[CourseCohortClass]:
        result = await self.db.execute(
            select(CourseCohortClass).where(
                CourseCohortClass.id == str(cohort_class_id),
                CourseCohortClass.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def _syllabus(
        self, course_id: UUID, organization_id: UUID
    ) -> List[Tuple[CourseClass, Optional[TrainingCourse]]]:
        # Org predicate on the JOIN — see the matching note in
        # course_syllabus_service.list_classes. Keeps a foreign catalog course
        # out of the generated cohort's class titles.
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
                CourseClass.active.is_(True),
            )
            .order_by(CourseClass.sequence)
        )
        return [(row[0], row[1]) for row in result.all()]

    # ── preview ──────────────────────────────────────────────────────

    async def preview_schedule(
        self, request: CohortSchedulePreviewRequest, organization_id: UUID
    ) -> Dict[str, Any]:
        """Compute the dates a cohort would get, without creating anything.

        Read-only by design: the officer sees every computed date, any date that
        had to move, and any room conflict *before* fifteen events land on the
        department calendar.
        """
        course = await self._get_course(request.course_id, organization_id)
        if not course:
            raise ValueError("Training course not found")

        syllabus = await self._syllabus(request.course_id, organization_id)
        if not syllabus:
            raise ValueError("This course has no classes on its syllabus yet")

        tz_name = await self._get_org_timezone(organization_id)
        location_service = LocationService(self.db)

        classes: List[Dict[str, Any]] = []
        warnings: List[str] = []
        last_date: Optional[date] = None

        for course_class, class_course in syllabus:
            start_utc, end_utc, roll_warning = resolve_class_datetimes(
                start_date=request.start_date,
                day_offset=course_class.day_offset,
                start_time=course_class.start_time,
                duration_minutes=course_class.duration_minutes,
                tz_name=tz_name,
                roll_policy=request.date_roll_policy,
                meeting_days=request.meeting_days,
                blackout_dates=request.blackout_dates,
                default_start_time=request.default_start_time,
                default_duration_minutes=request.default_duration_minutes,
            )

            class_warnings: List[str] = []
            if roll_warning:
                class_warnings.append(roll_warning)
            if class_course is not None and class_course.active is False:
                class_warnings.append(
                    f'The course "{class_course.name}" is archived — '
                    "reactivate it or pick another course."
                )

            # Only classes with a room of their own can be conflict-checked
            # here — the preview request carries no cohort-level location. A
            # clash on a cohort-wide room surfaces at generation, where
            # create_training_session runs the same check and reports it as a
            # per-class warning.
            location_id = course_class.location_id
            if location_id:
                overlapping = await location_service.check_overlapping_events(
                    location_id=location_id,
                    organization_id=str(organization_id),
                    start_datetime=start_utc,
                    end_datetime=end_utc,
                )
                if overlapping:
                    titles = ", ".join(f'"{e.title}"' for e in overlapping[:3])
                    class_warnings.append(f"Location already booked: {titles}")

            classes.append(
                {
                    "course_class_id": course_class.id,
                    "sequence": course_class.sequence,
                    "title": course_class.title
                    or (class_course.name if class_course else "Class"),
                    "class_course_name": class_course.name if class_course else None,
                    "section_name": course_class.section_name,
                    "scheduled_start": start_utc,
                    "scheduled_end": end_utc,
                    "credit_hours": course_class.credit_hours,
                    "instructor": course_class.instructor,
                    "warnings": class_warnings,
                }
            )
            local_date = start_utc.date()
            if last_date is None or local_date > last_date:
                last_date = local_date

        if len(classes) > MAX_GENERATED_CLASSES:
            warnings.append(
                f"Only the first {MAX_GENERATED_CLASSES} classes can be generated."
            )

        suggested = us_federal_holidays_between(
            request.start_date, last_date or request.start_date
        )

        return {
            "course_id": course.id,
            "course_name": course.name,
            "start_date": request.start_date,
            "timezone": tz_name,
            "classes": classes,
            "suggested_blackout_dates": [d.isoformat() for d in suggested],
            "warnings": warnings,
        }

    # ── generation ───────────────────────────────────────────────────

    async def create_cohort(
        self,
        data: CourseCohortCreate,
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[CourseCohort, List[str]]:
        """Generate a cohort: dated classes, optional pipeline, and a roster.

        Everything happens under one transaction. Returns the cohort plus any
        non-fatal warnings (a member who could not be enrolled, a room clash the
        officer chose to accept) so the UI can surface them without failing the
        whole generation.
        """
        course = await self._get_course(data.course_id, organization_id)
        if not course:
            raise ValueError("Training course not found")

        syllabus = await self._syllabus(data.course_id, organization_id)
        if not syllabus:
            raise ValueError("This course has no classes on its syllabus yet")
        if len(syllabus) > MAX_GENERATED_CLASSES:
            raise ValueError(
                f"A cohort cannot generate more than {MAX_GENERATED_CLASSES} classes"
            )

        if data.location_id:
            await assert_in_org(
                self.db, Location, data.location_id, organization_id, label="location"
            )
        if data.program_id:
            await assert_in_org(
                self.db,
                TrainingProgram,
                data.program_id,
                organization_id,
                label="training program",
            )

        warnings: List[str] = []
        tz_name = await self._get_org_timezone(organization_id)
        overrides = {str(o.course_class_id): o for o in (data.classes or [])}

        program_id: Optional[str] = str(data.program_id) if data.program_id else None
        phase_by_section: Dict[str, str] = {}
        requirement_by_class: Dict[str, str] = {}

        if not program_id and data.generate_program:
            program_id, phase_by_section, requirement_by_class = (
                await self._generate_program(
                    course=course,
                    cohort_name=data.name,
                    syllabus=syllabus,
                    organization_id=organization_id,
                    created_by=created_by,
                )
            )
            # Remember the pipeline on the course so the next cohort reuses it
            # instead of building a duplicate.
            if program_id and not course.program_id:
                course.program_id = program_id

        cohort = CourseCohort(
            organization_id=str(organization_id),
            course_id=str(data.course_id),
            name=data.name,
            code=data.code,
            description=data.description,
            start_date=data.start_date,
            status=CohortStatus.SCHEDULED,
            program_id=program_id,
            meeting_days=data.meeting_days,
            default_start_time=data.default_start_time,
            default_duration_minutes=data.default_duration_minutes,
            date_roll_policy=data.date_roll_policy,
            blackout_dates=data.blackout_dates,
            location_id=str(data.location_id) if data.location_id else None,
            location=data.location,
            requires_rsvp=data.requires_rsvp,
            auto_create_records=data.auto_create_records,
            notes=data.notes,
            generated_at=datetime.now(timezone.utc),
            generated_by=str(created_by),
            created_by=str(created_by),
        )
        self.db.add(cohort)
        await self.db.flush()

        sequence = 0
        for course_class, class_course in syllabus:
            override = overrides.get(str(course_class.id))
            if override and override.skip:
                continue

            sequence += 1
            start_utc, end_utc, _ = resolve_class_datetimes(
                start_date=data.start_date,
                day_offset=course_class.day_offset,
                start_time=course_class.start_time,
                duration_minutes=course_class.duration_minutes,
                tz_name=tz_name,
                roll_policy=data.date_roll_policy,
                meeting_days=data.meeting_days,
                blackout_dates=data.blackout_dates,
                default_start_time=data.default_start_time,
                default_duration_minutes=data.default_duration_minutes,
            )
            if override and override.scheduled_start:
                start_utc = override.scheduled_start
                end_utc = override.scheduled_end or (
                    start_utc + timedelta(minutes=course_class.duration_minutes or 60)
                )

            instructor_id = course_class.instructor_id
            if override and override.instructor_id:
                await assert_in_org(
                    self.db,
                    User,
                    override.instructor_id,
                    organization_id,
                    label="instructor",
                )
                instructor_id = str(override.instructor_id)
            location_id = course_class.location_id or (
                str(data.location_id) if data.location_id else None
            )
            if override and override.location_id:
                await assert_in_org(
                    self.db,
                    Location,
                    override.location_id,
                    organization_id,
                    label="location",
                )
                location_id = str(override.location_id)

            requirement_id = course_class.requirement_id or requirement_by_class.get(
                str(course_class.id)
            )
            phase_id = course_class.phase_id or phase_by_section.get(
                course_class.section_name or ""
            )

            cohort_class = CourseCohortClass(
                organization_id=str(organization_id),
                cohort_id=cohort.id,
                course_class_id=course_class.id,
                sequence=sequence,
                title=course_class.title
                or (class_course.name if class_course else "Class"),
                description=course_class.description,
                scheduled_start=start_utc,
                scheduled_end=end_utc,
                status=CohortClassStatus.SCHEDULED,
                class_course_id=course_class.class_course_id,
                credit_hours=course_class.credit_hours,
                instructor_id=instructor_id,
                instructor=course_class.instructor,
                location_id=location_id,
                location=course_class.location or data.location,
                category_id=course_class.category_id,
                requirement_id=requirement_id,
                phase_id=phase_id,
                counts_toward_certification=_counts_toward_certification(
                    course_class.counts_toward_certification
                ),
                cohort=cohort,
            )
            self.db.add(cohort_class)
            await self.db.flush()

            session, error = await self._create_session_for_class(
                cohort=cohort,
                cohort_class=cohort_class,
                class_course=class_course,
                organization_id=organization_id,
                created_by=created_by,
            )
            if error:
                warnings.append(f"{cohort_class.title}: {error}")
            elif session is not None:
                cohort_class.training_session_id = session.id
                cohort_class.event_id = session.event_id

        member_warnings = await self._add_members(
            cohort=cohort,
            user_ids=list(data.member_user_ids or []),
            organization_id=organization_id,
            actor_id=created_by,
            enroll_in_program=True,
            invite_to_events=True,
            future_only=False,
        )
        warnings.extend(member_warnings)

        await self.db.commit()
        await self.db.refresh(cohort)
        return cohort, warnings

    async def _create_session_for_class(
        self,
        cohort: CourseCohort,
        cohort_class: CourseCohortClass,
        class_course: Optional[TrainingCourse],
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[Optional[TrainingSession], Optional[str]]:
        """Create the Event + TrainingSession backing one cohort class.

        Delegates to TrainingSessionService so this path inherits the existing
        validation, location double-booking check, check-in window defaults, and
        pipeline linkage rather than duplicating them.
        """
        # Imported here to avoid a circular import: TrainingSessionService pulls
        # in EventService, which this module also uses.
        from app.services.training_session_service import TrainingSessionService

        training_type = (
            class_course.training_type.value
            if class_course and class_course.training_type
            else "continuing_education"
        )
        credit_hours = cohort_class.credit_hours
        if credit_hours is None and class_course is not None:
            credit_hours = class_course.credit_hours
        if credit_hours is None:
            # Fall back to the scheduled duration so attendance still credits
            # something sensible rather than zero hours.
            span = cohort_class.scheduled_end - cohort_class.scheduled_start
            credit_hours = round(span.total_seconds() / 3600.0, 2)

        payload = TrainingSessionCreate(
            title=f"{cohort.name}: {cohort_class.title}",
            description=cohort_class.description,
            location_id=cohort_class.location_id,
            location=cohort_class.location,
            start_datetime=cohort_class.scheduled_start,
            end_datetime=cohort_class.scheduled_end,
            requires_rsvp=cohort.requires_rsvp,
            is_mandatory=True,
            use_existing_course=bool(cohort_class.class_course_id),
            course_id=cohort_class.class_course_id,
            category_id=cohort_class.category_id,
            program_id=cohort.program_id,
            phase_id=cohort_class.phase_id,
            requirement_id=cohort_class.requirement_id,
            course_name=cohort_class.title,
            training_type=training_type,
            credit_hours=credit_hours,
            instructor=cohort_class.instructor,
            instructor_id=cohort_class.instructor_id,
            expiration_months=(
                class_course.expiration_months if class_course else None
            ),
            counts_toward_certification=_counts_toward_certification(
                cohort_class.counts_toward_certification
            ),
            auto_create_records=cohort.auto_create_records,
        )

        service = TrainingSessionService(self.db)
        return await service.create_training_session(
            session_data=payload,
            organization_id=organization_id,
            created_by=created_by,
            commit=False,
        )

    async def _generate_program(
        self,
        course: TrainingCourse,
        cohort_name: str,
        syllabus: Sequence[Tuple[CourseClass, Optional[TrainingCourse]]],
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[Optional[str], Dict[str, str], Dict[str, str]]:
        """Build a pipeline whose phases mirror the syllabus's sections.

        Each class becomes a ``courses`` requirement satisfied by that class's
        catalog course, so the existing compliance evaluator measures progress
        with no bespoke logic. Classes with no section land in a single default
        phase, which keeps a flat fifteen-class syllabus working.

        Returns ``(program_id, phase_id_by_section, requirement_id_by_class_id)``.
        """
        from app.schemas.training_program import (
            ProgramBuildPhaseInput,
            ProgramBuildRequest,
            ProgramBuildRequirementInput,
            TrainingProgramCreate,
        )
        from app.services.training_program_service import TrainingProgramService

        sections: List[str] = []
        for course_class, _ in syllabus:
            section = course_class.section_name or "Coursework"
            if section not in sections:
                sections.append(section)

        phases: List[ProgramBuildPhaseInput] = []
        for index, section in enumerate(sections, start=1):
            requirements = [
                ProgramBuildRequirementInput(
                    name=(
                        course_class.title
                        or (class_course.name if class_course else "Class")
                    ),
                    description=course_class.description,
                    requirement_type="courses",
                    frequency="one_time",
                    required_courses=[str(course_class.class_course_id)],
                    is_required=course_class.is_required,
                    sort_order=order,
                )
                for order, (course_class, class_course) in enumerate(
                    [
                        (cc, lc)
                        for cc, lc in syllabus
                        if (cc.section_name or "Coursework") == section
                    ]
                )
            ]
            phases.append(
                ProgramBuildPhaseInput(
                    phase_number=index,
                    name=section,
                    requirements=requirements,
                )
            )

        payload = ProgramBuildRequest(
            program=TrainingProgramCreate(
                name=f"{course.name} Pipeline",
                description=(
                    f"Generated from the {course.name} syllabus for {cohort_name}."
                ),
                structure_type="phases",
            ),
            phases=phases,
        )

        service = TrainingProgramService(self.db)
        program, error = await service.build_program(
            payload=payload,
            organization_id=organization_id,
            created_by=created_by,
        )
        if error or program is None:
            raise ValueError(error or "Could not build the training pipeline")

        # Map the generated phases/requirements back onto the syllabus so each
        # generated session carries the right pipeline linkage.
        from app.models.training import ProgramPhase, ProgramRequirement
        from app.models.training import TrainingRequirement as ReqModel

        phase_result = await self.db.execute(
            select(ProgramPhase).where(ProgramPhase.program_id == program.id)
        )
        phase_by_section = {p.name: p.id for p in phase_result.scalars().all()}

        req_result = await self.db.execute(
            select(ReqModel, ProgramRequirement)
            .join(ProgramRequirement, ProgramRequirement.requirement_id == ReqModel.id)
            .where(ProgramRequirement.program_id == program.id)
        )
        requirement_by_course: Dict[str, str] = {}
        for requirement, _link in req_result.all():
            for course_id in requirement.required_courses or []:
                requirement_by_course.setdefault(str(course_id), requirement.id)

        requirement_by_class = {
            str(cc.id): requirement_by_course[str(cc.class_course_id)]
            for cc, _ in syllabus
            if str(cc.class_course_id) in requirement_by_course
        }
        return program.id, phase_by_section, requirement_by_class

    async def regenerate_missing(
        self, cohort_id: UUID, organization_id: UUID, actor_id: UUID
    ) -> Tuple[int, List[str]]:
        """Create events only for classes that have none.

        Safe to run repeatedly: a class that already has an event is skipped, so
        this repairs a partial generation (or a manually deleted event) without
        ever duplicating a class.
        """
        cohort = await self.get_cohort(cohort_id, organization_id)
        if not cohort:
            raise ValueError("Cohort not found")

        result = await self.db.execute(
            select(CourseCohortClass)
            .where(
                CourseCohortClass.cohort_id == str(cohort_id),
                CourseCohortClass.organization_id == str(organization_id),
                CourseCohortClass.event_id.is_(None),
                CourseCohortClass.status != CohortClassStatus.CANCELLED,
            )
            .order_by(CourseCohortClass.sequence)
        )
        pending = list(result.scalars().all())

        created = 0
        warnings: List[str] = []
        for cohort_class in pending:
            class_course = None
            if cohort_class.class_course_id:
                class_course = await self._get_course(
                    cohort_class.class_course_id, organization_id
                )
            session, error = await self._create_session_for_class(
                cohort=cohort,
                cohort_class=cohort_class,
                class_course=class_course,
                organization_id=organization_id,
                created_by=actor_id,
            )
            if error:
                warnings.append(f"{cohort_class.title}: {error}")
                continue
            if session is not None:
                cohort_class.training_session_id = session.id
                cohort_class.event_id = session.event_id
                created += 1

        if created:
            await self._invite_roster_to_class_events(
                cohort_id=cohort_id,
                organization_id=organization_id,
                actor_id=actor_id,
                cohort_classes=pending,
            )

        await self.db.commit()
        return created, warnings

    # ── cohort management ────────────────────────────────────────────

    async def reschedule_class(
        self,
        cohort_class_id: UUID,
        data: CohortClassReschedule,
        organization_id: UUID,
        actor_id: UUID,
    ) -> CourseCohortClass:
        """Move one class. The linked event moves with it; RSVPs are untouched."""
        cohort_class = await self._get_cohort_class(cohort_class_id, organization_id)
        if not cohort_class:
            raise ValueError("Class not found")
        if cohort_class.status == CohortClassStatus.CANCELLED:
            raise ValueError("This class is cancelled — restore it before moving it")

        if data.instructor_id:
            await assert_in_org(
                self.db, User, data.instructor_id, organization_id, label="instructor"
            )
        if data.location_id:
            await assert_in_org(
                self.db, Location, data.location_id, organization_id, label="location"
            )

        cohort_class.scheduled_start = data.scheduled_start
        cohort_class.scheduled_end = data.scheduled_end
        if data.instructor_id:
            cohort_class.instructor_id = str(data.instructor_id)
        if data.location_id:
            cohort_class.location_id = str(data.location_id)

        await self._sync_event(cohort_class, organization_id, actor_id)
        await self.db.commit()
        await self.db.refresh(cohort_class)
        return cohort_class

    async def _sync_event(
        self,
        cohort_class: CourseCohortClass,
        organization_id: UUID,
        actor_id: UUID,
    ) -> None:
        """Push a cohort class's schedule onto its linked event."""
        if not cohort_class.event_id:
            return
        event_service = EventService(self.db)
        await event_service.update_event(
            event_id=cohort_class.event_id,
            organization_id=organization_id,
            event_data=EventUpdate(
                start_datetime=cohort_class.scheduled_start,
                end_datetime=cohort_class.scheduled_end,
                **(
                    {"location_id": cohort_class.location_id}
                    if cohort_class.location_id
                    else {}
                ),
            ),
            updated_by=actor_id,
        )

    async def cancel_class(
        self,
        cohort_class_id: UUID,
        reason: str,
        organization_id: UUID,
        actor_id: UUID,
    ) -> CourseCohortClass:
        """Cancel one class.

        The event is *cancelled*, not deleted, so members who RSVP'd see the
        cancellation on their calendar instead of the class silently vanishing.
        """
        cohort_class = await self._get_cohort_class(cohort_class_id, organization_id)
        if not cohort_class:
            raise ValueError("Class not found")

        cohort_class.status = CohortClassStatus.CANCELLED
        cohort_class.cancellation_reason = reason

        if cohort_class.event_id:
            event_service = EventService(self.db)
            await event_service.cancel_event(
                event_id=cohort_class.event_id,
                organization_id=organization_id,
                reason=reason,
                send_notifications=False,
            )

        await self.db.commit()
        await self.db.refresh(cohort_class)
        return cohort_class

    async def add_ad_hoc_class(
        self,
        cohort_id: UUID,
        data: CohortAdHocClassCreate,
        organization_id: UUID,
        actor_id: UUID,
    ) -> CourseCohortClass:
        """Add a class that was never on the syllabus (make-ups, add-ons)."""
        cohort = await self.get_cohort(cohort_id, organization_id)
        if not cohort:
            raise ValueError("Cohort not found")

        class_course = await self._get_course(data.class_course_id, organization_id)
        if not class_course:
            raise ValueError("Invalid class course")
        # Validate every client-supplied FK in-org (XC-1), mirroring the
        # syllabus path's _validate_references — the ad-hoc path previously
        # checked only instructor/location and stored category/requirement/phase
        # (which flow into the generated TrainingSession) unvalidated.
        for value, model, label in (
            (data.instructor_id, User, "instructor"),
            (data.location_id, Location, "location"),
            (data.category_id, TrainingCategory, "training category"),
            (data.requirement_id, TrainingRequirement, "training requirement"),
        ):
            if value:
                await assert_in_org(self.db, model, value, organization_id, label=label)

        # ProgramPhase has no organization_id of its own; scope it through its
        # program, exactly as _validate_references does.
        if data.phase_id:
            phase_result = await self.db.execute(
                select(ProgramPhase.id)
                .join(TrainingProgram, ProgramPhase.program_id == TrainingProgram.id)
                .where(
                    ProgramPhase.id == str(data.phase_id),
                    TrainingProgram.organization_id == str(organization_id),
                )
            )
            if phase_result.scalar_one_or_none() is None:
                raise ValueError("Invalid program phase")

        count_result = await self.db.execute(
            select(func.count(CourseCohortClass.id)).where(
                CourseCohortClass.cohort_id == str(cohort_id)
            )
        )
        if (count_result.scalar() or 0) >= MAX_GENERATED_CLASSES:
            raise ValueError(
                f"A cohort cannot hold more than {MAX_GENERATED_CLASSES} classes"
            )

        max_result = await self.db.execute(
            select(func.max(CourseCohortClass.sequence)).where(
                CourseCohortClass.cohort_id == str(cohort_id)
            )
        )
        cohort_class = CourseCohortClass(
            organization_id=str(organization_id),
            cohort_id=str(cohort_id),
            course_class_id=None,
            sequence=(max_result.scalar() or 0) + 1,
            title=data.title,
            description=data.description,
            scheduled_start=data.scheduled_start,
            scheduled_end=data.scheduled_end,
            status=CohortClassStatus.SCHEDULED,
            class_course_id=str(data.class_course_id),
            credit_hours=(
                data.credit_hours
                if data.credit_hours is not None
                else class_course.credit_hours
            ),
            instructor_id=str(data.instructor_id) if data.instructor_id else None,
            instructor=data.instructor,
            location_id=str(data.location_id) if data.location_id else None,
            location=data.location,
            category_id=str(data.category_id) if data.category_id else None,
            requirement_id=str(data.requirement_id) if data.requirement_id else None,
            phase_id=str(data.phase_id) if data.phase_id else None,
            counts_toward_certification=_counts_toward_certification(
                data.counts_toward_certification
            ),
        )
        self.db.add(cohort_class)
        await self.db.flush()

        session, error = await self._create_session_for_class(
            cohort=cohort,
            cohort_class=cohort_class,
            class_course=class_course,
            organization_id=organization_id,
            created_by=actor_id,
        )
        if error:
            raise ValueError(error)
        if session is not None:
            cohort_class.training_session_id = session.id
            cohort_class.event_id = session.event_id

        if data.invite_roster:
            await self._invite_roster_to_class_events(
                cohort_id=cohort_id,
                organization_id=organization_id,
                actor_id=actor_id,
                cohort_classes=[cohort_class],
            )

        await self.db.commit()
        await self.db.refresh(cohort_class)
        return cohort_class

    async def shift_remaining(
        self,
        cohort_id: UUID,
        data: CohortShiftRequest,
        organization_id: UUID,
        actor_id: UUID,
    ) -> int:
        """Shift upcoming classes by N days — weather, instructor illness, etc.

        Only future, non-cancelled classes move. Classes that already happened
        keep their dates, because their attendance records are anchored to them.
        """
        cohort = await self.get_cohort(cohort_id, organization_id)
        if not cohort:
            raise ValueError("Cohort not found")

        now = datetime.now(timezone.utc)
        query = select(CourseCohortClass).where(
            CourseCohortClass.cohort_id == str(cohort_id),
            CourseCohortClass.organization_id == str(organization_id),
            CourseCohortClass.status != CohortClassStatus.CANCELLED,
        )
        if data.from_sequence:
            query = query.where(CourseCohortClass.sequence >= data.from_sequence)
        else:
            query = query.where(CourseCohortClass.scheduled_start > now)

        result = await self.db.execute(query.order_by(CourseCohortClass.sequence))
        rows = list(result.scalars().all())

        delta = timedelta(days=data.days)
        for cohort_class in rows:
            cohort_class.scheduled_start = cohort_class.scheduled_start + delta
            cohort_class.scheduled_end = cohort_class.scheduled_end + delta
            await self._sync_event(cohort_class, organization_id, actor_id)

        await self.db.commit()
        return len(rows)

    async def update_cohort(
        self, cohort_id: UUID, data: CourseCohortUpdate, organization_id: UUID
    ) -> CourseCohort:
        """Patch cohort metadata. Rescheduling goes through the class endpoints."""
        cohort = await self.get_cohort(cohort_id, organization_id)
        if not cohort:
            raise ValueError("Cohort not found")

        if data.location_id:
            await assert_in_org(
                self.db, Location, data.location_id, organization_id, label="location"
            )

        updates = data.model_dump(exclude_unset=True)
        for field, value in updates.items():
            if field == "status" and value:
                setattr(cohort, field, CohortStatus(value))
            elif field == "location_id":
                setattr(cohort, field, str(value) if value else None)
            elif field == "blackout_dates":
                # Plain JSON columns do not track in-place mutation; assigning a
                # fresh list is what makes SQLAlchemy issue the UPDATE.
                setattr(cohort, field, copy.deepcopy(value) if value else None)
            else:
                setattr(cohort, field, value)

        await self.db.commit()
        await self.db.refresh(cohort)
        return cohort

    async def cancel_cohort(
        self, cohort_id: UUID, reason: str, organization_id: UUID, actor_id: UUID
    ) -> CourseCohort:
        """Cancel a cohort and every one of its remaining classes."""
        cohort = await self.get_cohort(cohort_id, organization_id)
        if not cohort:
            raise ValueError("Cohort not found")

        result = await self.db.execute(
            select(CourseCohortClass).where(
                CourseCohortClass.cohort_id == str(cohort_id),
                CourseCohortClass.organization_id == str(organization_id),
                CourseCohortClass.status != CohortClassStatus.CANCELLED,
            )
        )
        event_service = EventService(self.db)
        for cohort_class in result.scalars().all():
            cohort_class.status = CohortClassStatus.CANCELLED
            cohort_class.cancellation_reason = reason
            if cohort_class.event_id:
                await event_service.cancel_event(
                    event_id=cohort_class.event_id,
                    organization_id=organization_id,
                    reason=reason,
                    send_notifications=False,
                )

        cohort.status = CohortStatus.CANCELLED
        await self.db.commit()
        await self.db.refresh(cohort)
        return cohort

    # ── roster ───────────────────────────────────────────────────────

    async def add_members(
        self,
        cohort_id: UUID,
        data: CohortMemberAdd,
        organization_id: UUID,
        actor_id: UUID,
    ) -> Tuple[int, List[str]]:
        """Add members to the roster, enrol them, and invite them to classes."""
        cohort = await self.get_cohort(cohort_id, organization_id)
        if not cohort:
            raise ValueError("Cohort not found")

        before_result = await self.db.execute(
            select(func.count(CourseCohortMember.id)).where(
                CourseCohortMember.cohort_id == str(cohort_id)
            )
        )
        before = before_result.scalar() or 0

        warnings = await self._add_members(
            cohort=cohort,
            user_ids=list(data.user_ids),
            organization_id=organization_id,
            actor_id=actor_id,
            enroll_in_program=data.enroll_in_program,
            invite_to_events=data.invite_to_events,
            future_only=True,
        )
        await self.db.commit()

        after_result = await self.db.execute(
            select(func.count(CourseCohortMember.id)).where(
                CourseCohortMember.cohort_id == str(cohort_id)
            )
        )
        return (after_result.scalar() or 0) - before, warnings

    async def _add_members(
        self,
        cohort: CourseCohort,
        user_ids: List[UUID],
        organization_id: UUID,
        actor_id: UUID,
        enroll_in_program: bool,
        invite_to_events: bool,
        future_only: bool,
    ) -> List[str]:
        """Roster addition shared by generation and later add-member calls.

        A member who cannot be enrolled (unmet prerequisite, for example) is
        still added to the roster and reported as a warning — the officer knows
        their department better than the eligibility rules do, and losing the
        whole generation over one member would be worse.
        """
        if not user_ids:
            return []

        warnings: List[str] = []

        user_result = await self.db.execute(
            select(User).where(
                User.id.in_([str(uid) for uid in user_ids]),
                User.organization_id == str(organization_id),
            )
        )
        valid_users = {u.id: u for u in user_result.scalars().all()}

        existing_result = await self.db.execute(
            select(CourseCohortMember.user_id).where(
                CourseCohortMember.cohort_id == cohort.id
            )
        )
        existing = set(existing_result.scalars().all())

        added: List[str] = []
        for user_id in user_ids:
            key = str(user_id)
            if key not in valid_users:
                warnings.append("A selected member is not in this organization.")
                continue
            if key in existing:
                continue

            enrollment_id: Optional[str] = None
            if enroll_in_program and cohort.program_id:
                enrollment_id, enroll_error = await self._enroll_member(
                    user_id=user_id,
                    program_id=cohort.program_id,
                    organization_id=organization_id,
                    actor_id=actor_id,
                )
                if enroll_error:
                    name = valid_users[key].username or key
                    warnings.append(f"{name}: {enroll_error}")

            self.db.add(
                CourseCohortMember(
                    organization_id=str(organization_id),
                    cohort_id=cohort.id,
                    user_id=key,
                    enrollment_id=enrollment_id,
                    status=CohortMemberStatus.ACTIVE,
                    added_by=str(actor_id),
                )
            )
            added.append(key)

        await self.db.flush()

        if added and invite_to_events:
            query = select(CourseCohortClass).where(
                CourseCohortClass.cohort_id == cohort.id,
                CourseCohortClass.status != CohortClassStatus.CANCELLED,
            )
            if future_only:
                # A member joining mid-run must not be RSVP'd to classes that
                # already happened: those would land on their calendar as
                # sessions they were expected at, and would show them as a
                # no-show on training they could not have made. Generation
                # passes future_only=False so a deliberately back-dated cohort
                # still records its full roster.
                query = query.where(
                    CourseCohortClass.scheduled_start > datetime.now(timezone.utc)
                )

            class_result = await self.db.execute(query)
            await self._rsvp_users_to_classes(
                user_ids=added,
                cohort_classes=list(class_result.scalars().all()),
                organization_id=organization_id,
            )

        return warnings

    async def _enroll_member(
        self,
        user_id: UUID,
        program_id: str,
        organization_id: UUID,
        actor_id: UUID,
    ) -> Tuple[Optional[str], Optional[str]]:
        """Enrol one member, reusing the existing enrollment rules.

        An existing active enrollment is reused rather than duplicated, so a
        member added to a second cohort of the same course keeps one progress
        record.
        """
        from app.services.training_program_service import TrainingProgramService

        existing = await self.db.execute(
            select(ProgramEnrollment).where(
                ProgramEnrollment.user_id == str(user_id),
                ProgramEnrollment.program_id == str(program_id),
            )
        )
        found = existing.scalars().first()
        if found:
            return found.id, None

        service = TrainingProgramService(self.db)
        try:
            enrollment, error = await service.enroll_member(
                enrollment_data=ProgramEnrollmentCreate(
                    user_id=user_id, program_id=UUID(str(program_id))
                ),
                organization_id=organization_id,
                enrolled_by=actor_id,
            )
        except Exception as exc:  # noqa: BLE001 - reported, never fatal
            logger.warning(f"Cohort enrollment failed for {user_id}: {exc}")
            return None, "could not be enrolled in the pipeline"

        if error or enrollment is None:
            return None, error or "could not be enrolled in the pipeline"
        return enrollment.id, None

    async def _invite_roster_to_class_events(
        self,
        cohort_id: UUID,
        organization_id: UUID,
        actor_id: UUID,
        cohort_classes: Sequence[CourseCohortClass],
    ) -> None:
        """RSVP the whole active roster to the given cohort classes."""
        member_result = await self.db.execute(
            select(CourseCohortMember.user_id).where(
                CourseCohortMember.cohort_id == str(cohort_id),
                CourseCohortMember.status == CohortMemberStatus.ACTIVE,
            )
        )
        user_ids = list(member_result.scalars().all())
        if user_ids:
            await self._rsvp_users_to_classes(
                user_ids=user_ids,
                cohort_classes=cohort_classes,
                organization_id=organization_id,
            )

    async def _rsvp_users_to_classes(
        self,
        user_ids: Sequence[str],
        cohort_classes: Sequence[CourseCohortClass],
        organization_id: UUID,
    ) -> None:
        """Create GOING RSVPs so classes appear on members' calendars.

        Written directly rather than through ``manager_add_attendee`` because
        that method commits per call, and generation must stay in one
        transaction. Existing RSVPs are left alone, keeping this idempotent.
        """
        from app.models.event import RSVPStatus

        event_ids = [c.event_id for c in cohort_classes if c.event_id]
        if not event_ids or not user_ids:
            return

        existing_result = await self.db.execute(
            select(EventRSVP.event_id, EventRSVP.user_id).where(
                EventRSVP.event_id.in_(event_ids),
                EventRSVP.user_id.in_([str(u) for u in user_ids]),
            )
        )
        existing = {(row[0], row[1]) for row in existing_result.all()}

        for event_id in event_ids:
            for user_id in user_ids:
                if (event_id, str(user_id)) in existing:
                    continue
                self.db.add(
                    EventRSVP(
                        organization_id=str(organization_id),
                        event_id=event_id,
                        user_id=str(user_id),
                        status=RSVPStatus.GOING,
                        guest_count=0,
                    )
                )
        await self.db.flush()

    async def remove_member(
        self, cohort_id: UUID, user_id: UUID, organization_id: UUID
    ) -> None:
        """Withdraw a member from the roster and clear their upcoming classes.

        Soft on history, clean on the calendar. The enrollment, the training
        records, and any class they already checked into stay put — matching
        how program withdrawal behaves elsewhere in the module. But their RSVPs
        on classes that have not started are removed: a withdrawn member left
        on the attendee list keeps the course on their calendar and counts them
        as an expected no-show for every remaining class.
        """
        result = await self.db.execute(
            select(CourseCohortMember).where(
                CourseCohortMember.cohort_id == str(cohort_id),
                CourseCohortMember.user_id == str(user_id),
                CourseCohortMember.organization_id == str(organization_id),
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise ValueError("Member is not on this cohort's roster")

        member.status = CohortMemberStatus.WITHDRAWN
        member.withdrawn_at = datetime.now(timezone.utc)

        upcoming = await self.db.execute(
            select(CourseCohortClass.event_id).where(
                CourseCohortClass.cohort_id == str(cohort_id),
                CourseCohortClass.organization_id == str(organization_id),
                CourseCohortClass.event_id.isnot(None),
                CourseCohortClass.scheduled_start > datetime.now(timezone.utc),
            )
        )
        event_ids = [e for e in upcoming.scalars().all() if e]
        if event_ids:
            rsvps = await self.db.execute(
                select(EventRSVP).where(
                    EventRSVP.event_id.in_(event_ids),
                    EventRSVP.user_id == str(user_id),
                    # Never touch an RSVP that already recorded attendance —
                    # that is a training record, not a calendar entry.
                    EventRSVP.checked_in.is_(False),
                )
            )
            for rsvp in rsvps.scalars().all():
                await self.db.delete(rsvp)

        await self.db.commit()

    # ── reads ────────────────────────────────────────────────────────

    async def list_cohorts(
        self,
        organization_id: UUID,
        course_id: Optional[UUID] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Cohort list view, with the counts the list page needs."""
        query = select(CourseCohort, TrainingCourse.name).outerjoin(
            TrainingCourse, CourseCohort.course_id == TrainingCourse.id
        )
        query = query.where(CourseCohort.organization_id == str(organization_id))
        if course_id:
            query = query.where(CourseCohort.course_id == str(course_id))
        if status:
            query = query.where(CourseCohort.status == CohortStatus(status))

        result = await self.db.execute(
            query.order_by(CourseCohort.start_date.desc()).offset(skip).limit(limit)
        )
        rows = result.all()
        cohorts: List[Dict[str, Any]] = []
        for cohort, course_name in rows:
            counts = await self._cohort_counts(cohort.id)
            cohorts.append({"cohort": cohort, "course_name": course_name, **counts})
        return cohorts

    async def _cohort_counts(self, cohort_id: str) -> Dict[str, Any]:
        """Class/member counts and the cohort's last class date."""
        class_result = await self.db.execute(
            select(
                func.count(CourseCohortClass.id),
                func.max(CourseCohortClass.scheduled_start),
            ).where(CourseCohortClass.cohort_id == cohort_id)
        )
        class_count, last_start = class_result.one()

        member_result = await self.db.execute(
            select(func.count(CourseCohortMember.id)).where(
                CourseCohortMember.cohort_id == cohort_id,
                CourseCohortMember.status == CohortMemberStatus.ACTIVE,
            )
        )
        return {
            "class_count": class_count or 0,
            "member_count": member_result.scalar() or 0,
            "end_date": last_start.date() if last_start else None,
        }

    async def get_cohort_detail(
        self, cohort_id: UUID, organization_id: UUID
    ) -> Dict[str, Any]:
        """Full cohort: metadata, class timeline with attendance, and roster."""
        cohort = await self.get_cohort(cohort_id, organization_id)
        if not cohort:
            raise ValueError("Cohort not found")

        course = await self._get_course(UUID(cohort.course_id), organization_id)
        program_name = None
        if cohort.program_id:
            program_result = await self.db.execute(
                select(TrainingProgram.name).where(
                    TrainingProgram.id == cohort.program_id,
                    TrainingProgram.organization_id == str(organization_id),
                )
            )
            program_name = program_result.scalar_one_or_none()

        class_result = await self.db.execute(
            select(CourseCohortClass, TrainingCourse.name)
            .outerjoin(
                TrainingCourse, CourseCohortClass.class_course_id == TrainingCourse.id
            )
            .where(CourseCohortClass.cohort_id == str(cohort_id))
            .order_by(CourseCohortClass.sequence)
        )
        class_rows = class_result.all()

        event_ids = [c.event_id for c, _ in class_rows if c.event_id]
        rsvp_counts: Dict[str, Tuple[int, int]] = {}
        if event_ids:
            rsvp_result = await self.db.execute(
                select(
                    EventRSVP.event_id,
                    func.count(EventRSVP.id),
                    func.sum(case((EventRSVP.checked_in.is_(True), 1), else_=0)),
                )
                .where(EventRSVP.event_id.in_(event_ids))
                .group_by(EventRSVP.event_id)
            )
            for event_id, total, checked_in in rsvp_result.all():
                rsvp_counts[event_id] = (int(total or 0), int(checked_in or 0))

        classes = []
        for cohort_class, class_course_name in class_rows:
            total, checked_in = rsvp_counts.get(cohort_class.event_id or "", (0, 0))
            classes.append(
                {
                    "row": cohort_class,
                    "class_course_name": class_course_name,
                    "rsvp_count": total,
                    "checked_in_count": checked_in,
                }
            )

        member_result = await self.db.execute(
            select(CourseCohortMember, User, ProgramEnrollment)
            .outerjoin(User, CourseCohortMember.user_id == User.id)
            .outerjoin(
                ProgramEnrollment,
                CourseCohortMember.enrollment_id == ProgramEnrollment.id,
            )
            .where(CourseCohortMember.cohort_id == str(cohort_id))
            .order_by(CourseCohortMember.added_at)
        )
        members = [
            {
                "row": member,
                "full_name": (
                    f"{user.first_name} {user.last_name}".strip() if user else None
                ),
                "email": user.email if user else None,
                "progress_percentage": (
                    enrollment.progress_percentage if enrollment else None
                ),
            }
            for member, user, enrollment in member_result.all()
        ]

        counts = await self._cohort_counts(cohort.id)
        return {
            "cohort": cohort,
            "course_name": course.name if course else None,
            "program_name": program_name,
            "classes": classes,
            "members": members,
            **counts,
        }

    async def list_member_cohorts(
        self, user_id: UUID, organization_id: UUID
    ) -> List[Dict[str, Any]]:
        """Cohorts a member is on the roster for — their 'my classes' view."""
        result = await self.db.execute(
            select(CourseCohort, TrainingCourse.name)
            .join(CourseCohortMember, CourseCohortMember.cohort_id == CourseCohort.id)
            .outerjoin(TrainingCourse, CourseCohort.course_id == TrainingCourse.id)
            .where(
                CourseCohortMember.user_id == str(user_id),
                CourseCohortMember.status == CohortMemberStatus.ACTIVE,
                CourseCohort.organization_id == str(organization_id),
            )
            .order_by(CourseCohort.start_date.desc())
        )
        cohorts = []
        for cohort, course_name in result.all():
            counts = await self._cohort_counts(cohort.id)
            cohorts.append({"cohort": cohort, "course_name": course_name, **counts})
        return cohorts

    async def is_roster_member(
        self, cohort_id: UUID, user_id: UUID, organization_id: UUID
    ) -> bool:
        """Whether a user is on this cohort's roster (gates member-facing reads)."""
        result = await self.db.execute(
            select(CourseCohortMember.id).where(
                CourseCohortMember.cohort_id == str(cohort_id),
                CourseCohortMember.user_id == str(user_id),
                CourseCohortMember.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none() is not None
