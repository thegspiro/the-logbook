"""
Training Session Service

Business logic for training session management, approval workflows, and notifications.
"""

import secrets
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.constants import ROLE_TRAINING_OFFICER
from app.core.utils import generate_uuid
from app.models.event import (
    CheckInWindowType,
    Event,
    EventRSVP,
    EventType,
    default_reminder_target,
)
from app.models.training import (
    ApprovalStatus,
    EnrollmentStatus,
    ProgramEnrollment,
    ProgramPhase,
    RequirementProgress,
    TrainingApproval,
    TrainingCategory,
    TrainingCourse,
    TrainingProgram,
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Role, User
from app.schemas.training_session import (
    AttendeeApprovalData,
    RecurringTrainingSessionCreate,
    TrainingSessionAttach,
    TrainingSessionCreate,
    TrainingSessionLinkageUpdate,
)
from app.services.admin_hours_service import AdminHoursService
from app.services.event_service import (
    EventService,
    attendance_is_finalized,
    attendance_locked_error,
)
from app.services.location_service import LocationService
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import is_in_org
from app.utils.org_timezone import local_and_utc_dates, resolve_scheduling_timezone

# A second set of training details for one event. training_sessions.event_id
# is unique; the endpoint answers this with a 409, not a 400.
TRAINING_DETAILS_EXIST = "This event already has training details"

# How far out an approval link stays usable, from when it is issued.
APPROVAL_TOKEN_TTL = timedelta(days=30)

# What an approving officer may change on a roster entry. Everything else —
# who the member is, the times finalize credited — stays as finalize wrote it.
_APPROVER_EDITABLE_FIELDS = frozenset(
    {
        "override_check_in_at",
        "override_check_out_at",
        "override_duration_minutes",
        "approved",
        "notes",
    }
)


def _display_name(user: User) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or (
        user.username or "Member"
    )


@dataclass
class EventTrainingCredit:
    """What finalizing a Training event's attendance credited.

    Built inside finalize's transaction and returned to it: the counts go back
    to the officer who pressed Finalize, and the rest drives the steps that
    must wait for the commit — pipeline credit and its reversal commit
    internally, and an officer email should not go out for an approval that
    might still roll back.
    """

    records_completed: int = 0
    approval_pending: bool = False
    attendees_pending: int = 0
    uncredited_names: List[str] = field(default_factory=list)
    session_id: Optional[str] = None
    program_id: Optional[str] = None
    approval_id: Optional[str] = None
    removed_user_ids: Set[str] = field(default_factory=set)
    pipeline_updates: List[Tuple[str, str, str, float, str]] = field(
        default_factory=list
    )
    sweep_session_id: Optional[str] = None
    notify: Optional[Dict[str, Any]] = None


class TrainingSessionService:
    """Service for training session management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _validate_linkage_ids(
        self,
        session_data: "TrainingSessionCreate | TrainingSessionLinkageUpdate",
        organization_id: UUID,
    ) -> Optional[str]:
        """Verify client-supplied linkage FKs belong to the caller's org (XC-1).

        Returns an error message, or None when everything checks out. Errors are
        deliberately generic so they cannot be used as a cross-tenant existence
        oracle. ProgramPhase has no organization_id of its own, so it is scoped
        through its (already-validated) program instead.
        """
        if session_data.category_id and not await is_in_org(
            self.db, TrainingCategory, session_data.category_id, organization_id
        ):
            return "Invalid training category"

        if session_data.program_id and not await is_in_org(
            self.db, TrainingProgram, session_data.program_id, organization_id
        ):
            return "Invalid training program"

        if session_data.requirement_id and not await is_in_org(
            self.db, TrainingRequirement, session_data.requirement_id, organization_id
        ):
            return "Invalid training requirement"

        if session_data.phase_id:
            # ProgramPhase carries no organization_id, so scope it through its
            # program. Deliberately NOT required to match session_data.program_id:
            # cohort-generated sessions can carry a class-level phase from a
            # different (or no) cohort program, and rejecting that would break
            # event generation for existing course setups.
            phase_result = await self.db.execute(
                select(ProgramPhase.id)
                .join(TrainingProgram, ProgramPhase.program_id == TrainingProgram.id)
                .where(
                    ProgramPhase.id == str(session_data.phase_id),
                    TrainingProgram.organization_id == str(organization_id),
                )
            )
            if phase_result.scalar_one_or_none() is None:
                return "Invalid program phase"

        # getattr: the linkage-update schema carries no instructor_id
        instructor_id = getattr(session_data, "instructor_id", None)
        if instructor_id and not await is_in_org(
            self.db, User, instructor_id, organization_id
        ):
            return "Invalid instructor"

        return None

    async def get_session_by_event(
        self,
        event_id: UUID,
        organization_id: UUID,
    ) -> Optional[TrainingSession]:
        """Fetch the training session attached to an event, org-scoped."""
        result = await self.db.execute(
            select(TrainingSession)
            .where(TrainingSession.event_id == str(event_id))
            .where(TrainingSession.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def update_session_linkage(
        self,
        training_session_id: UUID,
        updates: TrainingSessionLinkageUpdate,
        organization_id: UUID,
    ) -> Tuple[Optional[TrainingSession], Optional[str]]:
        """Update a session's course, type and category/program/phase/requirement links.

        Fields omitted from the payload are untouched; explicit nulls clear
        the link. A change applies the next time the event's attendance is
        finalized, which rewrites the members' records under the new links —
        so it is refused while attendance is finalized, where it would sit
        unapplied and disagree with the records until a reopen.

        Returns: (training_session, error_message)
        """
        result = await self.db.execute(
            select(TrainingSession)
            .where(TrainingSession.id == str(training_session_id))
            .where(TrainingSession.organization_id == str(organization_id))
        )
        training_session = result.scalar_one_or_none()
        if not training_session:
            return None, "Training session not found"

        payload = updates.model_dump(exclude_unset=True)
        if not payload:
            return training_session, None

        # Locked, and in the same order finalize takes (event, then session),
        # so a change cannot land between a finalize reading the links and
        # writing the records they steer.
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == training_session.event_id)
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()
        if event is None:
            return None, "Training session not found"
        if attendance_is_finalized(event):
            return None, attendance_locked_error("changing its training details")

        linkage_error = await self._validate_linkage_ids(updates, organization_id)
        if linkage_error:
            return None, linkage_error

        if "training_type" in payload:
            if payload["training_type"] is None:
                return None, "Training type is required"
            training_session.training_type = TrainingType(payload.pop("training_type"))

        if "course_id" in payload:
            course_id = payload.pop("course_id")
            if course_id is None:
                training_session.course_id = None
                training_session.course_name = event.title
                training_session.course_code = None
            else:
                course = await self._course_in_org(course_id, organization_id)
                if course is None:
                    return None, "Training course not found"
                training_session.course_id = str(course.id)
                training_session.course_name = course.name
                training_session.course_code = course.code

        # The columns are String(36); UUIDs bound raw match/store nothing
        # sensible (same mismatch as the course lookup above).
        payload = {
            key: str(value) if value is not None else None
            for key, value in payload.items()
        }

        try:
            apply_updates(training_session, payload)
        except ValueError as e:
            return None, str(e)

        await self.db.commit()
        await self.db.refresh(training_session)
        return training_session, None

    async def _course_in_org(
        self, course_id: UUID, organization_id: UUID
    ) -> Optional[TrainingCourse]:
        # str(): the column is String(36) and the id arrives as a UUID.
        result = await self.db.execute(
            select(TrainingCourse)
            .where(TrainingCourse.id == str(course_id))
            .where(TrainingCourse.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def resolve_attach_details(
        self, details: TrainingSessionAttach, organization_id: UUID
    ) -> Tuple[Optional[TrainingCourse], Optional[str]]:
        """Validate picked training details against the caller's org (XC-1).

        Returns the chosen course (or None when none was picked) and an error.
        """
        linkage_error = await self._validate_linkage_ids(details, organization_id)
        if linkage_error:
            return None, linkage_error
        if details.course_id is None:
            return None, None
        course = await self._course_in_org(details.course_id, organization_id)
        if course is None:
            return None, "Training course not found"
        return course, None

    @staticmethod
    def build_session_for_event(
        event: Event,
        details: TrainingSessionAttach,
        course: Optional[TrainingCourse],
        organization_id: UUID,
        created_by: Optional[UUID],
    ) -> TrainingSession:
        """The session that files an Events-created Training event's credit.

        Mirrors what the Create Training Session wizard pre-fills from a course
        (name, code, type, credit hours, instructor), falling back to the event
        itself when no course was picked. Created only because an officer picked
        a detail, so it keeps the wizard's defaults: records complete when
        attendance is finalized, with no separate officer confirmation.
        """
        if details.training_type:
            training_type = TrainingType(details.training_type)
        elif course is not None and course.training_type is not None:
            training_type = TrainingType(
                getattr(course.training_type, "value", course.training_type)
            )
        else:
            training_type = TrainingType.CONTINUING_EDUCATION

        # credit_hours is NOT NULL on the session. A course's own figure wins;
        # otherwise the scheduled length stands in, as the wizard's default does.
        credit_hours = course.credit_hours if course is not None else None
        if credit_hours is None:
            credit_hours = 0.0
            if event.start_datetime and event.end_datetime:
                span = (event.end_datetime - event.start_datetime).total_seconds()
                credit_hours = round(max(0.0, span) / 3600, 2)

        return TrainingSession(
            organization_id=str(organization_id),
            event_id=str(event.id),
            course_id=str(course.id) if course is not None else None,
            category_id=str(details.category_id) if details.category_id else None,
            program_id=str(details.program_id) if details.program_id else None,
            phase_id=str(details.phase_id) if details.phase_id else None,
            requirement_id=(
                str(details.requirement_id) if details.requirement_id else None
            ),
            course_name=course.name if course is not None else event.title,
            course_code=course.code if course is not None else None,
            training_type=training_type,
            credit_hours=float(credit_hours),
            instructor=course.instructor if course is not None else None,
            auto_create_records=True,
            require_completion_confirmation=False,
            counts_toward_certification=True,
            created_by=str(created_by) if created_by else None,
        )

    async def attach_session_to_event(
        self,
        event_id: UUID,
        details: TrainingSessionAttach,
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[Optional[TrainingSession], Optional[str]]:
        """Give an existing Training event its training details.

        The way an event made from Events → Create Event gets a course,
        category or program requirement after the fact — including an event
        whose attendance was finalized with no details, which a department
        leader reopens so it can be filed properly and finalized again.

        Returns: (training_session, error_message)
        """
        from sqlalchemy.exc import IntegrityError

        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()
        if event is None:
            return None, "Event not found"
        if event.event_type != EventType.TRAINING:
            return None, "Training details can only be added to a Training event"
        if event.is_cancelled:
            return None, "Training details cannot be added to a cancelled event"
        if attendance_is_finalized(event):
            return None, attendance_locked_error("adding training details")
        if await self.get_session_by_event(event.id, organization_id) is not None:
            return None, TRAINING_DETAILS_EXIST

        course, error = await self.resolve_attach_details(details, organization_id)
        if error:
            return None, error

        training_session = self.build_session_for_event(
            event, details, course, organization_id, created_by
        )
        self.db.add(training_session)
        try:
            await self.db.commit()
        except IntegrityError:
            # training_sessions.event_id is unique: another request attached
            # details to this event between the check above and this commit.
            await self.db.rollback()
            return None, TRAINING_DETAILS_EXIST
        await self.db.refresh(training_session)
        return training_session, None

    async def create_training_session(
        self,
        session_data: TrainingSessionCreate,
        organization_id: UUID,
        created_by: UUID,
        commit: bool = True,
    ) -> Tuple[Optional[TrainingSession], Optional[str]]:
        """
        Create a training session (Event + TrainingSession link)

        Args:
            commit: when False the rows are flushed but not committed, so a
                caller creating several sessions (course cohort generation)
                can wrap them all in one transaction and roll the whole batch
                back on failure rather than leaving a half-built cohort.

        Returns: (training_session, error_message)
        """
        # Validate dates
        if session_data.end_datetime <= session_data.start_datetime:
            return None, "End date must be after start date"

        if session_data.requires_rsvp and session_data.rsvp_deadline:
            if session_data.rsvp_deadline >= session_data.start_datetime:
                return None, "RSVP deadline must be before event start"

        linkage_error = await self._validate_linkage_ids(session_data, organization_id)
        if linkage_error:
            return None, linkage_error

        # Validate course data
        if session_data.use_existing_course:
            if not session_data.course_id:
                return None, "course_id is required when use_existing_course is true"

            # Get existing course.
            # str(): the column is String(36) and course_id arrives as a UUID
            # object from the schema, so binding it raw compares a UUID against
            # a char column and matches nothing. The organization filter beside
            # it was already cast; this one was not, which is why every cohort
            # class failed with "Training course not found" while the course
            # plainly existed.
            course_result = await self.db.execute(
                select(TrainingCourse)
                .where(TrainingCourse.id == str(session_data.course_id))
                .where(TrainingCourse.organization_id == str(organization_id))
            )
            course = course_result.scalar_one_or_none()

            if not course:
                return None, "Training course not found"

            course_name = course.name
            course_code = course.code
            course_id = course.id
        else:
            if not session_data.course_name:
                return None, "course_name is required when creating a new course"

            course_name = session_data.course_name
            course_code = session_data.course_code
            course_id = None

        # Check for location double-booking
        if session_data.location_id:
            location_service = LocationService(self.db)
            overlapping = await location_service.check_overlapping_events(
                location_id=session_data.location_id,
                organization_id=str(organization_id),
                start_datetime=session_data.start_datetime,
                end_datetime=session_data.end_datetime,
            )
            if overlapping:
                titles = ", ".join(f'"{e.title}"' for e in overlapping[:3])
                return None, (
                    f"Location is already booked during this time. "
                    f"Conflicting event(s): {titles}"
                )

        # Create Event
        event = Event(
            organization_id=organization_id,
            title=session_data.title,
            description=session_data.description,
            event_type=EventType.TRAINING,
            location_id=session_data.location_id,
            location=session_data.location,
            location_details=session_data.location_details,
            start_datetime=session_data.start_datetime,
            end_datetime=session_data.end_datetime,
            requires_rsvp=session_data.requires_rsvp,
            rsvp_deadline=session_data.rsvp_deadline,
            max_attendees=session_data.max_attendees,
            is_mandatory=session_data.is_mandatory,
            allow_guests=False,  # Training sessions don't allow guests
            send_reminders=True,
            reminder_target=default_reminder_target(session_data.is_mandatory),
            reminder_schedule=[24],
            check_in_window_type=CheckInWindowType(session_data.check_in_window_type),
            check_in_minutes_before=session_data.check_in_minutes_before,
            check_in_minutes_after=session_data.check_in_minutes_after,
            require_checkout=session_data.require_checkout,
            custom_fields={
                "course_name": course_name,
                "course_code": course_code,
                "training_type": session_data.training_type,
                "credit_hours": session_data.credit_hours,
                "instructor": session_data.instructor,
                "issues_certification": session_data.issues_certification,
                "issuing_agency": session_data.issuing_agency,
                "expiration_months": session_data.expiration_months,
                "auto_create_records": session_data.auto_create_records,
            },
            created_by=created_by,
        )

        self.db.add(event)
        await self.db.flush()  # Get event ID

        # Create TrainingSession
        training_session = TrainingSession(
            organization_id=organization_id,
            event_id=event.id,
            course_id=course_id,
            category_id=(
                str(session_data.category_id) if session_data.category_id else None
            ),
            program_id=(
                str(session_data.program_id) if session_data.program_id else None
            ),
            phase_id=str(session_data.phase_id) if session_data.phase_id else None,
            requirement_id=(
                str(session_data.requirement_id)
                if session_data.requirement_id
                else None
            ),
            course_name=course_name,
            course_code=course_code,
            training_type=TrainingType(session_data.training_type),
            credit_hours=session_data.credit_hours,
            instructor=session_data.instructor,
            instructor_id=(
                str(session_data.instructor_id) if session_data.instructor_id else None
            ),
            issues_certification=session_data.issues_certification,
            certification_number_prefix=session_data.certification_number_prefix,
            issuing_agency=session_data.issuing_agency,
            expiration_months=session_data.expiration_months,
            counts_toward_certification=session_data.counts_toward_certification,
            auto_create_records=session_data.auto_create_records,
            require_completion_confirmation=session_data.require_completion_confirmation,
            approval_deadline_days=session_data.approval_deadline_days,
            created_by=created_by,
        )

        self.db.add(training_session)
        if not commit:
            await self.db.flush()
            return training_session, None

        await self.db.commit()
        await self.db.refresh(training_session)

        return training_session, None

    async def create_recurring_training_session(
        self,
        session_data: RecurringTrainingSessionCreate,
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[list[TrainingSession], Optional[str]]:
        """
        Create a recurring training session series.

        Uses EventService to generate recurring events, then creates a
        TrainingSession record for each event in the series.

        Returns: (list_of_training_sessions, error_message)
        """
        # Validate dates
        if session_data.end_datetime <= session_data.start_datetime:
            return [], "End date must be after start date"

        if session_data.requires_rsvp and session_data.rsvp_deadline:
            if session_data.rsvp_deadline >= session_data.start_datetime:
                return [], "RSVP deadline must be before event start"

        linkage_error = await self._validate_linkage_ids(session_data, organization_id)
        if linkage_error:
            return [], linkage_error

        # Validate course data
        if session_data.use_existing_course:
            if not session_data.course_id:
                return [], "course_id is required when use_existing_course is true"

            # str(): same String(36)-versus-UUID mismatch as the single-session
            # path above.
            course_result = await self.db.execute(
                select(TrainingCourse)
                .where(TrainingCourse.id == str(session_data.course_id))
                .where(TrainingCourse.organization_id == str(organization_id))
            )
            course = course_result.scalar_one_or_none()
            if not course:
                return [], "Training course not found"

            course_name = course.name
            course_code = course.code
            course_id = course.id
        else:
            if not session_data.course_name:
                return [], "course_name is required when creating a new course"

            course_name = session_data.course_name
            course_code = session_data.course_code
            course_id = None

        # Build event data dict for EventService.create_recurring_event
        event_data = {
            "title": session_data.title,
            "description": session_data.description,
            "event_type": EventType.TRAINING.value,
            "location_id": (
                str(session_data.location_id) if session_data.location_id else None
            ),
            "location": session_data.location,
            "location_details": session_data.location_details,
            "start_datetime": session_data.start_datetime,
            "end_datetime": session_data.end_datetime,
            "requires_rsvp": session_data.requires_rsvp,
            "rsvp_deadline": session_data.rsvp_deadline,
            "max_attendees": session_data.max_attendees,
            "is_mandatory": session_data.is_mandatory,
            "allow_guests": False,
            "send_reminders": True,
            "reminder_target": default_reminder_target(session_data.is_mandatory),
            "reminder_schedule": [24],
            "check_in_window_type": CheckInWindowType(
                session_data.check_in_window_type
            ).value,
            "check_in_minutes_before": session_data.check_in_minutes_before,
            "check_in_minutes_after": session_data.check_in_minutes_after,
            "require_checkout": session_data.require_checkout,
            "custom_fields": {
                "course_name": course_name,
                "course_code": course_code,
                "training_type": session_data.training_type,
                "credit_hours": session_data.credit_hours,
                "instructor": session_data.instructor,
                "issues_certification": session_data.issues_certification,
                "issuing_agency": session_data.issuing_agency,
                "expiration_months": session_data.expiration_months,
                "auto_create_records": session_data.auto_create_records,
            },
            # Recurrence fields (popped by EventService.create_recurring_event)
            "recurrence_pattern": session_data.recurrence_pattern,
            "recurrence_end_date": session_data.recurrence_end_date,
            "recurrence_custom_days": session_data.recurrence_custom_days,
            "recurrence_weekday": session_data.recurrence_weekday,
            "recurrence_week_ordinal": session_data.recurrence_week_ordinal,
            "recurrence_month": session_data.recurrence_month,
            "recurrence_exceptions": session_data.recurrence_exceptions,
        }

        event_service = EventService(self.db)
        events, error = await event_service.create_recurring_event(
            event_data=event_data,
            organization_id=organization_id,
            created_by=created_by,
        )

        if error:
            return [], error

        # Create a TrainingSession for each event in the series
        training_sessions = []
        for event in events:
            training_session = TrainingSession(
                organization_id=organization_id,
                event_id=event.id,
                course_id=course_id,
                category_id=(
                    str(session_data.category_id) if session_data.category_id else None
                ),
                program_id=(
                    str(session_data.program_id) if session_data.program_id else None
                ),
                phase_id=(
                    str(session_data.phase_id) if session_data.phase_id else None
                ),
                requirement_id=(
                    str(session_data.requirement_id)
                    if session_data.requirement_id
                    else None
                ),
                course_name=course_name,
                course_code=course_code,
                training_type=TrainingType(session_data.training_type),
                credit_hours=session_data.credit_hours,
                instructor=session_data.instructor,
                issues_certification=session_data.issues_certification,
                certification_number_prefix=session_data.certification_number_prefix,
                issuing_agency=session_data.issuing_agency,
                expiration_months=session_data.expiration_months,
                counts_toward_certification=session_data.counts_toward_certification,
                auto_create_records=session_data.auto_create_records,
                require_completion_confirmation=session_data.require_completion_confirmation,
                approval_deadline_days=session_data.approval_deadline_days,
                created_by=created_by,
            )
            self.db.add(training_session)
            training_sessions.append(training_session)

        await self.db.commit()

        for ts in training_sessions:
            await self.db.refresh(ts)

        return training_sessions, None

    async def finalize_training_session(
        self,
        training_session_id: UUID,
        organization_id: UUID,
        finalized_by: UUID,
        can_manage_training: bool = False,
    ) -> Tuple[Optional[TrainingApproval], Optional[str]]:
        """Finalize a training session by finalizing its event's attendance.

        The event's Finalize Attendance is the one writer of training credit
        and the event lock its authority. This route predates that and wrote
        credit on its own: without the event lock, on an event whose
        attendance stayed open, in a different lock order, and on a cancelled
        or re-typed event. It now runs the event's finalize. Kept for API
        callers; the app finalizes from the event page.

        Returns: (the approval this finalize issued, error_message)
        """
        training_session = (
            await self.db.execute(
                select(TrainingSession)
                .where(TrainingSession.id == str(training_session_id))
                .where(TrainingSession.organization_id == str(organization_id))
            )
        ).scalar_one_or_none()
        if not training_session:
            return None, "Training session not found"
        if not training_session.event_id:
            return None, "Event not found"

        outcome = await EventService(self.db).finalize_event_attendance_detailed(
            training_session.event_id,
            organization_id,
            finalized_by=finalized_by,
            can_manage_training=can_manage_training,
            require_training=True,
        )
        if outcome.error:
            return None, outcome.error
        if not outcome.training_approval_id:
            return None, "Training session not found"

        approval = (
            await self.db.execute(
                select(TrainingApproval)
                .where(TrainingApproval.id == outcome.training_approval_id)
                .where(TrainingApproval.organization_id == str(organization_id))
            )
        ).scalar_one_or_none()
        if approval is None:
            return None, "Training session not found"
        return approval, None

    async def _revoke_pipeline_credit_for_user(
        self,
        program_service,
        user_id: str,
        training_session: Any,
        organization_id: UUID,
        verified_by: Optional[UUID],
        source_type,
    ) -> None:
        """Reverse this session's credit on every requirement it fed for a member."""
        if not training_session.program_id:
            return

        # Same resolution as the crediting path, and for the same reason: a
        # member who completed this program and enrolled again holds an ACTIVE
        # row and a COMPLETED one, so a single-row fetch raises
        # MultipleResultsFound. Here the caller logs and moves on, so the
        # symptom is quieter and worse — the removed attendee simply keeps the
        # credit this call exists to take back.
        enrollment = await self._resolve_pipeline_enrollment(
            user_id=user_id,
            program_id=str(training_session.program_id),
            session_id=str(training_session.id),
            organization_id=organization_id,
        )
        if enrollment is None:
            return

        # Every requirement row under this enrollment, not just the session's
        # explicit requirement_id — a category-linked session fans credit out
        # across the category's requirements, and all of it has to come back.
        progress_result = await self.db.execute(
            select(RequirementProgress).where(
                RequirementProgress.enrollment_id == enrollment.id
            )
        )
        for progress in progress_result.scalars().all():
            await program_service.revoke_requirement_credit(
                progress_id=progress.id,
                organization_id=organization_id,
                source_type=source_type,
                source_id=str(training_session.id),
                verified_by=verified_by,
            )

    async def _resync_admin_hours(
        self,
        event_id: str,
        organization_id: UUID,
        rsvps: List[EventRSVP],
    ) -> None:
        """Push officer-corrected durations into the admin hours ledger.

        Credit is idempotent per (RSVP, category), so without an explicit
        resync the entry keeps whatever finalize wrote and the two records
        disagree for good. Failures are logged rather than raised: the approval
        and its training records are already committed, and losing them to a
        mapping problem in a downstream ledger would be the worse outcome.
        """
        if not rsvps:
            return

        event_result = await self.db.execute(
            select(Event).where(
                Event.id == str(event_id),
                Event.organization_id == str(organization_id),
            )
        )
        event = event_result.scalar_one_or_none()
        if not event:
            return

        effective_end = event.actual_end_time or event.end_datetime
        if effective_end is not None and effective_end.tzinfo is None:
            effective_end = effective_end.replace(tzinfo=timezone.utc)

        admin_hours = AdminHoursService(self.db)
        event_type_val = event.event_type.value if event.event_type else None

        for rsvp in rsvps:
            check_in = (
                rsvp.override_check_in_at or rsvp.checked_in_at or event.start_datetime
            )
            check_out = (
                rsvp.override_check_out_at or rsvp.checked_out_at or effective_end
            )
            # Derive from the corrected clock when the officer moved the
            # times but gave no explicit duration. Falling back to the stored
            # attendance_duration_minutes would write the new check-in/out
            # bounds against the old number of minutes, so the ledger entry
            # would disagree with itself as well as with the training record,
            # which _finalize_training_records computes from the same interval.
            # `is None`, not truthiness: an explicit 0 is "no credit" and must
            # not fall through to the measured minutes (credited_minutes).
            duration = rsvp.override_duration_minutes
            if (
                duration is None
                and rsvp.override_check_in_at
                and rsvp.override_check_out_at
            ):
                span = (
                    rsvp.override_check_out_at - rsvp.override_check_in_at
                ).total_seconds() / 60
                duration = max(0, int(span))
            if duration is None:
                duration = rsvp.attendance_duration_minutes
            if not check_in or not check_out or duration is None or duration <= 0:
                continue
            try:
                await admin_hours.credit_event_attendance(
                    organization_id=str(event.organization_id),
                    user_id=str(rsvp.user_id),
                    event_id=str(event.id),
                    rsvp_id=str(rsvp.id),
                    event_title=event.title or "Event",
                    check_in_at=check_in,
                    check_out_at=check_out,
                    duration_minutes=duration,
                    event_type=event_type_val,
                    custom_category=event.custom_category,
                    resync=True,
                )
            except Exception:
                logger.exception("Failed to resync admin hours for RSVP {}", rsvp.id)

        await self.db.commit()

    async def reopen_training_session(
        self,
        training_session_id: UUID,
        organization_id: UUID,
    ) -> Tuple[Optional[TrainingSession], Optional[str]]:
        """Reopen a finalized training session so it can be corrected.

        The session's finalized flag follows its event's attendance lock, so
        this reopens the event's attendance (``reopen_event_attendance``, which
        reopens the session and expires any pending approval with it). Reopening
        only the session left the event locked while a second finalize could
        write credit behind that lock.

        A session finalized by the old route has an event whose attendance was
        never closed; for that one the session alone is reopened, under the
        event's lock and in the order every writer uses.

        The caller audit-logs who reopened it and why.
        """
        training_session = (
            await self.db.execute(
                select(TrainingSession)
                .where(TrainingSession.id == str(training_session_id))
                .where(TrainingSession.organization_id == str(organization_id))
            )
        ).scalar_one_or_none()
        if not training_session:
            return None, "Training session not found"
        if not training_session.is_finalized:
            return None, "Training session is not finalized"

        event = (
            await self.db.execute(
                select(Event)
                .where(Event.id == str(training_session.event_id))
                .where(Event.organization_id == str(organization_id))
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if event is None:
            return None, "Event not found"

        if attendance_is_finalized(event):
            _, error = await EventService(self.db).reopen_event_attendance(
                event.id, organization_id
            )
            if error:
                return None, error
        else:
            await self.reopen_for_event(
                event, organization_id, datetime.now(timezone.utc)
            )
            await self.db.commit()

        await self.db.refresh(training_session)
        return training_session, None

    # ------------------------------------------------------------------
    # Credit from event attendance
    #
    # Finalize Attendance on a Training event is the one place training credit
    # is written from attendance. EventService.finalize_event_attendance takes
    # the event lock and calls these inside its own transaction; nothing here
    # commits except ``after_event_attendance_recorded``, which runs once the
    # finalize has.
    # ------------------------------------------------------------------

    async def lock_for_event_finalize(
        self, event: Event, organization_id: UUID
    ) -> Tuple[Optional[TrainingSession], List[TrainingApproval]]:
        """Lock the event's session and its pending approvals.

        Taken straight after the event's own lock, in the order every path
        uses — event, session, approvals, RSVPs — so a finalize cannot deadlock
        against an officer submitting an approval or a leader reopening.
        """
        # populate_existing, as on the event: an identity-mapped session or
        # approval would otherwise be handed back as it was before this call
        # waited, and a flag another writer just committed would go unseen.
        session_result = await self.db.execute(
            select(TrainingSession)
            .where(TrainingSession.event_id == str(event.id))
            .where(TrainingSession.organization_id == str(organization_id))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        training_session = session_result.scalar_one_or_none()
        if training_session is None:
            return None, []
        pending_result = await self.db.execute(
            select(TrainingApproval)
            .where(TrainingApproval.training_session_id == training_session.id)
            .where(TrainingApproval.organization_id == str(organization_id))
            .where(TrainingApproval.status == ApprovalStatus.PENDING)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return training_session, list(pending_result.scalars().all())

    @staticmethod
    def _supersede(approvals: List[TrainingApproval], now: datetime) -> None:
        """Kill the links of approvals issued against numbers being replaced.

        Floored and a second back: MySQL DATETIME(0) *rounds* a fraction, so a
        raw ``now`` of 12:00:00.6 is stored as 12:00:01 and the link stays
        good for another 0.4 s — long enough for a submit queued behind this
        lock to approve the roster that was just superseded.
        """
        expired_at = now.replace(microsecond=0) - timedelta(seconds=1)
        for approval in approvals:
            approval.token_expires_at = expired_at

    async def record_event_attendance(
        self,
        event: Event,
        training_session: Optional[TrainingSession],
        pending_approvals: List[TrainingApproval],
        attended: List[EventRSVP],
        effective_end: datetime,
        actor: Optional[UUID],
        organization_id: UUID,
    ) -> EventTrainingCredit:
        """Credit every checked-in attendee of a Training event.

        Minutes follow ``EventService.credited_minutes``: a manager's override,
        then the measured duration, then the derived one. An attendee with no
        creditable minutes gets no record and is named back to the officer.

        * **No session** (an event made from Events with no training details):
          a completed record per attendee, filed under the event's title as
          Continuing Education.
        * **Session, no confirmation required:** an approved approval and
          completed records through ``_finalize_training_records``, with the
          session's course, category and program links.
        * **Session requiring confirmation:** a pending approval for training
          officers and an in-progress record per attendee; the records complete
          when an officer approves. A record already completed by an earlier
          finalize is left as it is until then.

        Anyone credited by an earlier finalize and not credited now has that
        record voided.
        """
        credit = EventTrainingCredit()
        now = datetime.now(timezone.utc)
        org = str(organization_id)
        tz = await resolve_scheduling_timezone(self.db, org)
        event_dates = local_and_utc_dates(event.start_datetime, tz)
        event_date = event_dates[0]

        user_ids = sorted({str(rsvp.user_id) for rsvp in attended})
        users: Dict[str, User] = {}
        if user_ids:
            user_result = await self.db.execute(
                select(User).where(User.id.in_(user_ids), User.organization_id == org)
            )
            users = {str(u.id): u for u in user_result.scalars().all()}

        credited: Dict[str, int] = {}
        rsvp_by_user: Dict[str, EventRSVP] = {}
        for rsvp in attended:
            user_id = str(rsvp.user_id)
            user = users.get(user_id)
            if user is None:
                continue
            minutes = EventService.credited_minutes(event, rsvp, effective_end)
            if minutes is None or minutes <= 0:
                credit.uncredited_names.append(_display_name(user))
                continue
            credited[user_id] = minutes
            rsvp_by_user[user_id] = rsvp
        credit.uncredited_names.sort()

        if training_session is None:
            await self._write_sessionless_records(
                event, credited, event_date, actor, org, now
            )
            credit.records_completed = len(credited)
            await self.void_event_records(
                event.id,
                org,
                event_title=event.title,
                keep_user_ids=set(credited),
            )
            await self.db.flush()
            return credit

        credit.session_id = str(training_session.id)
        credit.program_id = (
            str(training_session.program_id) if training_session.program_id else None
        )

        # An approval issued against the roster as it was is superseded: its
        # link would approve numbers this finalize is replacing.
        self._supersede(pending_approvals, now)

        prior_ids = await self._prior_credit_user_ids(training_session, event, org)
        removed = prior_ids - set(credited)
        credit.removed_user_ids = removed

        attendee_data = [
            self._attendee_snapshot_entry(
                event,
                rsvp_by_user[user_id],
                users[user_id],
                effective_end,
                minutes,
            )
            for user_id, minutes in credited.items()
        ]

        requires_confirmation = bool(training_session.require_completion_confirmation)
        # Every finalize leaves an approval, an empty one when it credited
        # nobody: the newest approval is how the event page knows where this
        # finalize stands, and without one it went on reporting an earlier
        # finalize's approval for members who no longer hold any credit.
        approval = TrainingApproval(
            # Assigned here rather than at flush: the legacy finalize route
            # returns this approval's id.
            id=generate_uuid(),
            organization_id=org,
            training_session_id=training_session.id,
            event_id=str(event.id),
            approval_token=secrets.token_urlsafe(48),
            token_expires_at=now + APPROVAL_TOKEN_TTL,
            status=ApprovalStatus.PENDING,
            approval_deadline=effective_end
            + timedelta(days=training_session.approval_deadline_days or 7),
            attendee_data=attendee_data,
        )
        self.db.add(approval)
        credit.approval_id = str(approval.id)
        if not attendee_data:
            # Nothing to confirm; nothing waits on an officer.
            approval.status = ApprovalStatus.APPROVED
            approval.approved_by = str(actor) if actor else None
            approval.approved_at = now
        else:
            if requires_confirmation:
                await self._hold_pending_records(
                    training_session, event, credited, event_dates, actor, org
                )
                credit.approval_pending = True
                credit.attendees_pending = len(credited)
                credit.notify = {
                    "organization_id": organization_id,
                    "event_title": event.title,
                    "event_start": event.start_datetime,
                    "course_name": training_session.course_name,
                    "approval_token": approval.approval_token,
                    "attendee_count": len(attendee_data),
                    "approval_deadline": approval.approval_deadline,
                    "finalized_by": actor,
                }
            else:
                approval.status = ApprovalStatus.APPROVED
                approval.approved_by = str(actor) if actor else None
                approval.approved_at = now
                credit.pipeline_updates = await self._finalize_training_records(
                    approval=approval,
                    attendees=[AttendeeApprovalData(**a) for a in attendee_data],
                    approved_by=actor,
                    credited_minutes=credited,
                )
                credit.records_completed = len(credited)
                credit.sweep_session_id = str(training_session.id)

        await self.void_event_records(
            event.id,
            org,
            event_title=event.title,
            keep_user_ids=set(credited),
            legacy_course_name=training_session.course_name,
            legacy_dates=event_dates,
            legacy_user_ids=removed,
        )

        training_session.is_finalized = True
        training_session.finalized_at = now
        training_session.finalized_by = str(actor) if actor else None
        training_session.updated_at = now
        await self.db.flush()
        return credit

    async def _write_sessionless_records(
        self,
        event: Event,
        credited: Dict[str, int],
        event_date: date,
        actor: Optional[UUID],
        organization_id: str,
        now: datetime,
    ) -> None:
        """Completed records for a Training event with no training details.

        Filed under the event's title as Continuing Education — the same
        default a session gets when nothing more specific is known. Matched on
        the source alone: a manual record that happens to share the title and
        date is somebody else's entry and is never taken over.
        """
        for user_id, minutes in credited.items():
            result = await self.db.execute(
                EventService.event_training_record_query(
                    organization_id, user_id, event.id, lock=True
                )
            )
            record = result.scalars().first()
            if record is None:
                record = TrainingRecord(
                    organization_id=organization_id,
                    user_id=user_id,
                    source_event_id=str(event.id),
                    created_by=str(actor) if actor else None,
                    hours_completed=0.0,
                    course_name=event.title,
                    training_type=TrainingType.CONTINUING_EDUCATION,
                )
                self.db.add(record)
            record.course_name = event.title
            record.course_id = None
            record.course_code = None
            record.category_id = None
            record.training_type = TrainingType.CONTINUING_EDUCATION
            record.scheduled_date = event_date
            record.completion_date = event_date
            record.hours_completed = round(minutes / 60.0, 2)
            record.status = TrainingStatus.COMPLETED
            record.location_id = str(event.location_id) if event.location_id else None
            # The record's column is shorter than the event's.
            record.location = (event.location or "")[:255] or None
            record.updated_at = now

    async def _hold_pending_records(
        self,
        training_session: TrainingSession,
        event: Event,
        credited: Dict[str, int],
        event_dates: List[date],
        actor: Optional[UUID],
        organization_id: str,
    ) -> None:
        """An in-progress record per attendee while the approval is pending.

        So the member's training history shows the class as in progress rather
        than nothing at all. A record an earlier finalize already completed is
        not taken back to in-progress: that credit stands until the officer's
        approval replaces it.
        """
        for user_id in credited:
            result = await self.db.execute(
                EventService.event_training_record_query(
                    organization_id,
                    user_id,
                    event.id,
                    adopt_course_name=training_session.course_name,
                    dates=event_dates,
                    lock=True,
                )
            )
            record = result.scalars().first()
            if record is not None:
                record.source_event_id = str(event.id)
                continue
            self.db.add(
                TrainingRecord(
                    organization_id=organization_id,
                    user_id=user_id,
                    source_event_id=str(event.id),
                    course_id=(
                        str(training_session.course_id)
                        if training_session.course_id
                        else None
                    ),
                    category_id=(
                        str(training_session.category_id)
                        if training_session.category_id
                        else None
                    ),
                    course_name=training_session.course_name,
                    course_code=training_session.course_code,
                    training_type=training_session.training_type
                    or TrainingType.CONTINUING_EDUCATION,
                    scheduled_date=event_dates[0],
                    completion_date=None,
                    status=TrainingStatus.IN_PROGRESS,
                    hours_completed=0.0,
                    credit_hours=float(training_session.credit_hours or 0),
                    instructor=training_session.instructor,
                    location=(event.location or "")[:255] or None,
                    created_by=str(actor) if actor else None,
                )
            )

    async def _prior_credit_user_ids(
        self, training_session: TrainingSession, event: Event, organization_id: str
    ) -> Set[str]:
        """Everyone an earlier finalize of this event credited or held.

        Every earlier approval's roster, not just the newest: approvals are
        ordered by a second-precision timestamp, and a reopen-and-finalize
        inside the same second would make "the newest" a coin toss. Plus
        anyone holding a live record this event wrote.
        """
        approvals_result = await self.db.execute(
            select(TrainingApproval.attendee_data)
            .where(TrainingApproval.training_session_id == training_session.id)
            .where(TrainingApproval.organization_id == organization_id)
        )
        user_ids: Set[str] = set()
        for (attendee_data,) in approvals_result.all():
            for entry in attendee_data or []:
                if isinstance(entry, dict) and entry.get("user_id"):
                    user_ids.add(str(entry["user_id"]))

        records_result = await self.db.execute(
            select(TrainingRecord.user_id)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.source_event_id == str(event.id))
            .where(TrainingRecord.status != TrainingStatus.CANCELLED)
        )
        user_ids.update(str(row[0]) for row in records_result.all())
        return user_ids

    @staticmethod
    def _attendee_snapshot_entry(
        event: Event,
        rsvp: EventRSVP,
        user: User,
        effective_end: datetime,
        minutes: int,
    ) -> Dict[str, Any]:
        """One row of an approval's roster, as the approval page shows it.

        The times are the credited ones — an early tap already clamped to the
        start, a manager's corrected check-out in place of the tap — so the
        officer reviews the same figure the member would be credited.
        """
        check_in = EventService._credited_check_in_time(event, rsvp) or (
            EventService._as_utc(event.start_datetime)
        )
        check_out = (
            EventService._as_utc(rsvp.override_check_out_at)
            or EventService._as_utc(rsvp.checked_out_at)
            or EventService._as_utc(effective_end)
        )

        def _iso(value: Optional[datetime]) -> Optional[str]:
            value = EventService._as_utc(value)
            return value.isoformat() if value else None

        return {
            "user_id": str(rsvp.user_id),
            "user_name": _display_name(user),
            "user_email": user.email or "",
            "checked_in_at": _iso(check_in),
            "checked_out_at": _iso(check_out),
            "calculated_duration_minutes": minutes,
            "override_check_in_at": _iso(rsvp.override_check_in_at),
            "override_check_out_at": _iso(rsvp.override_check_out_at),
            "override_duration_minutes": rsvp.override_duration_minutes,
            "approved": False,
            "notes": None,
        }

    async def void_event_records(
        self,
        event_id: Any,
        organization_id: Any,
        *,
        event_title: Optional[str] = None,
        keep_user_ids: Optional[Set[str]] = None,
        only_user_ids: Optional[Set[str]] = None,
        legacy_course_name: Optional[str] = None,
        legacy_dates: Optional[List[date]] = None,
        legacy_user_ids: Optional[Set[str]] = None,
    ) -> int:
        """Take back the credit this event gave, for the members named.

        Covers the records this event's finalize wrote (``source_event_id``),
        optionally narrowed to ``only_user_ids`` and sparing ``keep_user_ids``.
        ``legacy_*`` also reaches records written before the source existed,
        for the listed members only, by course name and the event's day.

        A record that never carried credit — the in-progress placeholder a
        check-in or a pending approval started — is deleted. One that did is
        kept, marked CANCELLED with its hours zeroed and a note of what it had,
        so the member's history shows credit given and taken back rather than
        a record silently vanishing. Hours are zeroed because some totals
        (the profile's Total Hours) sum records of every status.

        Flushes; never commits. Returns how many records it changed.
        """
        from app.services.qualification_service import QualificationService

        org = str(organization_id)
        keep = {str(u) for u in (keep_user_ids or set())}

        sourced = (
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == org)
            .where(TrainingRecord.source_event_id == str(event_id))
        )
        if only_user_ids is not None:
            sourced = sourced.where(
                TrainingRecord.user_id.in_([str(u) for u in only_user_ids])
            )
        if keep:
            sourced = sourced.where(TrainingRecord.user_id.notin_(sorted(keep)))
        records = list(
            (await self.db.execute(sourced.with_for_update())).scalars().all()
        )

        legacy_ids = {str(u) for u in (legacy_user_ids or set())} - keep
        if legacy_course_name and legacy_ids:
            day_dates = list(legacy_dates or [])
            legacy = (
                select(TrainingRecord)
                .where(TrainingRecord.organization_id == org)
                .where(TrainingRecord.source_event_id.is_(None))
                .where(TrainingRecord.user_id.in_(sorted(legacy_ids)))
                .where(TrainingRecord.course_name == legacy_course_name)
                .where(TrainingRecord.status != TrainingStatus.CANCELLED)
                .where(
                    or_(
                        TrainingRecord.scheduled_date.in_(day_dates),
                        TrainingRecord.completion_date.in_(day_dates),
                    )
                )
                .with_for_update()
            )
            records.extend((await self.db.execute(legacy)).scalars().all())

        changed = 0
        touched_courses: List[Tuple[str, str]] = []
        for record in records:
            status = getattr(record.status, "value", record.status)
            if status == TrainingStatus.CANCELLED.value:
                continue
            if record.course_id:
                touched_courses.append((str(record.user_id), str(record.course_id)))
            never_credited = (
                status
                in (TrainingStatus.IN_PROGRESS.value, TrainingStatus.SCHEDULED.value)
                and record.completion_date is None
            )
            if never_credited:
                await self.db.delete(record)
            else:
                label = f"'{event_title}'" if event_title else "the event"
                note = (
                    f"[Voided: removed from {label} attendance; "
                    f"was {float(record.hours_completed or 0):.2f} h]"
                )
                record.notes = f"{record.notes}\n{note}" if record.notes else note
                record.status = TrainingStatus.CANCELLED
                record.hours_completed = 0.0
                record.updated_at = datetime.now(timezone.utc)
            changed += 1

        if touched_courses:
            await self.db.flush()
            qualifications = QualificationService(self.db)
            for user_id, course_id in touched_courses:
                await qualifications.sync_from_training_record(
                    SimpleNamespace(
                        organization_id=org, user_id=user_id, course_id=course_id
                    )
                )
        return changed

    async def void_event_credit(
        self,
        event: Event,
        organization_id: Any,
        *,
        only_user_ids: Optional[Set[str]] = None,
    ) -> Optional[Tuple[str, str]]:
        """Take back the training credit an event's attendance gave.

        For an event about to be deleted, cancelled or re-typed away from
        Training (every attendee), or for one attendee being removed. Records
        this event wrote are voided; for a session-backed event, records from
        before the source link existed are reached by course name and date, for
        the members its approvals rostered (or the named attendee).

        Does not commit. Returns ``(session_id, program_id)`` when the event's
        session fed a program, so the caller can reverse that pipeline credit
        once it has committed (``reverse_event_pipeline_credit``) — the
        reversal commits internally, and a deleted event takes its session row
        with it, so the ids are captured here, before the delete.
        """
        org = str(organization_id)
        training_session = await self.get_session_by_event(event.id, org)
        legacy_ids: Set[str] = set(only_user_ids or ())
        legacy_name = None
        legacy_dates: List[date] = []
        if training_session is not None:
            legacy_name = training_session.course_name
            if only_user_ids is None:
                legacy_ids = await self._prior_credit_user_ids(
                    training_session, event, org
                )
                # The whole event's credit is going, so a link still pending
                # would ask an officer to approve credit for an event that was
                # cancelled, deleted or is no longer training. Every caller
                # holds the event lock, so these are taken after it.
                pending = await self.db.execute(
                    select(TrainingApproval)
                    .where(TrainingApproval.training_session_id == training_session.id)
                    .where(TrainingApproval.organization_id == org)
                    .where(TrainingApproval.status == ApprovalStatus.PENDING)
                    .with_for_update()
                )
                self._supersede(
                    list(pending.scalars().all()), datetime.now(timezone.utc)
                )
            if event.start_datetime is not None:
                tz = await resolve_scheduling_timezone(self.db, org)
                legacy_dates = local_and_utc_dates(event.start_datetime, tz)

        await self.void_event_records(
            event.id,
            org,
            event_title=event.title,
            only_user_ids=only_user_ids,
            legacy_course_name=legacy_name,
            legacy_dates=legacy_dates,
            legacy_user_ids=legacy_ids,
        )
        if training_session is not None and training_session.program_id:
            return str(training_session.id), str(training_session.program_id)
        return None

    async def reverse_event_pipeline_credit(
        self,
        session_ref: Tuple[str, str],
        organization_id: Any,
        user_ids: Optional[Set[str]] = None,
    ) -> None:
        """Reverse the program credit a session gave, after the caller's commit.

        ``user_ids`` None reverses everything the session credited (the event
        is gone or no longer training); otherwise only those members'. Failures
        are logged: the records are already voided and durable, and a pipeline
        that could not be unwound is visible and correctable, where refusing
        the whole removal would not be.
        """
        from app.models.training import ProgressCreditSource
        from app.services.training_program_service import TrainingProgramService

        session_id, program_id = session_ref
        program_service = TrainingProgramService(self.db)
        try:
            if user_ids is None:
                await program_service.reverse_credits_for_source(
                    organization_id=organization_id,
                    source_id=session_id,
                    source_type=ProgressCreditSource.TRAINING_SESSION,
                )
                return
            reference = SimpleNamespace(id=session_id, program_id=program_id)
            for user_id in sorted(user_ids):
                await self._revoke_pipeline_credit_for_user(
                    program_service=program_service,
                    user_id=user_id,
                    training_session=reference,
                    organization_id=organization_id,
                    verified_by=None,
                    source_type=ProgressCreditSource.TRAINING_SESSION,
                )
        except Exception:
            logger.exception(
                "Failed to reverse pipeline credit for training session {}", session_id
            )

    async def reopen_for_event(
        self, event: Event, organization_id: UUID, now: datetime
    ) -> None:
        """Reopen the event's session alongside the event's attendance.

        The event lock is the authority; the session's flag follows it. Any
        approval still pending was issued against numbers the reopen exists to
        correct, so its link is expired — finalizing again issues a fresh one.
        Records are left as they are: the next finalize updates them in place.
        Never commits; the caller's reopen does.
        """
        training_session, pending = await self.lock_for_event_finalize(
            event, organization_id
        )
        if training_session is None:
            return
        self._supersede(pending, now)
        training_session.is_finalized = False
        training_session.finalized_at = None
        training_session.finalized_by = None
        training_session.updated_at = now

    async def after_event_attendance_recorded(
        self,
        credit: EventTrainingCredit,
        organization_id: UUID,
        actor: Optional[UUID],
        can_manage_training: bool,
    ) -> None:
        """The steps that must wait for finalize's commit.

        Pipeline credit and its reversal commit internally, so they cannot run
        inside the transaction holding the event lock. Each step logs its own
        failure: the records and the lock are already durable, and one failing
        member's pipeline must not take the rest with it.
        """
        from app.models.training import ProgressCreditSource
        from app.services.training_program_service import TrainingProgramService

        if (
            credit.session_id
            and credit.program_id
            and credit.removed_user_ids
            and actor
        ):
            session_result = await self.db.execute(
                select(TrainingSession)
                .where(TrainingSession.id == credit.session_id)
                .where(TrainingSession.organization_id == str(organization_id))
            )
            training_session = session_result.scalar_one_or_none()
            if training_session is not None:
                program_service = TrainingProgramService(self.db)
                for user_id in sorted(credit.removed_user_ids):
                    try:
                        await self._revoke_pipeline_credit_for_user(
                            program_service=program_service,
                            user_id=user_id,
                            training_session=training_session,
                            organization_id=organization_id,
                            verified_by=actor,
                            source_type=ProgressCreditSource.TRAINING_SESSION,
                        )
                    except Exception:
                        logger.exception(
                            "Failed to revoke pipeline credit for removed attendee {}",
                            user_id,
                        )
                await self.db.commit()

        if actor and (credit.pipeline_updates or credit.sweep_session_id):
            try:
                await self._apply_pipeline_updates(
                    credit.pipeline_updates,
                    organization_id,
                    actor,
                    can_manage_training,
                    session_id=credit.sweep_session_id,
                )
            except Exception:
                logger.exception(
                    "Failed to apply pipeline credit for session {}", credit.session_id
                )

        if credit.notify and actor:
            await self._notify_training_officers(**credit.notify)

    async def get_approval_summary_for_event(
        self,
        event_id: UUID,
        organization_id: UUID,
        include_token: bool,
    ) -> Optional[Dict[str, Any]]:
        """Where this event's training approval stands, or None if it has none.

        A pending, unexpired approval is the one that matters and wins;
        otherwise the most recent. The token is the approval link's secret and
        is returned only for a pending, unexpired approval and only when the
        caller may approve.
        """
        session = await self.get_session_by_event(event_id, organization_id)
        if session is None:
            return None
        result = await self.db.execute(
            select(TrainingApproval)
            .where(TrainingApproval.training_session_id == session.id)
            .where(TrainingApproval.organization_id == str(organization_id))
            .order_by(TrainingApproval.created_at.desc())
        )
        approvals = list(result.scalars().all())
        if not approvals:
            return None

        now = datetime.now(timezone.utc)

        def _expired(approval: TrainingApproval) -> bool:
            expires = EventService._as_utc(approval.token_expires_at)
            return expires is not None and now > expires

        chosen = next(
            (
                a
                for a in approvals
                if a.status == ApprovalStatus.PENDING and not _expired(a)
            ),
            approvals[0],
        )
        # The newest finalize credited nobody (record_event_attendance leaves an
        # empty approval for exactly this): there is nothing approved or
        # awaited to report, and an older approval would describe credit that
        # has since been taken back. "Newest" is by a one-second created_at, so
        # a reopen and re-finalize inside the second of the first finalize
        # would tie; nothing here depends on it but this display.
        if not chosen.attendee_data and chosen.status != ApprovalStatus.PENDING:
            return None
        status_value = getattr(chosen.status, "value", chosen.status)
        pending_and_live = chosen.status == ApprovalStatus.PENDING and not _expired(
            chosen
        )
        return {
            "approval_id": chosen.id,
            "status": status_value,
            "approval_deadline": chosen.approval_deadline,
            "approved_at": chosen.approved_at,
            "attendee_count": len(chosen.attendee_data or []),
            "expired": _expired(chosen),
            "token": (
                chosen.approval_token if include_token and pending_and_live else None
            ),
        }

    async def _notify_training_officers(
        self,
        organization_id: UUID,
        event_title: str,
        event_start: datetime,
        course_name: str,
        approval_token: str,
        attendee_count: int,
        approval_deadline: datetime,
        finalized_by: UUID,
    ) -> None:
        """
        Send email notifications to training officers about pending approval.
        """
        from app.models.user import user_roles
        from app.services.email_policy import (
            EmailKind,
            department_required_kinds,
            recipients_for,
        )
        from app.services.email_service import EmailService

        try:
            # Get training officer role
            role_result = await self.db.execute(
                select(Role)
                .where(Role.slug == ROLE_TRAINING_OFFICER)
                .where(Role.organization_id == str(organization_id))
            )
            training_officer_role = role_result.scalar_one_or_none()

            if not training_officer_role:
                # No training officer role configured, skip notification
                return

            # Get users with training officer role
            users_result = await self.db.execute(
                select(User)
                .join(user_roles, User.id == user_roles.c.user_id)
                .where(user_roles.c.position_id == training_officer_role.id)
                .where(User.organization_id == str(organization_id))
            )
            training_officers = list(users_result.scalars().all())

            if not training_officers:
                return

            # Load organization for org-specific email settings
            from app.models.user import Organization

            org_result = await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
            org = org_result.scalar_one_or_none()

            # Get officer emails
            to_emails = [
                officer.email
                for officer in recipients_for(
                    training_officers,
                    EmailKind.TRAINING_DUTIES,
                    department_required_kinds(org),
                )
                if officer.email
            ]

            if not to_emails:
                return

            # Get submitter name
            submitter_result = await self.db.execute(
                select(User).where(User.id == str(finalized_by))
            )
            submitter = submitter_result.scalar_one_or_none()
            submitter_name = (
                f"{submitter.first_name} {submitter.last_name}" if submitter else None
            )

            # Build approval URL
            approval_url = f"{settings.FRONTEND_URL}/training/approve/{approval_token}"

            # Send email
            email_service = EmailService(organization=org)
            await email_service.send_training_approval_request(
                to_emails=to_emails,
                event_title=event_title,
                course_name=course_name,
                event_date=event_start,
                approval_url=approval_url,
                attendee_count=attendee_count,
                approval_deadline=approval_deadline,
                submitter_name=submitter_name,
                db=self.db,
                organization_id=str(organization_id),
            )

        except Exception as e:
            # Log error but don't fail the finalization
            logger.error(f"Failed to send training officer notification: {e}")

    async def get_training_approval_by_token(
        self,
        token: str,
        organization_id: UUID,
    ) -> Tuple[Optional[dict], Optional[str]]:
        """
        Get training approval by token for approval page

        The approval response contains attendee PII (names, emails), so the
        lookup is scoped to the caller's organization — the token is not a
        standalone authorization boundary (see submit_training_approval).

        Returns: (approval_data, error_message)
        """
        approval_result = await self.db.execute(
            select(TrainingApproval).where(
                TrainingApproval.approval_token == token,
                TrainingApproval.organization_id == str(organization_id),
            )
        )
        approval = approval_result.scalar_one_or_none()

        if not approval:
            return None, "Invalid approval link"

        # Check if token is expired
        token_exp = (
            approval.token_expires_at.replace(tzinfo=timezone.utc)
            if approval.token_expires_at.tzinfo is None
            else approval.token_expires_at
        )
        if datetime.now(timezone.utc) > token_exp:
            return None, "This approval link has expired"

        # Get event and training session details. Org-scoped although the ids
        # come from an approval already scoped to the caller's org, so the rule
        # holds by inspection (pitfall #14a).
        event_result = await self.db.execute(
            select(Event).where(
                Event.id == approval.event_id,
                Event.organization_id == str(organization_id),
            )
        )
        event = event_result.scalar_one_or_none()

        session_result = await self.db.execute(
            select(TrainingSession).where(
                TrainingSession.id == approval.training_session_id,
                TrainingSession.organization_id == str(organization_id),
            )
        )
        training_session = session_result.scalar_one_or_none()

        if not event or not training_session:
            return None, "Training session or event not found"

        approval_data = {
            "id": approval.id,
            "training_session_id": approval.training_session_id,
            "event_id": approval.event_id,
            "status": approval.status.value,
            "approval_deadline": approval.approval_deadline,
            "event_title": event.title,
            "event_start_datetime": event.start_datetime,
            "event_end_datetime": event.end_datetime,
            "course_name": training_session.course_name,
            "credit_hours": training_session.credit_hours,
            "attendees": approval.attendee_data,
            "approved_by": approval.approved_by,
            "approved_at": approval.approved_at,
            "approval_notes": approval.approval_notes,
            "created_at": approval.created_at,
        }

        return approval_data, None

    async def submit_training_approval(
        self,
        token: str,
        attendees: list[AttendeeApprovalData],
        approval_notes: Optional[str],
        approved_by: UUID,
        organization_id: UUID,
        can_manage_training: bool = False,
    ) -> Tuple[bool, Optional[str]]:
        """
        Submit training approval and update training records

        Returns: (success, error_message)
        """
        # Get approval. The token alone is not an authorization boundary:
        # it travels by email and can leak, so the approving user must
        # belong to the approval's organization. Filtering here (rather
        # than comparing after fetch) also avoids revealing whether a
        # foreign-org token exists. A plain read, for its event and session:
        # the locks below are taken in the order every writer uses.
        found = await self.db.execute(
            select(TrainingApproval.event_id, TrainingApproval.training_session_id)
            .where(TrainingApproval.approval_token == token)
            .where(TrainingApproval.organization_id == str(organization_id))
        )
        ids = found.one_or_none()
        if ids is None:
            return False, "Invalid approval link"
        event_id, session_id = ids

        # Event, session, approval — the order finalize, reopen, cancel and
        # retype lock in. Each of those can make this approval stand for
        # nothing, and whichever commits first, the other sees its outcome:
        # a reopen or re-finalize has expired the link, a cancel or a retype
        # has marked the event, and an approval that won leaves nothing
        # pending for them to void.
        event = (
            await self.db.execute(
                select(Event)
                .where(Event.id == str(event_id))
                .where(Event.organization_id == str(organization_id))
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        training_session = (
            await self.db.execute(
                select(TrainingSession)
                .where(TrainingSession.id == str(session_id))
                .where(TrainingSession.organization_id == str(organization_id))
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if event is None or training_session is None:
            return False, "Training session or event not found"
        approval = (
            await self.db.execute(
                select(TrainingApproval)
                .where(TrainingApproval.approval_token == token)
                .where(TrainingApproval.organization_id == str(organization_id))
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if approval is None:
            return False, "Invalid approval link"

        if approval.status != ApprovalStatus.PENDING:
            return False, "This training session has already been processed"

        # Check if token is expired
        token_exp = (
            approval.token_expires_at.replace(tzinfo=timezone.utc)
            if approval.token_expires_at.tzinfo is None
            else approval.token_expires_at
        )
        if datetime.now(timezone.utc) > token_exp:
            return False, "This approval link has expired"
        # A reopen clears the flag and expires the link together; checked
        # separately so the refusal does not depend on a timestamp alone.
        if not training_session.is_finalized:
            return False, "This approval link has expired"
        if event.is_cancelled or not EventService.event_credits_training(event):
            return False, "This event was cancelled or is no longer a Training event"

        # The roster is the one this approval was issued for, exactly. The
        # request names attendees by user id: without the membership check an
        # approver could write a completed record — and an attendance override
        # — for any member of the organization (XC-1); without the coverage
        # check a partial submission approved the rest into limbo, their
        # in-progress records left with nothing pending to complete them.
        roster = {
            str(entry.get("user_id")): entry
            for entry in (approval.attendee_data or [])
            if isinstance(entry, dict) and entry.get("user_id")
        }
        submitted_ids = [str(a.user_id) for a in attendees]
        if any(uid not in roster for uid in submitted_ids):
            return False, "Attendee is not part of this approval"
        if len(submitted_ids) != len(set(submitted_ids)):
            return False, "An attendee is listed more than once"
        if set(submitted_ids) != set(roster):
            return (
                False,
                "Every attendee on this approval must be included; approve 0 "
                "minutes to give a member no credit",
            )
        # Checked here rather than on the schema: AttendeeApprovalData also
        # parses the stored snapshot, where a bound would reject old rows.
        if any(
            a.override_duration_minutes is not None and a.override_duration_minutes < 0
            for a in attendees
        ):
            return False, "Approved minutes cannot be negative"

        # Every member approved still has their attendance on the event. One
        # removed since cannot be credited from the officer's figure alone —
        # the roster changed, and finalizing again is what reflects that.
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event.id))
            .where(EventRSVP.organization_id == str(organization_id))
            .where(EventRSVP.user_id.in_(sorted(roster)))
        )
        rsvps = {str(r.user_id): r for r in rsvp_result.scalars().all()}
        if set(rsvps) != set(roster):
            return (
                False,
                "A member on this approval is no longer on the event's attendance; "
                "reopen the event's attendance and finalize it again",
            )

        # Update approval record
        approval.status = ApprovalStatus.APPROVED
        approval.approved_by = str(approved_by)
        approval.approved_at = datetime.now(timezone.utc)
        approval.approval_notes = approval_notes
        # The stored roster is the server's, with only what an officer may
        # change taken from the request — a client-sent name or email must not
        # rewrite the record of who attended. mode="json": attendee_data is a
        # JSON column and the engine has no custom serializer, so the UUIDs and
        # datetimes a python-mode dump carries failed every submission at flush.
        approval.attendee_data = [
            {
                **roster[str(a.user_id)],
                **a.model_dump(mode="json", include=_APPROVER_EDITABLE_FIELDS),
            }
            for a in attendees
        ]

        # Update RSVP records with overrides.
        #
        # This writes attendance on an event whose own attendance lock may
        # already be closed, and that is deliberate: the officer approval is
        # the designated correction path for training time, gated on the
        # officer rather than on events.manage. Because it can move a duration
        # after finalize credited one, each corrected RSVP is resynced into the
        # hours ledger below — otherwise the training record shows the
        # officer's number while admin hours keeps the finalized one.
        corrected_rsvps = []
        for attendee in attendees:
            rsvp = rsvps.get(str(attendee.user_id))

            if rsvp:
                if attendee.override_check_in_at is not None:
                    rsvp.override_check_in_at = attendee.override_check_in_at
                if attendee.override_check_out_at is not None:
                    rsvp.override_check_out_at = attendee.override_check_out_at
                if attendee.override_duration_minutes is not None:
                    rsvp.override_duration_minutes = attendee.override_duration_minutes
                elif (
                    attendee.override_check_in_at is not None
                    and attendee.override_check_out_at is not None
                ):
                    # Times without minutes: derive the duration from them, as
                    # Edit Times does, so the RSVP and the record it feeds agree.
                    span = (
                        attendee.override_check_out_at - attendee.override_check_in_at
                    ).total_seconds() / 60
                    rsvp.override_duration_minutes = max(0, int(span))

                rsvp.overridden_by = str(approved_by)
                rsvp.overridden_at = datetime.now(timezone.utc)
                corrected_rsvps.append(rsvp)

        # Create/Update TrainingRecords with final hours and mark as completed.
        # Do this BEFORE committing so that approval + records are atomic.
        # If _finalize_training_records fails, the entire transaction rolls back.
        try:
            pipeline_updates = await self._finalize_training_records(
                approval=approval,
                attendees=attendees,
                approved_by=approved_by,
            )
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise

        # Feed the pipeline after the approval+records commit — the real updater
        # commits internally, so it must run outside the atomic block above.
        await self._apply_pipeline_updates(
            pipeline_updates,
            organization_id,
            approved_by,
            can_manage_training,
            session_id=str(approval.training_session_id),
        )

        await self._resync_admin_hours(
            approval.event_id, organization_id, corrected_rsvps
        )

        return True, None

    async def _finalize_training_records(
        self,
        approval: TrainingApproval,
        attendees: list[AttendeeApprovalData],
        approved_by: Optional[UUID],
        credited_minutes: Optional[Dict[str, int]] = None,
    ) -> List[Tuple[str, str, str, float, str]]:
        """
        Create or update TrainingRecords for all approved attendees.

        Every record written here carries ``source_event_id``: it is the credit
        for this event, and finalizing again after a reopen updates that same
        row. A row from before the source existed (a member's own check-in
        started it, or a pre-upgrade finalize completed it) is adopted by the
        course name and the event's day and stamped.

        Minutes come from ``credited_minutes`` when the event's finalize
        supplies them — the credited-minutes rule applied to each RSVP. An
        officer approving on the approval page supplies the approved figure as
        the attendee's override instead; with neither, the RSVP is read and the
        same rule applied. An attendee with nothing to credit has any record
        this event wrote voided rather than kept at stale hours.

        Returns a list of ``(user_id, program_id, requirement_id, hours)`` pipeline
        updates for program-linked sessions. These are NOT applied here — the real
        progress updater commits internally, so the caller applies them via
        ``_apply_pipeline_updates`` after its own approval+records commit.
        """
        pipeline_updates: List[Tuple[str, str, str, float, str]] = []
        completed_records: List[Any] = []
        # Courses whose qualification has to be recomputed because a record
        # stopped pointing at them (the session's course was cleared or
        # changed).
        detached_courses: List[Tuple[str, str]] = []

        # Get training session details
        session_result = await self.db.execute(
            select(TrainingSession)
            .options(selectinload(TrainingSession.course))
            .where(TrainingSession.id == approval.training_session_id)
        )
        training_session = session_result.scalar_one_or_none()

        if not training_session:
            return pipeline_updates

        # Get event details for dates
        event_result = await self.db.execute(
            select(Event).where(Event.id == approval.event_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return pipeline_updates

        organization_id = str(training_session.organization_id)
        event_id = str(approval.event_id)

        # A record's date is the session's day on the department's calendar:
        # the event's UTC date is already tomorrow for an evening session, which
        # filed an 8 PM drill on the 31st under the next month's compliance.
        # Records written before that carry the UTC date, so lookups accept both.
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        event_dates = local_and_utc_dates(event.start_datetime, tz)
        event_date = event_dates[0]

        # A session marked ineligible for certification still creates records
        # (members keep general credit) but never feeds pipeline/certificate
        # requirements — skip resolving them entirely.
        feeds_certificate = getattr(
            training_session, "counts_toward_certification", True
        )

        # When a session is tied to a program + category (but no explicit
        # requirement), resolve the program's requirements in that category once,
        # so attendance advances them too. Same for everyone on this session.
        category_requirement_ids: List[str] = []
        if (
            feeds_certificate
            and training_session.program_id
            and training_session.category_id
            and not training_session.requirement_id
        ):
            category_requirement_ids = await self._resolve_category_requirement_ids(
                training_session.program_id,
                training_session.category_id,
                training_session.phase_id,
            )

        course_code = getattr(training_session, "course_code", None) or (
            training_session.course.code if training_session.course else None
        )
        now = datetime.now(timezone.utc)

        for attendee in attendees:
            user_id = str(attendee.user_id)
            minutes: Optional[int]
            if credited_minutes is not None and user_id in credited_minutes:
                minutes = credited_minutes[user_id]
            elif attendee.override_duration_minutes is not None:
                minutes = max(0, int(attendee.override_duration_minutes))
            else:
                rsvp_result = await self.db.execute(
                    select(EventRSVP)
                    .where(EventRSVP.event_id == event_id)
                    .where(EventRSVP.user_id == user_id)
                    .where(EventRSVP.organization_id == organization_id)
                )
                rsvp = rsvp_result.scalar_one_or_none()
                minutes = (
                    EventService.credited_minutes(
                        event, rsvp, EventService.effective_end(event)
                    )
                    if rsvp is not None
                    else None
                )

            if not minutes or minutes <= 0:
                await self.void_event_records(
                    event_id,
                    organization_id,
                    event_title=getattr(event, "title", None),
                    only_user_ids={user_id},
                )
                continue

            hours_completed = round(minutes / 60.0, 2)

            existing_record_result = await self.db.execute(
                EventService.event_training_record_query(
                    organization_id,
                    user_id,
                    event_id,
                    adopt_course_name=training_session.course_name,
                    dates=event_dates,
                    lock=True,
                )
            )
            existing_record = existing_record_result.scalars().first()

            if existing_record:
                existing_record.source_event_id = event_id
                existing_record.hours_completed = hours_completed
                existing_record.scheduled_date = event_date
                existing_record.completion_date = event_date
                existing_record.status = TrainingStatus.COMPLETED
                # Carry the session's current details across too. Reopening is
                # what makes this reachable: a leader corrects a session filed
                # against the wrong category or course, re-finalizes, and the
                # screen says it worked — while the member's stored record kept
                # the old one and kept reporting under it.
                existing_record.course_name = training_session.course_name
                existing_record.course_code = course_code
                existing_record.training_type = (
                    training_session.training_type or TrainingType.CONTINUING_EDUCATION
                )
                existing_record.category_id = (
                    str(training_session.category_id)
                    if training_session.category_id
                    else None
                )
                # Moved off a course — cleared, or switched to another — the
                # old course's qualification is recomputed without this record,
                # or the member keeps a credential nothing supports any more.
                old_course_id = (
                    str(existing_record.course_id)
                    if existing_record.course_id
                    else None
                )
                new_course_id = (
                    str(training_session.course_id)
                    if training_session.course_id
                    else None
                )
                if old_course_id and old_course_id != new_course_id:
                    detached_courses.append((user_id, old_course_id))
                existing_record.course_id = new_course_id
                existing_record.updated_at = now
                completed_records.append(existing_record)
            else:
                training_record = TrainingRecord(
                    organization_id=organization_id,
                    user_id=user_id,
                    source_event_id=event_id,
                    course_id=(
                        str(training_session.course_id)
                        if training_session.course_id
                        else None
                    ),
                    category_id=(
                        str(training_session.category_id)
                        if training_session.category_id
                        else None
                    ),
                    course_name=training_session.course_name,
                    course_code=course_code,
                    training_type=training_session.training_type
                    or TrainingType.CONTINUING_EDUCATION,
                    scheduled_date=event_date,
                    completion_date=event_date,
                    hours_completed=hours_completed,
                    credit_hours=float(training_session.credit_hours or 0),
                    status=TrainingStatus.COMPLETED,
                    instructor=training_session.instructor,
                    # The record's column is shorter than the event's.
                    location=(getattr(event, "location", None) or "")[:255] or None,
                    created_by=str(approved_by) if approved_by else None,
                )
                self.db.add(training_record)
                completed_records.append(training_record)

            # Queue pipeline progress updates to apply AFTER this transaction
            # commits (the real updater commits internally). Only positive hours
            # advance, and only when the session counts toward certification. An
            # explicit requirement link wins; otherwise fan out to the program's
            # requirements matching the session's category.
            if feeds_certificate and training_session.program_id:
                if training_session.requirement_id:
                    pipeline_updates.append(
                        (
                            user_id,
                            str(training_session.program_id),
                            str(training_session.requirement_id),
                            hours_completed,
                            str(training_session.id),
                        )
                    )
                else:
                    for req_id in category_requirement_ids:
                        pipeline_updates.append(
                            (
                                user_id,
                                str(training_session.program_id),
                                req_id,
                                hours_completed,
                                str(training_session.id),
                            )
                        )

        # Grant the qualifications these completions certify. Approving
        # attendance is the ordinary way a scheduled class becomes a completed
        # record, so a course carrying ``grants_qualification`` has to confer it
        # here too -- otherwise the credential is recorded and the member is
        # still not cleared for the seat it qualifies them for.
        #
        # Flushed rather than committed, and no exception is swallowed: this
        # runs inside the caller's approval+records transaction, and a failure
        # here should roll the whole thing back rather than finalize attendance
        # against a half-written qualification.
        if completed_records or detached_courses:
            from app.services.qualification_service import QualificationService

            await self.db.flush()
            qualifications = QualificationService(self.db)
            for completed in completed_records:
                await qualifications.sync_from_training_record(completed)
            # A record that no longer names a course no longer supports the
            # qualification that course confers; recompute it without them.
            # After the flush above, so the recompute sees the record moved.
            for user_id, course_id in detached_courses:
                await qualifications.sync_from_training_record(
                    SimpleNamespace(
                        organization_id=organization_id,
                        user_id=user_id,
                        course_id=course_id,
                    )
                )

        # NOTE: Callers are responsible for commit/rollback to keep approval +
        # record creation atomic; they apply the returned pipeline updates only
        # after that commit succeeds.
        return pipeline_updates

    async def _resolve_category_requirement_ids(
        self, program_id: str, category_id: str, phase_id: Optional[str]
    ) -> List[str]:
        """HOURS requirement ids in ``program_id`` whose training requirement is
        tagged with ``category_id`` and belongs to ``phase_id`` — used to advance
        category-linked (rather than requirement-linked) sessions. A null phase
        only matches program-level requirements, never requirements in a phase.

        Restricted to HOURS requirements on purpose: a session credits *hours*,
        so fanning those hours out to a COURSES/SHIFTS/CALLS requirement would
        misread e.g. 3.5 hours as 3.5 courses. Non-hours requirements must be
        satisfied by an explicit requirement link on the session, a skills test,
        or officer sign-off — never by a category-matched hours feed."""
        from app.models.training import (
            ProgramRequirement,
            RequirementType,
            TrainingRequirement,
        )

        result = await self.db.execute(
            select(ProgramRequirement.requirement_id)
            .join(
                TrainingRequirement,
                ProgramRequirement.requirement_id == TrainingRequirement.id,
            )
            .where(
                ProgramRequirement.program_id == str(program_id),
                ProgramRequirement.phase_id
                == (str(phase_id) if phase_id is not None else None),
                TrainingRequirement.category_ids.contains([str(category_id)]),
                TrainingRequirement.requirement_type == RequirementType.HOURS,
            )
        )
        return [row[0] for row in result.all()]

    async def _apply_pipeline_updates(
        self,
        updates: List[Tuple[str, str, str, float, str]],
        organization_id: UUID,
        verified_by: UUID,
        can_manage_training: bool = False,
        session_id: Optional[str] = None,
    ) -> None:
        """Apply queued session→pipeline progress updates after the approval has
        committed. Each update commits independently; a failure on one is logged
        and never blocks the others (the training records are already saved).

        Then sweep: anything this session previously credited that it no longer
        feeds is reversed. Restating only the current destinations is not
        enough on a re-finalize, because a reopen can change where the session
        points. Correcting its program, requirement or category linkage moves
        the credit to different requirement rows with different ``progress_id``
        values, leaving the old ones standing and the member counted twice; and
        correcting a member down to zero hours never queues an update at all
        (the queue is gated on positive hours), so their previous credit would
        otherwise survive the correction untouched.
        """
        credited_progress_ids: set = set()
        session_ids: set = set()
        all_resolved = True
        for user_id, program_id, requirement_id, hours, update_session_id in updates:
            session_ids.add(str(update_session_id))
            progress_id, resolved = await self._apply_pipeline_progress(
                user_id=user_id,
                program_id=program_id,
                requirement_id=requirement_id,
                hours_completed=hours,
                organization_id=organization_id,
                verified_by=verified_by,
                session_id=update_session_id,
                can_manage_training=can_manage_training,
            )
            if progress_id:
                credited_progress_ids.add(str(progress_id))
            if not resolved:
                all_resolved = False

        if session_id:
            session_ids.add(str(session_id))
        if not session_ids:
            return

        # The sweep reverses everything outside ``credited_progress_ids``, so it
        # is only safe while that set is the complete picture of what this
        # session still feeds. One unresolved update means it is not, and the
        # two failure directions are not equally bad: leaving stale credit
        # standing is visible and correctable on the next re-finalize, whereas
        # revoking live credit because an update errored is silent and takes
        # away hours the member actually earned. An events.manage caller
        # without training.manage hits this deterministically on every
        # attendee they do not own, which would otherwise turn one refused
        # correction into a wholesale revocation.
        if not all_resolved:
            logger.warning(
                "Skipping stale-credit reconciliation for session(s) {}: "
                "at least one pipeline update could not be resolved, so the "
                "current destination set is incomplete",
                ", ".join(sorted(session_ids)),
            )
            return

        from app.models.training import ProgressCreditSource
        from app.services.training_program_service import TrainingProgramService

        program_service = TrainingProgramService(self.db)
        for session_id in session_ids:
            try:
                await program_service.reverse_credits_for_source_except(
                    organization_id=organization_id,
                    source_id=session_id,
                    keep_progress_ids=credited_progress_ids,
                    source_type=ProgressCreditSource.TRAINING_SESSION,
                    verified_by=verified_by,
                )
            except Exception:
                logger.exception(
                    "Failed to reconcile stale pipeline credit for session {}",
                    session_id,
                )

    async def _resolve_pipeline_enrollment(
        self,
        user_id: str,
        program_id: str,
        session_id: str,
        organization_id: UUID,
    ) -> Optional[ProgramEnrollment]:
        """Pick the one enrollment this session's credit belongs to.

        COMPLETED counts as well as ACTIVE. When this session's own credit is
        what carried the member over 100%, the enrollment is no longer active —
        and an active-only lookup would then skip the correction for precisely
        the member whose credit mattered most.
        ``update_enrollment_progress`` already reactivates an enrollment whose
        progress falls back below 100%, so a downward restatement lands
        correctly rather than stranding a completion nobody earned.

        Widening the status filter makes the result ambiguous, though, because
        ``enroll_member`` rejects only an *active* enrollment: a member who
        finished a program and was enrolled in it again holds a COMPLETED row
        and an ACTIVE row at once. A ``scalar_one_or_none()`` over both raises
        ``MultipleResultsFound``, which the caller's except clause swallows into
        "unresolved" — so the re-enrolled member is the one who silently stops
        being credited.

        The order below resolves it. The enrollment already carrying this
        session's credit wins, because a re-finalize is restating its own
        earlier figure and that figure lives on the enrollment it was first
        applied to; moving it to a newer enrollment would rewrite a completed
        program's history. Failing that the active enrollment is the live one
        and takes new credit, and the most recent completed enrollment is used
        only when there is no active one to prefer. The ordering is what makes
        that last tier a decision rather than whatever the database happened to
        return first.
        """
        result = await self.db.execute(
            select(ProgramEnrollment)
            .where(ProgramEnrollment.user_id == str(user_id))
            .where(ProgramEnrollment.program_id == str(program_id))
            .where(ProgramEnrollment.organization_id == str(organization_id))
            .where(
                ProgramEnrollment.status.in_(
                    (EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED)
                )
            )
            .order_by(ProgramEnrollment.enrolled_at.desc())
        )
        enrollments = list(result.scalars().all())
        if not enrollments:
            return None
        if len(enrollments) == 1:
            return enrollments[0]

        from app.models.training import (
            ProgressCreditSource,
            RequirementProgressCredit,
        )

        credited = await self.db.execute(
            select(RequirementProgress.enrollment_id)
            .join(
                RequirementProgressCredit,
                RequirementProgressCredit.progress_id == RequirementProgress.id,
            )
            .where(
                RequirementProgressCredit.source_type
                == ProgressCreditSource.TRAINING_SESSION,
                RequirementProgressCredit.source_id == str(session_id),
                RequirementProgress.enrollment_id.in_([e.id for e in enrollments]),
            )
        )
        credited_ids = {row[0] for row in credited.all()}
        for enrollment in enrollments:
            if enrollment.id in credited_ids:
                return enrollment

        for enrollment in enrollments:
            if enrollment.status == EnrollmentStatus.ACTIVE:
                return enrollment

        return enrollments[0]

    async def _apply_pipeline_progress(
        self,
        user_id: str,
        program_id: str,
        requirement_id: str,
        hours_completed: float,
        organization_id: UUID,
        verified_by: UUID,
        session_id: str,
        can_manage_training: bool = False,
    ) -> Tuple[Optional[str], bool]:
        """
        Advance a member's linked pipeline requirement when a program-linked
        training session is approved.

        Returns ``(progress_id, resolved)``. ``progress_id`` is the destination
        this session now feeds, so the caller can tell which credit is current
        and reverse the rest. ``resolved`` says whether that answer is
        trustworthy, and the distinction is what keeps the caller's sweep from
        destroying data: a member with no enrollment or no progress row has no
        destination and is resolved (``(None, True)``) — there is genuinely
        nothing here to keep. A permission refusal or an unexpected error is
        NOT (``(None, False)``): the destination may well still be fed, we
        simply could not confirm it, and a sweep that reads that silence as
        "no longer fed" revokes credit the member earned.

        Routes through ``TrainingProgramService.apply_requirement_credit`` — the
        same real updater shift completion uses, wrapped in the idempotency
        ledger keyed on this session — so the requirement percentage,
        auto-completion, enrollment rollup, and phase advancement all run, and
        re-approving/re-finalizing the same session cannot double-credit the
        member's hours. (This previously hand-mutated ``progress_value`` only,
        leaving the pipeline stuck at 0%.)

        Passes ``restate=True``: a session that was reopened and finalized again
        is correcting its own earlier figure, so the credit is restated rather
        than skipped. Replaying the same hours is still a no-op.
        """
        from app.models.training import ProgressCreditSource
        from app.services.training_program_service import TrainingProgramService

        try:
            enrollment = await self._resolve_pipeline_enrollment(
                user_id=user_id,
                program_id=program_id,
                session_id=session_id,
                organization_id=organization_id,
            )
            if not enrollment:
                return None, True

            # Find the requirement progress row for this enrollment
            progress_result = await self.db.execute(
                select(RequirementProgress)
                .where(RequirementProgress.enrollment_id == enrollment.id)
                .where(RequirementProgress.requirement_id == str(requirement_id))
            )
            progress = progress_result.scalar_one_or_none()
            if not progress:
                return None, True

            program_service = TrainingProgramService(self.db)
            _, error = await program_service.apply_requirement_credit(
                progress_id=progress.id,
                organization_id=organization_id,
                source_type=ProgressCreditSource.TRAINING_SESSION,
                source_id=str(session_id),
                units=float(hours_completed),
                verified_by=verified_by,
                applied_by=verified_by,
                # Session lifecycle routes require events.manage, not
                # training.manage. Carry the real actor into the progress
                # updater so an event manager is never elevated to a trusted
                # system caller for training-pipeline writes.
                acting_user_id=verified_by,
                can_manage=can_manage_training,
                # A re-finalize after a reopen is a correction, not a replay.
                # Without this the ledger's idempotency swallows the new figure
                # and the pipeline keeps the hours from the first finalize while
                # the training record shows the corrected ones.
                restate=True,
            )
            if error:
                logger.error(
                    f"Session pipeline feed failed: user={user_id} "
                    f"requirement={requirement_id}: {error}"
                )
                return None, False
            return str(progress.id), True
        except Exception as e:
            logger.error(f"Failed to apply session pipeline progress: {e}")
            return None, False
