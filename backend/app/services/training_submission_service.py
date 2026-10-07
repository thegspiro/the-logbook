"""
Training Submission Service

Handles self-reported training submissions, approval workflow,
and self-report configuration management.
"""

import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable, List, Optional, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import and_
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import ROLE_TRAINING_OFFICER
from app.core.utils import generate_uuid
from app.models.notification import NotificationChannel, NotificationLog
from app.models.training import (
    SelfReportConfig,
    SubmissionStatus,
    TrainingCategory,
    TrainingCourse,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
    TrainingType,
)
from app.models.user import Role, User, user_roles
from app.services.notifications_service import NotificationsService
from app.services.qualification_service import QualificationService
from app.services.separation_of_duties import assert_different_person
from app.utils.member_names import format_display_name
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org

# In-app prompts for a submission awaiting review share this category so the
# inbox stacks them, and carry ``submission_id`` in their metadata so a
# decision can archive every officer's copy at once.
REVIEW_PROMPT_CATEGORY = "training_submission"
REVIEW_QUEUE_URL = "/training/admin?page=records&tab=submissions"

# In-app notices to the submitter when an officer's decision differs from what
# they sent. A separate category from the officers' prompt, so neither stacks
# with nor archives the other.
MEMBER_NOTICE_CATEGORY = "training_submission_update"
MEMBER_SUBMISSIONS_URL = "/training/submit"
MEMBER_NOTICE_DECISIONS = (
    "rejected",
    "approved_with_changes",
    "revision_requested",
    "approval_reversed",
)


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

        apply_updates(config, kwargs)

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
        save_as_draft: bool = False,
        **kwargs,
    ) -> TrainingSubmission:
        """Create a new self-reported training submission.

        ``save_as_draft`` parks the submission in the member's own list without
        entering the review workflow; ``submit_draft`` is the only way out of
        that state, and it re-runs the approval routing below.
        """
        config = await self.get_config(organization_id)

        if hours_completed <= 0:
            raise ValueError("Hours completed must be greater than zero")

        self._assert_within_department_limits(config, training_type, hours_completed)

        await assert_in_org(
            self.db,
            TrainingCategory,
            kwargs.get("category_id"),
            organization_id,
            allow_none=True,
            label="training category",
        )

        if save_as_draft:
            # A draft is a note to oneself; it is not in front of anybody yet.
            status = SubmissionStatus.DRAFT
        else:
            self._assert_required_evidence(config, kwargs.get("attachments"))
            status = self._route_for_review(
                config, training_type, hours_completed, kwargs
            )

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

        # One transaction for the submission and any record it spawns, so a
        # failed record insert cannot leave an approved submission that
        # credits nothing and can never be retried.
        if status == SubmissionStatus.APPROVED:
            await self._record_if_auto_approved(submission)
        else:
            await self.db.commit()
        await self.db.refresh(submission)

        logger.info(
            f"Training submission created: {course_name} by {submitted_by} "
            f"({hours_completed}h, status={status.value})"
        )

        if status == SubmissionStatus.PENDING_REVIEW:
            await self._notify_reviewers(submission, triggered_by=submitted_by)

        return submission

    async def _record_if_auto_approved(self, submission: TrainingSubmission) -> None:
        """Create the training record immediately for an auto-approved submission.

        Runs the same duplicate check the manual-review path uses so an
        auto-approved submission can't silently spawn a duplicate record without
        any warning.
        """
        if submission.status != SubmissionStatus.APPROVED:
            return
        duplicate_info = await self._check_duplicate(submission)
        if duplicate_info:
            logger.warning(
                f"Duplicate detected on auto-approve: submission={submission.id} "
                f"existing_record={duplicate_info['existing_record_id']}"
            )
        await self._create_record_from_submission(submission)

    async def submit_draft(
        self, submission_id: str, user_id: str, organization_id: str
    ) -> TrainingSubmission:
        """Move a member's own saved draft into the review workflow.

        Routing is decided here rather than at save time: a draft can sit for
        weeks, and the department's approval settings may have changed in the
        meantime.
        """
        submission = await self.get_submission(submission_id, organization_id)
        if not submission:
            raise ValueError("Submission not found")

        if str(submission.submitted_by) != str(user_id):
            raise PermissionError("You can only submit your own drafts")

        if submission.status != SubmissionStatus.DRAFT:
            raise ValueError("Only a draft can be submitted for review")

        config = await self.get_config(organization_id)
        # A draft can sit for weeks. Re-check the department's restrictions as
        # well as its routing: an entry the same member could no longer create
        # must not reach the queue just because it was started earlier.
        self._assert_within_department_limits(
            config, submission.training_type, submission.hours_completed
        )
        self._assert_required_evidence(config, submission.attachments)

        submission.status = self._route_for_review(
            config,
            submission.training_type,
            submission.hours_completed,
            {
                "certification_number": submission.certification_number,
                "issuing_agency": submission.issuing_agency,
                "expiration_date": submission.expiration_date,
                "category_id": submission.category_id,
            },
        )
        # The review queue orders by submitted_at and the review card prints
        # it. Left at the draft's creation time, a draft kept for a fortnight
        # arrives already buried under submissions filed after it.
        submission.submitted_at = datetime.now(timezone.utc)

        # One transaction for the status change and the record it spawns. Two
        # would leave a failed record insert behind an already-approved
        # submission that no retry can reach — it is no longer a draft.
        if submission.status == SubmissionStatus.APPROVED:
            await self._record_if_auto_approved(submission)
        else:
            await self.db.commit()
        await self.db.refresh(submission)

        if submission.status == SubmissionStatus.PENDING_REVIEW:
            await self._notify_reviewers(submission, triggered_by=user_id)

        return submission

    @staticmethod
    def _assert_within_department_limits(
        config: SelfReportConfig, training_type: str, hours_completed: float
    ) -> None:
        """Reject an entry the department's self-report settings disallow."""
        if (
            config.max_hours_per_submission
            and hours_completed > config.max_hours_per_submission
        ):
            raise ValueError(
                f"Hours exceed maximum of {config.max_hours_per_submission} per submission"
            )

        if (
            config.allowed_training_types
            and training_type not in config.allowed_training_types
        ):
            raise ValueError(
                f"Training type '{training_type}' is not allowed for self-reporting"
            )

    async def assert_evidence_requirement(
        self, organization_id: str, attachments
    ) -> None:
        """Raise when the department requires evidence and there is none left.

        The endpoint layer's way in to the same rule the create and the draft
        handoff apply, so removing the last attachment cannot sidestep it.
        """
        config = await self.get_config(organization_id)
        self._assert_required_evidence(config, attachments)

    @staticmethod
    def _requires_evidence(config: SelfReportConfig) -> bool:
        """Whether the department marked supporting documents required.

        Tolerant of a config without `field_config` at all: the column is NOT
        NULL with a default, but a response that lacked it once took the submit
        page down, and this guard sits on the create path for every submission.
        """
        field_config = getattr(config, "field_config", None) or {}
        return bool((field_config.get("attachments") or {}).get("required"))

    @classmethod
    def _assert_required_evidence(cls, config: SelfReportConfig, attachments) -> None:
        """Enforce a department that requires supporting documents.

        Checked at every point a submission can reach — or stay in — the review
        queue without evidence: a create that is not a draft, the draft handoff,
        and removing the last attachment from a filed submission. A promise made
        in the settings screen that only the form kept is not a rule.
        """
        if not cls._requires_evidence(config):
            return
        if not attachments:
            raise ValueError(
                "This department requires supporting documents on a submission"
            )

    def _route_for_review(
        self,
        config: SelfReportConfig,
        training_type: str,
        hours_completed: float,
        fields: dict,
    ) -> SubmissionStatus:
        """Decide whether a submission goes to an officer or is auto-approved.

        Auto-approve is a convenience for low-stakes logged hours — it must never
        let a member self-credit a certification or a training requirement without
        a second person's sign-off (separation of duties, owner decision
        2026-08-09). A submission that would credit a certification/requirement is
        always routed to manual review regardless of the org's auto-approve
        settings.
        """
        if self._credits_certification_or_requirement(training_type, fields):
            return SubmissionStatus.PENDING_REVIEW
        if not config.require_approval:
            return SubmissionStatus.APPROVED
        if (
            config.auto_approve_under_hours
            and hours_completed <= config.auto_approve_under_hours
        ):
            return SubmissionStatus.APPROVED
        return SubmissionStatus.PENDING_REVIEW

    @staticmethod
    def _credits_certification_or_requirement(training_type: str, fields: dict) -> bool:
        """Whether a self-reported submission would credit a certification or a
        training requirement — the cases that must not auto-approve.

        A submission credits a certification/requirement when it (a) is itself a
        certification, (b) carries certification credential data (number, issuing
        agency, expiration), or (c) is linked to a training category, which is the
        mechanism by which completed training counts toward a requirement. Anything
        else (plain logged hours, skills practice) is non-crediting and may
        auto-approve.
        """
        # TrainingType is a str-Enum, so both the enum member and a plain
        # "certification" string compare equal to the enum value here.
        if training_type == TrainingType.CERTIFICATION.value:
            return True
        return any(
            fields.get(key)
            for key in (
                "certification_number",
                "issuing_agency",
                "expiration_date",
                "category_id",
            )
        )

    async def get_submission(
        self, submission_id: str, organization_id: str
    ) -> Optional[TrainingSubmission]:
        """Get a single submission by ID, scoped to the caller's organization.

        The org filter is the tenant-isolation boundary for every mutation
        path (update/delete/review) that funnels through this method — do
        not remove it or add an unscoped variant.
        """
        result = await self.db.execute(
            select(TrainingSubmission).where(
                TrainingSubmission.id == submission_id,
                TrainingSubmission.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_submissions(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        exclude_statuses: Optional[List[str]] = None,
    ) -> List[TrainingSubmission]:
        """Get submissions with optional filters."""
        query = select(TrainingSubmission).where(
            TrainingSubmission.organization_id == organization_id
        )

        if user_id:
            query = query.where(TrainingSubmission.submitted_by == user_id)

        if status:
            query = query.where(TrainingSubmission.status == status)

        if exclude_statuses:
            query = query.where(TrainingSubmission.status.notin_(exclude_statuses))

        query = query.order_by(TrainingSubmission.submitted_at.desc())
        query = query.limit(limit).offset(offset)

        result = await self.db.execute(query)
        submissions = list(result.scalars().all())
        await self._attach_submitter_names(submissions)
        return submissions

    async def _attach_submitter_names(
        self, submissions: List[TrainingSubmission]
    ) -> None:
        """Resolve submitter display names for the review queue.

        The model has no relationship to User, so the response carried only
        the raw submitted_by id — which is what the Review Submissions queue
        then printed where a reviewer expects a name. Attached as a transient
        attribute the response schema declares, resolved in one query.
        """
        user_ids = {str(s.submitted_by) for s in submissions if s.submitted_by}
        if not user_ids:
            return
        result = await self.db.execute(
            select(User.id, User.first_name, User.last_name).where(
                User.id.in_(user_ids)
            )
        )
        names = {
            str(row.id): f"{row.first_name or ''} {row.last_name or ''}".strip()
            for row in result.all()
        }
        for submission in submissions:
            submission.submitter_name = names.get(str(submission.submitted_by))

    async def update_submission(
        self,
        submission_id: str,
        user_id: str,
        organization_id: str,
        **kwargs,
    ) -> TrainingSubmission:
        """Update a submission (only by the submitter, before approval)."""
        submission = await self.get_submission(submission_id, organization_id)
        if not submission:
            raise ValueError("Submission not found")

        if submission.submitted_by != user_id:
            raise PermissionError("You can only edit your own submissions")

        if submission.status not in (
            SubmissionStatus.DRAFT,
            SubmissionStatus.PENDING_REVIEW,
            SubmissionStatus.REVISION_REQUESTED,
        ):
            raise ValueError(
                "Cannot edit a submission that has been approved or rejected"
            )

        if "category_id" in kwargs:
            await assert_in_org(
                self.db,
                TrainingCategory,
                kwargs["category_id"],
                organization_id,
                allow_none=True,
                label="training category",
            )

        apply_updates(submission, kwargs)

        # If it was revision_requested, move back to pending
        resubmitted = submission.status == SubmissionStatus.REVISION_REQUESTED
        if resubmitted:
            submission.status = SubmissionStatus.PENDING_REVIEW

        await self.db.commit()
        await self.db.refresh(submission)

        # Requesting a revision archived the officers' prompt, so the
        # corrected submission needs a fresh one. An edit to a submission that
        # is still pending already has one.
        if resubmitted:
            # The "changes requested" notice has been acted on.
            await self._archive_member_notices(organization_id, submission_id)
            await self._notify_reviewers(
                submission, triggered_by=user_id, resubmitted=True
            )
        return submission

    async def delete_submission(
        self, submission_id: str, user_id: str, organization_id: str
    ) -> bool:
        """Delete a submission (only if draft or pending)."""
        submission = await self.get_submission(submission_id, organization_id)
        if not submission:
            raise ValueError("Submission not found")

        if submission.submitted_by != user_id:
            raise PermissionError("You can only delete your own submissions")

        if submission.status not in (
            SubmissionStatus.DRAFT,
            SubmissionStatus.PENDING_REVIEW,
            SubmissionStatus.REVISION_REQUESTED,
        ):
            raise ValueError(
                "Cannot delete a submission that has been approved or rejected"
            )

        await self.db.delete(submission)
        await self.db.commit()
        await self._archive_review_prompts(organization_id, submission_id)
        await self._archive_member_notices(organization_id, submission_id)
        return True

    # ==================== Review / Approval ====================

    async def review_submission(
        self,
        submission_id: str,
        reviewer_id: str,
        organization_id: str,
        action: str,
        reviewer_notes: Optional[str] = None,
        override_hours: Optional[float] = None,
        override_credit_hours: Optional[float] = None,
        override_training_type: Optional[str] = None,
    ) -> TrainingSubmission:
        """Officer reviews a submission: approve, reject, or request revision."""
        submission = await self.get_submission(submission_id, organization_id)
        if not submission:
            raise ValueError("Submission not found")

        if submission.status not in (
            SubmissionStatus.PENDING_REVIEW,
            SubmissionStatus.REVISION_REQUESTED,
        ):
            raise ValueError(
                f"Cannot review a submission with status '{submission.status.value}'"
            )

        # Separation of duties: a training officer cannot approve their own
        # self-reported training. A second officer must sign it off, so an
        # officer can't grant themselves hours/credit unchecked. (Rejecting or
        # requesting revision on one's own submission is harmless and allowed.)
        if action == "approve":
            assert_different_person(
                reviewer_id,
                submission.submitted_by,
                action="approve",
                record="training submission",
            )

        # What the member sent, so an approval that changes it can say how.
        submitted_values = (
            ("Hours", submission.hours_completed),
            ("Credit hours", submission.credit_hours),
            ("Training type", submission.training_type),
        )

        if action == "approve":
            # Apply overrides
            if override_hours is not None and override_hours <= 0:
                raise ValueError("Override hours must be greater than zero")
            if override_credit_hours is not None and override_credit_hours < 0:
                raise ValueError("Override credit hours cannot be negative")
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

            # Check for duplicate before creating record
            duplicate_info = await self._check_duplicate(submission)

            # Create training record from the approved submission
            await self._create_record_from_submission(submission)

            if duplicate_info:
                logger.warning(
                    f"Duplicate detected on approval: submission={submission.id} "
                    f"existing_record={duplicate_info['existing_record_id']}"
                )

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
            raise ValueError(
                f"Invalid action: {action}. Use 'approve', 'reject', or 'revision_requested'"
            )

        await self.db.refresh(submission)
        logger.info(f"Submission {submission_id} reviewed: {action} by {reviewer_id}")
        # Every decision takes the submission out of the queue, so no officer
        # should still be prompted for it — including a revision request,
        # which waits on the member rather than on an officer.
        await self._archive_review_prompts(organization_id, submission_id)

        if action == "approve":
            changes = self._changed_values(
                submitted_values,
                (
                    submission.hours_completed,
                    submission.credit_hours,
                    submission.training_type,
                ),
            )
            if changes:
                await self._notify_member(
                    submission,
                    decision="approved_with_changes",
                    officer_id=reviewer_id,
                    notes=reviewer_notes,
                    changes=changes,
                )
        else:
            await self._notify_member(
                submission,
                decision=("rejected" if action == "reject" else "revision_requested"),
                officer_id=reviewer_id,
                notes=reviewer_notes,
            )
        return submission

    @staticmethod
    def _changed_values(submitted, approved) -> List[Tuple[str, str, str]]:
        """``(label, before, after)`` for each value the approval changed."""

        def show(value) -> str:
            value = getattr(value, "value", value)
            if value is None:
                return "none"
            if isinstance(value, float):
                return f"{value:g}"
            if isinstance(value, str):
                return value.replace("_", " ").capitalize()
            return str(value)

        changes = []
        for (label, before), after in zip(submitted, approved):
            if getattr(before, "value", before) != getattr(after, "value", after):
                changes.append((label, show(before), show(after)))
        return changes

    async def reverse_approval(
        self,
        submission_id: str,
        reviewer_id: str,
        organization_id: str,
        reason: Optional[str] = None,
    ) -> TrainingSubmission:
        """Undo a mistaken approval: void the record it spawned, un-apply any
        pipeline credit, and send the submission back to pending review.

        This is the correction path for "approved by accident" or "approved the
        wrong thing" — an officer shouldn't have to hunt down the spawned record
        and manually unwind progress. The submission returns to PENDING_REVIEW so
        it can be re-decided (rejected, or re-approved with corrected values).
        """
        from app.services.training_program_service import TrainingProgramService

        submission = await self.get_submission(submission_id, organization_id)
        if not submission:
            raise ValueError("Submission not found")
        if submission.status != SubmissionStatus.APPROVED:
            raise ValueError(
                f"Only an approved submission can be reversed "
                f"(status is '{submission.status.value}')"
            )

        program_service = TrainingProgramService(self.db)
        record_id = submission.training_record_id
        voided_record = None

        # Un-apply pipeline credit keyed on the submission itself (officer-apply)
        # and on the spawned record (any feed), across every requirement it hit.
        await program_service.reverse_credits_for_source(
            organization_id=UUID(str(organization_id)),
            source_id=str(submission_id),
            verified_by=UUID(str(reviewer_id)),
        )
        if record_id:
            await program_service.reverse_credits_for_source(
                organization_id=UUID(str(organization_id)),
                source_id=str(record_id),
                verified_by=UUID(str(reviewer_id)),
            )
            # Void the spawned record (kept for audit, no longer counts).
            record_result = await self.db.execute(
                select(TrainingRecord).where(
                    TrainingRecord.id == str(record_id),
                    TrainingRecord.organization_id == organization_id,
                )
            )
            record = record_result.scalar_one_or_none()
            if record and record.status != TrainingStatus.CANCELLED:
                record.status = TrainingStatus.CANCELLED
                record.voided_at = datetime.now(timezone.utc)
                record.voided_by = str(reviewer_id)
                record.void_reason = reason or None
                voided_record = record
                void_note = f"[VOIDED via approval reversal by {reviewer_id}"
                if reason:
                    void_note += f": {reason}"
                void_note += "]"
                record.notes = (
                    f"{record.notes}\n{void_note}" if record.notes else void_note
                )

        submission.status = SubmissionStatus.PENDING_REVIEW
        submission.training_record_id = None
        submission.reviewed_by = None
        submission.reviewed_at = None
        note = f"Approval reversed by {reviewer_id}"
        if reason:
            note += f": {reason}"
        submission.reviewer_notes = note

        await self.db.commit()
        if voided_record is not None:
            # The qualification the record conferred is recomputed from the
            # records still standing, so the reversal withdraws it too.
            try:
                await QualificationService(self.db).sync_from_training_record(
                    voided_record
                )
                await self.db.commit()
            except Exception:
                logger.exception(
                    f"Failed to recompute qualifications after reversing {submission_id}"
                )
                await self.db.rollback()
        await self.db.refresh(submission)
        logger.info(f"Submission {submission_id} approval reversed by {reviewer_id}")
        await self._notify_reviewers(submission, triggered_by=reviewer_id)
        await self._notify_member(
            submission,
            decision="approval_reversed",
            officer_id=reviewer_id,
            notes=reason,
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

    # ==================== Review Notifications ====================

    async def _training_officers(self, organization_id: str) -> List[User]:
        """Active members holding the Training Officer position.

        Matches the recipients of the email sent for training-session
        approvals (``TrainingSessionService._notify_training_officers``), by
        owner decision 2026-09-29. A department with nobody in the position
        gets no prompt; the pending count on the review queue still shows.
        """
        result = await self.db.execute(
            select(User)
            .join(user_roles, User.id == user_roles.c.user_id)
            .join(Role, Role.id == user_roles.c.position_id)
            .where(
                Role.slug == ROLE_TRAINING_OFFICER,
                Role.organization_id == organization_id,
                User.organization_id == organization_id,
                User.deleted_at.is_(None),
                User.is_active,
            )
        )
        return list(result.scalars().unique().all())

    @staticmethod
    def _describe(submission: TrainingSubmission) -> str:
        """ "Hazmat Ops (3.5h, completed Sep 20, 2026)" — read while loaded."""
        completed = (
            submission.completion_date.strftime("%b %d, %Y")
            if submission.completion_date
            else "an unknown date"
        )
        return (
            f"{submission.course_name} "
            f"({submission.hours_completed:g}h, completed {completed})"
        )

    async def _display_name(
        self, user_id: str, organization_id: str, fallback: str
    ) -> str:
        """The name a member goes by, for in-app notification text."""
        row = (
            await self.db.execute(
                select(User.first_name, User.last_name, User.preferred_name).where(
                    User.id == user_id,
                    User.organization_id == organization_id,
                )
            )
        ).first()
        name = (
            format_display_name(row.first_name, row.last_name, row.preferred_name)
            if row
            else ""
        )
        return name or fallback

    async def _deliver_in_app(
        self,
        build: Callable[[], Awaitable[List[NotificationLog]]],
        context: str,
    ) -> None:
        """Write the in-app rows ``build`` returns, without ever raising.

        Callers run this after the submission's own commit: a member's
        training must not fail to save, or an officer's decision fail to
        stand, because a notification could not be written.

        ``build`` runs inside a SAVEPOINT together with the inserts, so a
        failure undoes only its own work. A session-level rollback here would
        expire every instance the request holds — the submission the endpoint
        is about to serialize and the current user among them.
        """
        try:
            async with self.db.begin_nested():
                rows = await build()
                for row in rows:
                    self.db.add(row)
        except Exception:
            logger.exception(f"Failed to write in-app notifications for {context}")
            return
        if not rows:
            return
        try:
            await self.db.commit()
        except Exception:
            logger.exception(f"Failed to commit in-app notifications for {context}")
            # A failed commit has already lost the transaction; rollback only
            # resets the session. The submission committed before this ran.
            await self.db.rollback()

    async def _notify_reviewers(
        self,
        submission: TrainingSubmission,
        *,
        triggered_by: str,
        resubmitted: bool = False,
    ) -> None:
        """Prompt training officers that a submission is waiting on them.

        The submitter is skipped (separation of duties bars them from
        approving it), as is whoever moved it into the queue — an officer who
        reverses an approval already knows it is back.
        """
        # Read everything off the submission before touching the database, so
        # nothing below depends on it staying loaded.
        organization_id = str(submission.organization_id)
        submission_id = str(submission.id)
        submitted_by = str(submission.submitted_by)
        summary = self._describe(submission)
        skip = {submitted_by, str(triggered_by)}
        verb = "resubmitted" if resubmitted else "submitted"

        async def build() -> List[NotificationLog]:
            officers = [
                officer
                for officer in await self._training_officers(organization_id)
                if str(officer.id) not in skip
            ]
            if not officers:
                return []
            name = await self._display_name(submitted_by, organization_id, "A member")
            return [
                NotificationLog(
                    organization_id=organization_id,
                    recipient_id=str(officer.id),
                    channel=NotificationChannel.IN_APP,
                    category=REVIEW_PROMPT_CATEGORY,
                    subject=f"Training submission awaiting approval — {name}",
                    message=f"{name} {verb} {summary} for review.",
                    action_url=REVIEW_QUEUE_URL,
                    notification_metadata={
                        "submission_id": submission_id,
                        "submitted_by": submitted_by,
                    },
                )
                for officer in officers
            ]

        await self._deliver_in_app(build, f"review of submission {submission_id}")

    async def _notify_member(
        self,
        submission: TrainingSubmission,
        *,
        decision: str,
        officer_id: str,
        notes: Optional[str] = None,
        changes: Optional[List[Tuple[str, str, str]]] = None,
    ) -> None:
        """Tell the submitter an officer changed or turned down their entry.

        ``decision`` is one of :data:`MEMBER_NOTICE_DECISIONS`. Plain
        approvals send nothing, by owner decision 2026-09-29: the member is
        told when the outcome differs from what they submitted. An officer
        deciding their own submission is not told about it.
        """
        organization_id = str(submission.organization_id)
        submission_id = str(submission.id)
        submitted_by = str(submission.submitted_by)
        if submitted_by == str(officer_id):
            return
        summary = self._describe(submission)
        course = submission.course_name
        notes = (notes or "").strip()

        async def build() -> List[NotificationLog]:
            officer = await self._display_name(
                str(officer_id), organization_id, "A training officer"
            )
            if decision == "rejected":
                subject = f"Training submission not approved — {course}"
                body = f"{officer} did not approve your submission for {summary}."
                note_label = "Reason"
            elif decision == "approved_with_changes":
                subject = f"Training submission approved with changes — {course}"
                lines = [
                    f"{officer} approved your submission for {summary} "
                    f"after changing:"
                ]
                lines += [
                    f"• {label}: {before} → {after}"
                    for label, before, after in (changes or [])
                ]
                body = "\n".join(lines)
                note_label = "Officer's notes"
            elif decision == "revision_requested":
                subject = f"Changes requested on your training submission — {course}"
                body = (
                    f"{officer} sent back your submission for {summary}. "
                    f"Edit it and resubmit it for review."
                )
                note_label = "Officer's notes"
            else:
                subject = f"Training approval reversed — {course}"
                body = (
                    f"{officer} reversed the approval of your submission for "
                    f"{summary}. Its hours are no longer on your record, and it "
                    f"is back awaiting review."
                )
                note_label = "Reason"
            if notes:
                body += f"\n\n{note_label}: {notes}"
            return [
                NotificationLog(
                    organization_id=organization_id,
                    recipient_id=submitted_by,
                    channel=NotificationChannel.IN_APP,
                    category=MEMBER_NOTICE_CATEGORY,
                    subject=subject,
                    message=body,
                    action_url=MEMBER_SUBMISSIONS_URL,
                    notification_metadata={
                        "submission_id": submission_id,
                        "decision": decision,
                    },
                )
            ]

        await self._deliver_in_app(
            build, f"{decision} notice on submission {submission_id}"
        )

    async def _archive_review_prompts(
        self, organization_id: str, submission_id: str
    ) -> None:
        """Clear every officer's prompt once a submission leaves the queue."""
        await NotificationsService(self.db).archive_related_notifications(
            organization_id, REVIEW_PROMPT_CATEGORY, "submission_id", submission_id
        )

    async def _archive_member_notices(
        self, organization_id: str, submission_id: str
    ) -> None:
        """Clear the member's notices once they have acted on them."""
        await NotificationsService(self.db).archive_related_notifications(
            organization_id, MEMBER_NOTICE_CATEGORY, "submission_id", submission_id
        )

    # ==================== Internal ====================

    async def _check_duplicate(self, submission: TrainingSubmission) -> Optional[dict]:
        """Check for potential duplicate training records for this submission."""
        if not submission.completion_date:
            return None

        result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == submission.organization_id)
            .where(TrainingRecord.user_id == submission.submitted_by)
            .where(
                sa_func.lower(TrainingRecord.course_name)
                == submission.course_name.lower()
            )
            .where(
                TrainingRecord.completion_date
                >= submission.completion_date - timedelta(days=1)
            )
            .where(
                TrainingRecord.completion_date
                <= submission.completion_date + timedelta(days=1)
            )
        )
        existing = result.scalars().first()
        if existing:
            return {
                "existing_record_id": str(existing.id),
                "existing_completion_date": str(existing.completion_date),
                "message": f"Potential duplicate: '{submission.course_name}' already recorded on {existing.completion_date}",
            }
        return None

    async def _create_record_from_submission(
        self, submission: TrainingSubmission
    ) -> TrainingRecord:
        """Create a TrainingRecord from an approved submission."""
        # Auto-calculate expiration_date from the course's expiration_months
        # when not explicitly provided but completion_date and course_code are set
        expiration_date = submission.expiration_date
        if (
            not expiration_date
            and submission.completion_date
            and submission.course_code
        ):
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

        # Capture member's current rank/station
        rank_at_completion = None
        station_at_completion = None
        member_result = await self.db.execute(
            select(User).where(User.id == submission.submitted_by)
        )
        member = member_result.scalar_one_or_none()
        if member:
            rank_at_completion = member.rank
            station_at_completion = member.station

        record = TrainingRecord(
            id=generate_uuid(),
            organization_id=submission.organization_id,
            user_id=submission.submitted_by,
            course_name=submission.course_name,
            course_code=submission.course_code,
            training_type=submission.training_type,
            category_id=submission.category_id,
            completion_date=submission.completion_date,
            start_time=submission.start_time,
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
            rank_at_completion=rank_at_completion,
            station_at_completion=station_at_completion,
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
