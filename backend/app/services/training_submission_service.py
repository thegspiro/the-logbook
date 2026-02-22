"""
Training Submission Service

Handles self-reported training submissions, approval workflow,
and self-report configuration management.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import List, Optional
from datetime import datetime, date, timezone
import calendar

from app.models.training import (
    TrainingSubmission,
    SelfReportConfig,
    TrainingRecord,
    TrainingCourse,
    TrainingStatus,
    TrainingType,
    SubmissionStatus,
)
from app.core.utils import generate_uuid
from loguru import logger


class TrainingSubmissionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ==================== Self-Report Config ====================

    async def get_config(self, organization_id: str) -> SelfReportConfig:
        """Get or create self-report config for an organization."""
        result = await self.db.execute(
            select(SelfReportConfig).where(
                SelfReportConfig.organization_id == organization_id
            )
        )
        config = result.scalar_one_or_none()

        if not config:
            # Create default config
            config = SelfReportConfig(
                id=generate_uuid(),
                organization_id=organization_id,
            )
            self.db.add(config)
            await self.db.commit()
            await self.db.refresh(config)

        return config

    async def update_config(
        self,
        organization_id: str,
        updated_by: str,
        **kwargs,
    ) -> SelfReportConfig:
        """Update self-report configuration."""
        config = await self.get_config(organization_id)

        for key, value in kwargs.items():
            if value is not None and hasattr(config, key):
                setattr(config, key, value)

        config.updated_by = updated_by
        await self.db.commit()
        await self.db.refresh(config)
        return config

    # ==================== Submissions ====================

    async def create_submission(
        self,
        organization_id: str,
        submitted_by: str,
        course_name: str,
        training_type: str,
        completion_date: date,
        hours_completed: float,
        **kwargs,
    ) -> TrainingSubmission:
        """Create a new self-reported training submission."""
        config = await self.get_config(organization_id)

        # Validate against config
        if config.max_hours_per_submission and hours_completed > config.max_hours_per_submission:
            raise ValueError(
                f"Hours exceed maximum of {config.max_hours_per_submission} per submission"
            )

        if config.allowed_training_types and training_type not in config.allowed_training_types:
            raise ValueError(
                f"Training type '{training_type}' is not allowed for self-reporting"
            )

        # Determine initial status
        status = SubmissionStatus.PENDING_REVIEW
        if not config.require_approval:
            status = SubmissionStatus.APPROVED
        elif (
            config.auto_approve_under_hours
            and hours_completed <= config.auto_approve_under_hours
        ):
            status = SubmissionStatus.APPROVED

        submission = TrainingSubmission(
            id=generate_uuid(),
            organization_id=organization_id,
            submitted_by=submitted_by,
            course_name=course_name,
            training_type=training_type,
            completion_date=completion_date,
            hours_completed=hours_completed,
            status=status,
            **{k: v for k, v in kwargs.items() if v is not None},
        )
        self.db.add(submission)
        await self.db.commit()
        await self.db.refresh(submission)

        logger.info(
            f"Training submission created: {course_name} by {submitted_by} "
            f"({hours_completed}h, status={status.value})"
        )

        # If auto-approved, create the training record immediately
        if status == SubmissionStatus.APPROVED:
            await self._create_record_from_submission(submission)

        return submission

    async def get_submission(self, submission_id: str) -> Optional[TrainingSubmission]:
        """Get a single submission by ID."""
        result = await self.db.execute(
            select(TrainingSubmission).where(TrainingSubmission.id == submission_id)
        )
        return result.scalar_one_or_none()

    async def get_submissions(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[TrainingSubmission]:
        """Get submissions with optional filters."""
        query = select(TrainingSubmission).where(
            TrainingSubmission.organization_id == organization_id
        )

        if user_id:
            query = query.where(TrainingSubmission.submitted_by == user_id)

        if status:
            query = query.where(TrainingSubmission.status == status)

        query = query.order_by(TrainingSubmission.submitted_at.desc())
        query = query.limit(limit).offset(offset)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_submission(
        self,
        submission_id: str,
        user_id: str,
        **kwargs,
    ) -> TrainingSubmission:
        """Update a submission (only by the submitter, before approval)."""
        submission = await self.get_submission(submission_id)
        if not submission:
            raise ValueError("Submission not found")

        if submission.submitted_by != user_id:
            raise PermissionError("You can only edit your own submissions")

        if submission.status not in (
            SubmissionStatus.DRAFT,
            SubmissionStatus.PENDING_REVIEW,
            SubmissionStatus.REVISION_REQUESTED,
        ):
            raise ValueError("Cannot edit a submission that has been approved or rejected")

        for key, value in kwargs.items():
            if value is not None and hasattr(submission, key):
                setattr(submission, key, value)

        # If it was revision_requested, move back to pending
        if submission.status == SubmissionStatus.REVISION_REQUESTED:
            submission.status = SubmissionStatus.PENDING_REVIEW

        await self.db.commit()
        await self.db.refresh(submission)
        return submission

    async def delete_submission(self, submission_id: str, user_id: str) -> bool:
        """Delete a submission (only if draft or pending)."""
        submission = await self.get_submission(submission_id)
        if not submission:
            raise ValueError("Submission not found")

        if submission.submitted_by != user_id:
            raise PermissionError("You can only delete your own submissions")

        if submission.status not in (
            SubmissionStatus.DRAFT,
            SubmissionStatus.PENDING_REVIEW,
            SubmissionStatus.REVISION_REQUESTED,
        ):
            raise ValueError("Cannot delete a submission that has been approved or rejected")

        await self.db.delete(submission)
        await self.db.commit()
        return True

    # ==================== Review / Approval ====================

    async def review_submission(
        self,
        submission_id: str,
        reviewer_id: str,
        action: str,
        reviewer_notes: Optional[str] = None,
        override_hours: Optional[float] = None,
        override_credit_hours: Optional[float] = None,
        override_training_type: Optional[str] = None,
    ) -> TrainingSubmission:
        """Officer reviews a submission: approve, reject, or request revision."""
        submission = await self.get_submission(submission_id)
        if not submission:
            raise ValueError("Submission not found")

        if submission.status not in (
            SubmissionStatus.PENDING_REVIEW,
            SubmissionStatus.REVISION_REQUESTED,
        ):
            raise ValueError(
                f"Cannot review a submission with status '{submission.status.value}'"
            )

        if action == "approve":
            # Apply overrides
            if override_hours:
                submission.hours_completed = override_hours
            if override_credit_hours is not None:
                submission.credit_hours = override_credit_hours
            if override_training_type:
                submission.training_type = override_training_type

            submission.status = SubmissionStatus.APPROVED
            submission.reviewed_by = reviewer_id
            submission.reviewed_at = datetime.now(timezone.utc)
            submission.reviewer_notes = reviewer_notes

            await self.db.commit()

            # Create training record from the approved submission
            await self._create_record_from_submission(submission)

        elif action == "reject":
            submission.status = SubmissionStatus.REJECTED
            submission.reviewed_by = reviewer_id
            submission.reviewed_at = datetime.now(timezone.utc)
            submission.reviewer_notes = reviewer_notes
            await self.db.commit()

        elif action == "revision_requested":
            submission.status = SubmissionStatus.REVISION_REQUESTED
            submission.reviewed_by = reviewer_id
            submission.reviewed_at = datetime.now(timezone.utc)
            submission.reviewer_notes = reviewer_notes
            await self.db.commit()

        else:
            raise ValueError(f"Invalid action: {action}. Use 'approve', 'reject', or 'revision_requested'")

        await self.db.refresh(submission)
        logger.info(
            f"Submission {submission_id} reviewed: {action} by {reviewer_id}"
        )
        return submission

    async def get_pending_count(self, organization_id: str) -> int:
        """Get count of pending submissions for an organization."""
        result = await self.db.execute(
            select(TrainingSubmission).where(
                and_(
                    TrainingSubmission.organization_id == organization_id,
                    TrainingSubmission.status == SubmissionStatus.PENDING_REVIEW,
                )
            )
        )
        return len(result.scalars().all())

    # ==================== Internal ====================

    async def _create_record_from_submission(
        self, submission: TrainingSubmission
    ) -> TrainingRecord:
        """Create a TrainingRecord from an approved submission."""
        # Auto-calculate expiration_date from the course's expiration_months
        # when not explicitly provided but completion_date and course_code are set
        expiration_date = submission.expiration_date
        if not expiration_date and submission.completion_date and submission.course_code:
            course_result = await self.db.execute(
                select(TrainingCourse).where(
                    TrainingCourse.code == submission.course_code,
                    TrainingCourse.organization_id == submission.organization_id,
                )
            )
            course = course_result.scalar_one_or_none()
            if course and course.expiration_months:
                comp = submission.completion_date
                month = comp.month - 1 + course.expiration_months
                year = comp.year + month // 12
                month = month % 12 + 1
                day = min(comp.day, calendar.monthrange(year, month)[1])
                expiration_date = date(year, month, day)

        record = TrainingRecord(
            id=generate_uuid(),
            organization_id=submission.organization_id,
            user_id=submission.submitted_by,
            course_name=submission.course_name,
            course_code=submission.course_code,
            training_type=submission.training_type,
            completion_date=submission.completion_date,
            hours_completed=submission.hours_completed,
            credit_hours=submission.credit_hours or submission.hours_completed,
            certification_number=submission.certification_number,
            issuing_agency=submission.issuing_agency,
            instructor=submission.instructor,
            location=submission.location,
            notes=submission.description,
            attachments=submission.attachments,
            status=TrainingStatus.COMPLETED,
            expiration_date=expiration_date,
            created_by=submission.submitted_by,
        )
        self.db.add(record)

        # Link the record back to the submission
        submission.training_record_id = record.id

        await self.db.commit()
        logger.info(
            f"TrainingRecord {record.id} created from submission {submission.id}"
        )
        return record
