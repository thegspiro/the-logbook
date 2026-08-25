"""
Training Session Service

Business logic for training session management, approval workflows, and notifications.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.constants import ROLE_TRAINING_OFFICER
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
    TrainingType,
)
from app.models.user import Role, User
from app.schemas.training_session import (
    AttendeeApprovalData,
    RecurringTrainingSessionCreate,
    TrainingSessionCreate,
    TrainingSessionLinkageUpdate,
)
from app.services.admin_hours_service import AdminHoursService
from app.services.event_service import EventService
from app.services.location_service import LocationService
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import is_in_org


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
        """Update a session's category/program/phase/requirement links.

        Fields omitted from the payload are untouched; explicit nulls clear
        the link. Links only steer *future* crediting — records and pipeline
        progress already written at finalization are not reflowed.

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

        linkage_error = await self._validate_linkage_ids(updates, organization_id)
        if linkage_error:
            return None, linkage_error

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
        """
        Finalize a training session after the event ends

        This creates a TrainingApproval record and triggers email notifications
        to training officers.

        Returns: (training_approval, error_message)
        """
        # Get training session with event and RSVPs
        session_result = await self.db.execute(
            select(TrainingSession)
            .options(selectinload(TrainingSession.event).selectinload(Event.rsvps))
            .where(TrainingSession.id == str(training_session_id))
            .where(TrainingSession.organization_id == str(organization_id))
        )
        training_session = session_result.scalar_one_or_none()

        if not training_session:
            return None, "Training session not found"

        if training_session.is_finalized:
            return None, "Training session is already finalized"

        # Get event through relationship
        event_result = await self.db.execute(
            select(Event)
            .options(selectinload(Event.rsvps))
            .where(Event.id == training_session.event_id)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        # Check if event has ended
        now = datetime.now(timezone.utc)
        event_end = event.actual_end_time or event.end_datetime
        if event_end and event_end.tzinfo is None:
            event_end = event_end.replace(tzinfo=timezone.utc)
        if event_end and now < event_end:
            return None, "Cannot finalize training session before event ends"

        # Get all checked-in attendees
        checked_in_rsvps = [rsvp for rsvp in event.rsvps if rsvp.checked_in]

        if not checked_in_rsvps:
            return None, "No attendees checked in to this training session"

        # Build attendee data
        attendee_data = []
        for rsvp in checked_in_rsvps:
            # Get user details
            user_result = await self.db.execute(
                select(User).where(User.id == rsvp.user_id)
            )
            user = user_result.scalar_one_or_none()

            if not user:
                continue

            # Calculate duration
            check_in = rsvp.override_check_in_at or rsvp.checked_in_at
            check_out = rsvp.override_check_out_at or rsvp.checked_out_at or event_end
            duration_minutes = (
                int((check_out - check_in).total_seconds() / 60)
                if check_in and check_out
                else None
            )

            attendee_data.append(
                {
                    "user_id": str(rsvp.user_id),
                    "user_name": f"{user.first_name} {user.last_name}",
                    "user_email": user.email,
                    "checked_in_at": check_in.isoformat() if check_in else None,
                    "checked_out_at": check_out.isoformat() if check_out else None,
                    "calculated_duration_minutes": duration_minutes,
                    "override_check_in_at": (
                        rsvp.override_check_in_at.isoformat()
                        if rsvp.override_check_in_at
                        else None
                    ),
                    "override_check_out_at": (
                        rsvp.override_check_out_at.isoformat()
                        if rsvp.override_check_out_at
                        else None
                    ),
                    "override_duration_minutes": rsvp.override_duration_minutes,
                    "approved": False,
                    "notes": None,
                }
            )

        # A re-finalize after a reopen has to answer for who is NO LONGER on
        # the roster, not just for who is. Do it before the new approval row
        # exists so "the previous roster" is unambiguous.
        await self._revoke_credit_for_removed_attendees(
            training_session=training_session,
            event=event,
            current_user_ids={str(a["user_id"]) for a in attendee_data},
            organization_id=organization_id,
            verified_by=finalized_by,
        )

        # Generate secure token for approval link
        approval_token = secrets.token_urlsafe(48)
        token_expires_at = now + timedelta(days=30)  # Token valid for 30 days
        approval_deadline = event_end + timedelta(
            days=training_session.approval_deadline_days
        )

        # Create TrainingApproval record
        training_approval = TrainingApproval(
            organization_id=organization_id,
            training_session_id=training_session.id,
            event_id=event.id,
            approval_token=approval_token,
            token_expires_at=token_expires_at,
            status=ApprovalStatus.PENDING,
            approval_deadline=approval_deadline,
            attendee_data=attendee_data,
        )

        self.db.add(training_approval)

        # Mark training session as finalized
        training_session.is_finalized = True
        training_session.finalized_at = now
        training_session.finalized_by = finalized_by

        # When the session does not require explicit instructor confirmation,
        # auto-approve and complete the records immediately rather than routing
        # through the token-based officer approval workflow. (Capture the flag
        # before commit expires the ORM object.)
        requires_confirmation = training_session.require_completion_confirmation
        pipeline_updates: List[Tuple[str, str, str, float, str]] = []
        if not requires_confirmation:
            training_approval.status = ApprovalStatus.APPROVED
            training_approval.approved_by = str(finalized_by)
            training_approval.approved_at = now
            attendees = [AttendeeApprovalData(**a) for a in attendee_data]
            pipeline_updates = await self._finalize_training_records(
                approval=training_approval,
                attendees=attendees,
                approved_by=finalized_by,
            )

        # Capture values before commit expires the relationships
        event_title = event.title
        event_start = event.start_datetime
        session_course = training_session.course_name

        await self.db.commit()
        await self.db.refresh(training_approval)

        # Feed the pipeline after the approval+records commit — the real updater
        # commits internally, so it must run outside the transaction above.
        await self._apply_pipeline_updates(
            pipeline_updates,
            organization_id,
            finalized_by,
            can_manage_training,
            session_id=str(training_session.id),
        )

        # Notify training officers only when their confirmation is required;
        # an auto-approved session has nothing pending to act on.
        if requires_confirmation:
            await self._notify_training_officers(
                organization_id=organization_id,
                event_title=event_title,
                event_start=event_start,
                course_name=session_course,
                approval_token=approval_token,
                attendee_count=len(attendee_data),
                approval_deadline=approval_deadline,
                finalized_by=finalized_by,
            )

        return training_approval, None

    async def _revoke_credit_for_removed_attendees(
        self,
        training_session: TrainingSession,
        event: Event,
        current_user_ids: set,
        organization_id: UUID,
        verified_by: UUID,
    ) -> None:
        """Undo credit for members dropped from the roster during a reopen.

        Re-finalization writes records for whoever is on the roster now. That
        alone is not enough: the reason a leader reopens a session is often that
        somebody was on it who should not have been, and re-finalizing left that
        member's pipeline credit and completed training record exactly where the
        first finalize put them — still counting toward their certification for
        a session they are no longer recorded at.

        The previous roster is the newest prior approval's ``attendee_data``.
        Anyone in it and not in the current roster is reconciled:

        * Pipeline credit is revoked through ``revoke_requirement_credit``, the
          same reversal an officer's un-apply uses, so the requirement
          percentage, enrollment rollup and phase state unwind the way they
          accrued. The ledger key is (progress, source_type, source_id) and
          progress is per member, so this touches only the member who left.
        * The training record is reverted to not-completed rather than deleted.
          Nothing on ``TrainingRecord`` records which session created it — the
          check-in auto-create path writes one before finalization ever runs —
          so deleting could destroy a record this session never authored.
          Zeroing the hours and clearing the completion removes the credit while
          leaving something a human can see and put right.

        Failures are logged, not raised: the finalize that follows is the
        caller's actual request, and losing it to a reconciliation problem on a
        member who already left the roster is the worse outcome.
        """
        from app.models.training import ProgressCreditSource
        from app.services.training_program_service import TrainingProgramService

        prior_result = await self.db.execute(
            select(TrainingApproval)
            .where(TrainingApproval.training_session_id == training_session.id)
            .where(TrainingApproval.organization_id == str(organization_id))
            .order_by(TrainingApproval.created_at.desc())
            .limit(1)
        )
        prior = prior_result.scalar_one_or_none()
        if prior is None:
            return

        prior_user_ids = {
            str(entry.get("user_id"))
            for entry in (prior.attendee_data or [])
            if entry.get("user_id")
        }
        removed = prior_user_ids - {str(uid) for uid in current_user_ids}
        if not removed:
            return

        program_service = TrainingProgramService(self.db)
        event_date = event.start_datetime.date()

        for user_id in removed:
            try:
                await self._revoke_pipeline_credit_for_user(
                    program_service=program_service,
                    user_id=user_id,
                    training_session=training_session,
                    organization_id=organization_id,
                    verified_by=verified_by,
                    source_type=ProgressCreditSource.TRAINING_SESSION,
                )
                await self._uncomplete_training_record(
                    user_id=user_id,
                    training_session=training_session,
                    event_date=event_date,
                )
            except Exception:
                logger.exception(
                    "Failed to reconcile removed attendee {} on session {}",
                    user_id,
                    training_session.id,
                )

        await self.db.commit()

    async def _revoke_pipeline_credit_for_user(
        self,
        program_service,
        user_id: str,
        training_session: TrainingSession,
        organization_id: UUID,
        verified_by: UUID,
        source_type,
    ) -> None:
        """Reverse this session's credit on every requirement it fed for a member."""
        if not training_session.program_id:
            return

        enrollment_result = await self.db.execute(
            select(ProgramEnrollment)
            .where(ProgramEnrollment.user_id == str(user_id))
            .where(ProgramEnrollment.program_id == str(training_session.program_id))
            .where(
                ProgramEnrollment.status.in_(
                    (EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED)
                )
            )
        )
        enrollment = enrollment_result.scalar_one_or_none()
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

    async def _uncomplete_training_record(
        self,
        user_id: str,
        training_session: TrainingSession,
        event_date,
    ) -> None:
        """Take the completion back off a removed attendee's training record."""
        record_result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.user_id == str(user_id))
            .where(
                TrainingRecord.organization_id == str(training_session.organization_id)
            )
            .where(TrainingRecord.course_name == training_session.course_name)
            .where(
                or_(
                    TrainingRecord.scheduled_date == event_date,
                    TrainingRecord.completion_date == event_date,
                )
            )
        )
        record = record_result.scalars().first()
        if record is None:
            return

        record.hours_completed = 0
        record.completion_date = None
        record.status = "scheduled"
        record.updated_at = datetime.now(timezone.utc)

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
            duration = rsvp.override_duration_minutes
            if (
                not duration
                and rsvp.override_check_in_at
                and rsvp.override_check_out_at
            ):
                span = (
                    rsvp.override_check_out_at - rsvp.override_check_in_at
                ).total_seconds() / 60
                duration = max(0, int(span))
            if not duration:
                duration = rsvp.attendance_duration_minutes
            if not check_in or not check_out or not duration or duration <= 0:
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

        Finalizing a session was previously one-way: ``is_finalized`` refused a
        second finalize and nothing ever cleared it, so a member left off the
        roster could not be added and a wrong duration could not be fixed —
        the opposite failure from the event side, which locked nothing at all.

        Reopening clears the flag and kills any approval still outstanding:

        * A PENDING approval's token is expired on the spot. It was emailed to
          the training officers against attendee data that is about to change,
          and the whole point of reopening is that those numbers were wrong.
          Re-finalizing issues a fresh token and a fresh notification.
        * An APPROVED one is left as it is. Its training records were already
          written, and re-finalizing updates them in place rather than
          duplicating (``_finalize_training_records`` matches on user, course
          and event date). Pipeline credit is idempotent per session through
          the progress ledger, so the corrected hours land without
          double-crediting.

        The caller audit-logs who reopened it and why.
        """
        result = await self.db.execute(
            select(TrainingSession)
            .where(TrainingSession.id == str(training_session_id))
            .where(TrainingSession.organization_id == str(organization_id))
            .with_for_update()
        )
        training_session = result.scalar_one_or_none()

        if not training_session:
            return None, "Training session not found"

        if not training_session.is_finalized:
            return None, "Training session is not finalized"

        now = datetime.now(timezone.utc)

        pending_result = await self.db.execute(
            select(TrainingApproval)
            .where(
                TrainingApproval.training_session_id == training_session.id,
                TrainingApproval.status == ApprovalStatus.PENDING,
            )
            .with_for_update()
        )
        for approval in pending_result.scalars().all():
            approval.token_expires_at = now

        training_session.is_finalized = False
        training_session.finalized_at = None
        training_session.finalized_by = None
        training_session.updated_at = now

        await self.db.commit()
        await self.db.refresh(training_session)

        return training_session, None

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

            # Get officer emails
            to_emails = [
                officer.email for officer in training_officers if officer.email
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

            # Load organization for org-specific email settings
            from app.models.user import Organization

            org_result = await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
            org = org_result.scalar_one_or_none()

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

        # Get event and training session details
        event_result = await self.db.execute(
            select(Event).where(Event.id == approval.event_id)
        )
        event = event_result.scalar_one_or_none()

        session_result = await self.db.execute(
            select(TrainingSession).where(
                TrainingSession.id == approval.training_session_id
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
        # foreign-org token exists.
        approval_result = await self.db.execute(
            select(TrainingApproval)
            .where(
                TrainingApproval.approval_token == token,
                TrainingApproval.organization_id == str(organization_id),
            )
            .with_for_update()
        )
        approval = approval_result.scalar_one_or_none()

        if not approval:
            return False, "Invalid approval link"

        if approval.status != ApprovalStatus.PENDING:
            return False, "This training session has already been processed"

        # The FOR UPDATE above serializes this against
        # reopen_training_session, which locks the same row to expire the token.
        # Without it an officer holding a page loaded before the reopen could
        # commit an approval — and its training records — against a session a
        # leader had just opened for correction, leaving the session marked open
        # while carrying an approved result. With it, one of the two transactions
        # reaches the row first and the other sees its outcome: a reopen that
        # committed first has already expired the token, so the expiry check
        # below refuses; an approval that committed first leaves nothing pending
        # for the reopen to void.

        # Check if token is expired
        token_exp = (
            approval.token_expires_at.replace(tzinfo=timezone.utc)
            if approval.token_expires_at.tzinfo is None
            else approval.token_expires_at
        )
        if datetime.now(timezone.utc) > token_exp:
            return False, "This approval link has expired"

        # Update approval record
        approval.status = ApprovalStatus.APPROVED
        approval.approved_by = approved_by
        approval.approved_at = datetime.now(timezone.utc)
        approval.approval_notes = approval_notes
        approval.attendee_data = [a.model_dump(mode="python") for a in attendees]

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
            rsvp_result = await self.db.execute(
                select(EventRSVP)
                .where(EventRSVP.event_id == approval.event_id)
                .where(EventRSVP.user_id == attendee.user_id)
            )
            rsvp = rsvp_result.scalar_one_or_none()

            if rsvp:
                if attendee.override_check_in_at:
                    rsvp.override_check_in_at = attendee.override_check_in_at
                if attendee.override_check_out_at:
                    rsvp.override_check_out_at = attendee.override_check_out_at
                if attendee.override_duration_minutes:
                    rsvp.override_duration_minutes = attendee.override_duration_minutes

                rsvp.overridden_by = approved_by
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
        approved_by: UUID,
    ) -> List[Tuple[str, str, str, float, str]]:
        """
        Create or update TrainingRecords for all approved attendees.

        Calculates final hours from approved durations and marks records as completed.

        Returns a list of ``(user_id, program_id, requirement_id, hours)`` pipeline
        updates for program-linked sessions. These are NOT applied here — the real
        progress updater commits internally, so the caller applies them via
        ``_apply_pipeline_updates`` after its own approval+records commit.
        """
        pipeline_updates: List[Tuple[str, str, str, float, str]] = []

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

        # Process each attendee
        for attendee in attendees:
            # Calculate final hours
            # Priority: override_duration_minutes > calculated from check-in/out > session credit_hours
            hours_completed = 0.0

            if attendee.override_duration_minutes:
                hours_completed = attendee.override_duration_minutes / 60.0
            elif attendee.override_check_in_at and attendee.override_check_out_at:
                # Calculate from override times
                duration = (
                    attendee.override_check_out_at - attendee.override_check_in_at
                )
                hours_completed = duration.total_seconds() / 3600.0
            else:
                # Get actual RSVP check-in/out times
                rsvp_result = await self.db.execute(
                    select(EventRSVP)
                    .where(EventRSVP.event_id == approval.event_id)
                    .where(EventRSVP.user_id == attendee.user_id)
                )
                rsvp = rsvp_result.scalar_one_or_none()

                if rsvp and rsvp.checked_in_at and rsvp.checked_out_at:
                    duration = rsvp.checked_out_at - rsvp.checked_in_at
                    hours_completed = duration.total_seconds() / 3600.0
                else:
                    # Fall back to session credit hours
                    hours_completed = float(training_session.credit_hours or 0)

            # Round to 2 decimal places
            hours_completed = round(hours_completed, 2)

            # Find an existing record for this user/session on the event date.
            # Check-in (auto_create_records) creates an IN_PROGRESS record keyed
            # by scheduled_date with a NULL completion_date, so match on either
            # date and prefer the not-yet-completed one — otherwise finalizing
            # would leave that record orphaned and create a duplicate.
            event_date = event.start_datetime.date()
            existing_record_result = await self.db.execute(
                select(TrainingRecord)
                .where(TrainingRecord.user_id == str(attendee.user_id))
                .where(
                    TrainingRecord.organization_id
                    == str(training_session.organization_id)
                )
                .where(TrainingRecord.course_name == training_session.course_name)
                .where(
                    or_(
                        TrainingRecord.scheduled_date == event_date,
                        TrainingRecord.completion_date == event_date,
                    )
                )
                .order_by(TrainingRecord.completion_date.is_(None).desc())
            )
            existing_record = existing_record_result.scalars().first()

            if existing_record:
                # Promote/refresh the existing record to completed
                existing_record.hours_completed = hours_completed
                existing_record.completion_date = event_date
                existing_record.status = "completed"
                # Carry the session's current links across too. Reopening is
                # what makes this reachable: a leader corrects a session filed
                # against the wrong category, re-finalizes, and the screen says
                # it worked — while the member's stored record kept the old
                # category and kept reporting under it.
                existing_record.category_id = (
                    str(training_session.category_id)
                    if training_session.category_id
                    else None
                )
                if training_session.course_id:
                    existing_record.course_id = str(training_session.course_id)
                existing_record.updated_at = datetime.now(timezone.utc)
            else:
                # Create new training record
                training_record = TrainingRecord(
                    organization_id=str(training_session.organization_id),
                    user_id=str(attendee.user_id),
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
                    course_code=(
                        training_session.course.code
                        if training_session.course
                        else None
                    ),
                    training_type=training_session.training_type
                    or TrainingType.CONTINUING_EDUCATION,
                    scheduled_date=event.start_datetime.date(),
                    completion_date=event.start_datetime.date(),
                    hours_completed=hours_completed,
                    credit_hours=float(training_session.credit_hours or 0),
                    status="completed",
                    instructor=training_session.instructor,
                    location=event.location,
                    created_by=str(approved_by),
                )
                self.db.add(training_record)

            # Queue pipeline progress updates to apply AFTER this transaction
            # commits (the real updater commits internally). Only positive hours
            # advance, and only when the session counts toward certification. An
            # explicit requirement link wins; otherwise fan out to the program's
            # requirements matching the session's category.
            if (
                feeds_certificate
                and training_session.program_id
                and hours_completed > 0
            ):
                if training_session.requirement_id:
                    pipeline_updates.append(
                        (
                            str(attendee.user_id),
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
                                str(attendee.user_id),
                                str(training_session.program_id),
                                req_id,
                                hours_completed,
                                str(training_session.id),
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
        for user_id, program_id, requirement_id, hours, session_id in updates:
            session_ids.add(str(session_id))
            progress_id = await self._apply_pipeline_progress(
                user_id=user_id,
                program_id=program_id,
                requirement_id=requirement_id,
                hours_completed=hours,
                organization_id=organization_id,
                verified_by=verified_by,
                session_id=session_id,
                can_manage_training=can_manage_training,
            )
            if progress_id:
                credited_progress_ids.add(str(progress_id))

        if session_id:
            session_ids.add(str(session_id))
        if not session_ids:
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
    ) -> Optional[str]:
        """
        Advance a member's linked pipeline requirement when a program-linked
        training session is approved.

        Returns the ``progress_id`` it credited, so the caller can tell which
        destinations this session still feeds and reverse the ones it does not.

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
            # Find the member's active enrollment in this program
            # COMPLETED counts as well as ACTIVE. When this session's own
            # credit is what carried the member over 100%, the enrollment is no
            # longer active — and an active-only lookup would then skip the
            # correction for precisely the member whose credit mattered most.
            # update_enrollment_progress already reactivates an enrollment whose
            # progress falls back below 100%, so a downward restatement lands
            # correctly rather than stranding a completion nobody earned.
            enrollment_result = await self.db.execute(
                select(ProgramEnrollment)
                .where(ProgramEnrollment.user_id == str(user_id))
                .where(ProgramEnrollment.program_id == str(program_id))
                .where(
                    ProgramEnrollment.status.in_(
                        (EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED)
                    )
                )
            )
            enrollment = enrollment_result.scalar_one_or_none()
            if not enrollment:
                return None

            # Find the requirement progress row for this enrollment
            progress_result = await self.db.execute(
                select(RequirementProgress)
                .where(RequirementProgress.enrollment_id == enrollment.id)
                .where(RequirementProgress.requirement_id == str(requirement_id))
            )
            progress = progress_result.scalar_one_or_none()
            if not progress:
                return None

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
                return None
            return str(progress.id)
        except Exception as e:
            logger.error(f"Failed to apply session pipeline progress: {e}")
            return None
