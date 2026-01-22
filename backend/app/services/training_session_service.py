"""
Training Session Service

Business logic for training session management, approval workflows, and notifications.
"""

from typing import Optional, Tuple
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
import secrets

from app.models.event import Event, EventRSVP, EventType, CheckInWindowType
from app.models.training import TrainingSession, TrainingCourse, TrainingApproval, ApprovalStatus, TrainingType
from app.models.user import User
from app.schemas.training_session import TrainingSessionCreate, AttendeeApprovalData


class TrainingSessionService:
    """Service for training session management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_training_session(
        self,
        session_data: TrainingSessionCreate,
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[Optional[TrainingSession], Optional[str]]:
        """
        Create a training session (Event + TrainingSession link)

        Returns: (training_session, error_message)
        """
        # Validate dates
        if session_data.end_datetime <= session_data.start_datetime:
            return None, "End date must be after start date"

        if session_data.requires_rsvp and session_data.rsvp_deadline:
            if session_data.rsvp_deadline >= session_data.start_datetime:
                return None, "RSVP deadline must be before event start"

        # Validate course data
        if session_data.use_existing_course:
            if not session_data.course_id:
                return None, "course_id is required when use_existing_course is true"

            # Get existing course
            course_result = await self.db.execute(
                select(TrainingCourse)
                .where(TrainingCourse.id == session_data.course_id)
                .where(TrainingCourse.organization_id == organization_id)
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

        # Create Event
        event = Event(
            organization_id=organization_id,
            title=session_data.title,
            description=session_data.description,
            event_type=EventType.TRAINING,
            location=session_data.location,
            location_details=session_data.location_details,
            start_datetime=session_data.start_datetime,
            end_datetime=session_data.end_datetime,
            requires_rsvp=session_data.requires_rsvp,
            rsvp_deadline=session_data.rsvp_deadline,
            max_attendees=session_data.max_attendees,
            is_mandatory=session_data.is_mandatory,
            eligible_roles=session_data.eligible_roles,
            allow_guests=False,  # Training sessions don't allow guests
            send_reminders=True,
            reminder_hours_before=24,
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
            course_name=course_name,
            course_code=course_code,
            training_type=TrainingType(session_data.training_type),
            credit_hours=session_data.credit_hours,
            instructor=session_data.instructor,
            issues_certification=session_data.issues_certification,
            certification_number_prefix=session_data.certification_number_prefix,
            issuing_agency=session_data.issuing_agency,
            expiration_months=session_data.expiration_months,
            auto_create_records=session_data.auto_create_records,
            require_completion_confirmation=session_data.require_completion_confirmation,
            approval_required=session_data.approval_required,
            approval_deadline_days=session_data.approval_deadline_days,
            created_by=created_by,
        )

        self.db.add(training_session)
        await self.db.commit()
        await self.db.refresh(training_session)

        return training_session, None

    async def finalize_training_session(
        self,
        training_session_id: UUID,
        organization_id: UUID,
        finalized_by: UUID,
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
            .where(TrainingSession.id == training_session_id)
            .where(TrainingSession.organization_id == organization_id)
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
        now = datetime.utcnow()
        event_end = event.actual_end_time or event.end_datetime
        if now < event_end:
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
            duration_minutes = int((check_out - check_in).total_seconds() / 60) if check_in and check_out else None

            attendee_data.append({
                "user_id": str(rsvp.user_id),
                "user_name": f"{user.first_name} {user.last_name}",
                "user_email": user.email,
                "checked_in_at": check_in.isoformat() if check_in else None,
                "checked_out_at": check_out.isoformat() if check_out else None,
                "calculated_duration_minutes": duration_minutes,
                "override_check_in_at": rsvp.override_check_in_at.isoformat() if rsvp.override_check_in_at else None,
                "override_check_out_at": rsvp.override_check_out_at.isoformat() if rsvp.override_check_out_at else None,
                "override_duration_minutes": rsvp.override_duration_minutes,
                "approved": False,
                "notes": None,
            })

        # Generate secure token for approval link
        approval_token = secrets.token_urlsafe(48)
        token_expires_at = now + timedelta(days=30)  # Token valid for 30 days
        approval_deadline = event_end + timedelta(days=training_session.approval_deadline_days)

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

        await self.db.commit()
        await self.db.refresh(training_approval)

        # TODO: Send email notification to training officers
        # This will be implemented in the email service

        return training_approval, None

    async def get_training_approval_by_token(
        self,
        token: str,
    ) -> Tuple[Optional[dict], Optional[str]]:
        """
        Get training approval by token for approval page

        Returns: (approval_data, error_message)
        """
        approval_result = await self.db.execute(
            select(TrainingApproval)
            .where(TrainingApproval.approval_token == token)
        )
        approval = approval_result.scalar_one_or_none()

        if not approval:
            return None, "Invalid approval link"

        # Check if token is expired
        if datetime.utcnow() > approval.token_expires_at:
            return None, "This approval link has expired"

        # Get event and training session details
        event_result = await self.db.execute(
            select(Event).where(Event.id == approval.event_id)
        )
        event = event_result.scalar_one_or_none()

        session_result = await self.db.execute(
            select(TrainingSession).where(TrainingSession.id == approval.training_session_id)
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
    ) -> Tuple[bool, Optional[str]]:
        """
        Submit training approval and update training records

        Returns: (success, error_message)
        """
        # Get approval
        approval_result = await self.db.execute(
            select(TrainingApproval)
            .where(TrainingApproval.approval_token == token)
        )
        approval = approval_result.scalar_one_or_none()

        if not approval:
            return False, "Invalid approval link"

        if approval.status != ApprovalStatus.PENDING:
            return False, "This training session has already been processed"

        # Check if token is expired
        if datetime.utcnow() > approval.token_expires_at:
            return False, "This approval link has expired"

        # Update approval record
        approval.status = ApprovalStatus.APPROVED
        approval.approved_by = approved_by
        approval.approved_at = datetime.utcnow()
        approval.approval_notes = approval_notes
        approval.attendee_data = [a.model_dump(mode='python') for a in attendees]

        # Update RSVP records with overrides
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
                rsvp.overridden_at = datetime.utcnow()

        await self.db.commit()

        # TODO: Update TrainingRecords with final hours and mark as completed
        # This will calculate final hours from approved durations

        return True, None
