"""In-app prompts for self-reported training awaiting approval.

A submission sitting in ``pending_review`` used to reach officers only as a
count on the review queue. Training officers now get one in-app prompt per
submission, and the prompt follows the submission: it is archived for every
officer the moment anyone decides it (or the member withdraws it), and a
submission sent back for revision prompts again when the member resubmits.

Recipients are the Training Officer position, by owner decision 2026-09-29 —
the same people the training-session approval email goes to.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.core.constants import ROLE_TRAINING_OFFICER
from app.models.notification import NotificationLog
from app.models.training import SelfReportConfig, SubmissionStatus
from app.models.user import Organization, Position, User, UserStatus, user_positions
from app.services.notifications_service import NotificationsService
from app.services.training_submission_service import (
    REVIEW_PROMPT_CATEGORY,
    REVIEW_QUEUE_URL,
    TrainingSubmissionService,
)

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Prompt FD", slug=f"prm-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    # Explicit so the test does not depend on the config defaults.
    db.add(
        SelfReportConfig(
            organization_id=org.id,
            require_approval=True,
            auto_approve_under_hours=None,
        )
    )
    await db.flush()
    return org


async def _member(db, org, first, *, status=UserStatus.ACTIVE):
    user = User(
        organization_id=org.id,
        username=f"{first.lower()}-{uuid.uuid4().hex[:8]}",
        email=f"{first.lower()}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=first,
        last_name="Tester",
        status=status,
    )
    db.add(user)
    await db.flush()
    return user


async def _training_officer_position(db, org):
    position = Position(
        organization_id=org.id,
        name="Training Officer",
        slug=ROLE_TRAINING_OFFICER,
        permissions=["training.manage"],
    )
    db.add(position)
    await db.flush()
    return position


async def _assign(db, user, position):
    await db.execute(
        user_positions.insert().values(user_id=user.id, position_id=position.id)
    )
    await db.flush()


async def _department(db):
    """An org with two training officers, one inactive officer and a member."""
    org = await _org(db)
    position = await _training_officer_position(db, org)
    alice = await _member(db, org, "Alice")
    bob = await _member(db, org, "Bob")
    gone = await _member(db, org, "Gone", status=UserStatus.INACTIVE)
    for officer in (alice, bob, gone):
        await _assign(db, officer, position)
    member = await _member(db, org, "Casey")
    return org, alice, bob, gone, member


async def _submit(db, org, member, **overrides):
    fields = dict(
        course_name="Vehicle Extrication Refresher",
        training_type="continuing_education",
        completion_date=date(2026, 9, 20),
        hours_completed=3.5,
    )
    fields.update(overrides)
    return await TrainingSubmissionService(db).create_submission(
        organization_id=org.id, submitted_by=member.id, **fields
    )


async def _active_prompts(db, org, user):
    logs, _, _ = await NotificationsService(db).get_user_notifications(
        org.id, user.id, include_expired=False
    )
    return [log for log in logs if log.category == REVIEW_PROMPT_CATEGORY]


async def _all_prompts(db, submission_id):
    result = await db.execute(
        select(NotificationLog).where(
            NotificationLog.category == REVIEW_PROMPT_CATEGORY
        )
    )
    return [
        log
        for log in result.scalars().all()
        if (log.notification_metadata or {}).get("submission_id") == submission_id
    ]


class TestPromptOnSubmit:
    async def test_every_active_training_officer_is_prompted(self, db_session):
        org, alice, bob, gone, member = await _department(db_session)

        submission = await _submit(db_session, org, member)

        assert submission.status == SubmissionStatus.PENDING_REVIEW
        for officer in (alice, bob):
            prompts = await _active_prompts(db_session, org, officer)
            assert len(prompts) == 1
            prompt = prompts[0]
            assert prompt.subject == (
                "Training submission awaiting approval — Casey Tester"
            )
            assert "Vehicle Extrication Refresher" in prompt.message
            assert "3.5h" in prompt.message
            assert prompt.action_url == REVIEW_QUEUE_URL
            assert prompt.notification_metadata["submission_id"] == submission.id
        # Neither an inactive officer nor the member themselves.
        assert await _active_prompts(db_session, org, gone) == []
        assert await _active_prompts(db_session, org, member) == []

    async def test_an_officer_is_not_prompted_for_their_own_submission(
        self, db_session
    ):
        # Separation of duties bars them from approving it anyway.
        org, alice, bob, _, _ = await _department(db_session)

        await _submit(db_session, org, alice)

        assert await _active_prompts(db_session, org, alice) == []
        assert len(await _active_prompts(db_session, org, bob)) == 1

    async def test_an_auto_approved_submission_prompts_nobody(self, db_session):
        org, alice, _, _, member = await _department(db_session)
        config = await TrainingSubmissionService(db_session).get_config(org.id)
        config.require_approval = False
        await db_session.flush()

        submission = await _submit(db_session, org, member)

        assert submission.status == SubmissionStatus.APPROVED
        assert await _all_prompts(db_session, submission.id) == []

    async def test_a_draft_prompts_only_once_it_is_submitted(self, db_session):
        org, alice, _, _, member = await _department(db_session)
        service = TrainingSubmissionService(db_session)

        draft = await _submit(db_session, org, member, save_as_draft=True)
        assert await _all_prompts(db_session, draft.id) == []

        await service.submit_draft(draft.id, member.id, org.id)
        assert len(await _active_prompts(db_session, org, alice)) == 1

    async def test_a_department_without_training_officers_prompts_nobody(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _member(db_session, org, "Casey")

        submission = await _submit(db_session, org, member)

        assert submission.status == SubmissionStatus.PENDING_REVIEW
        assert await _all_prompts(db_session, submission.id) == []


class TestPromptFollowsTheSubmission:
    @pytest.mark.parametrize("action", ["approve", "reject", "revision_requested"])
    async def test_a_decision_archives_every_officers_prompt(self, db_session, action):
        org, alice, bob, _, member = await _department(db_session)
        submission = await _submit(db_session, org, member)

        await TrainingSubmissionService(db_session).review_submission(
            submission.id, alice.id, org.id, action
        )

        assert await _active_prompts(db_session, org, alice) == []
        assert await _active_prompts(db_session, org, bob) == []
        prompts = await _all_prompts(db_session, submission.id)
        assert len(prompts) == 2
        assert all(p.expires_at is not None and p.read for p in prompts)

    async def test_a_resubmission_after_revision_prompts_again(self, db_session):
        org, alice, bob, _, member = await _department(db_session)
        service = TrainingSubmissionService(db_session)
        submission = await _submit(db_session, org, member)
        await service.review_submission(
            submission.id, alice.id, org.id, "revision_requested"
        )

        await service.update_submission(
            submission.id, member.id, org.id, hours_completed=4.0
        )

        for officer in (alice, bob):
            prompts = await _active_prompts(db_session, org, officer)
            assert len(prompts) == 1
            assert "Casey Tester resubmitted" in prompts[0].message

    async def test_editing_a_still_pending_submission_does_not_prompt_twice(
        self, db_session
    ):
        org, alice, _, _, member = await _department(db_session)
        submission = await _submit(db_session, org, member)

        await TrainingSubmissionService(db_session).update_submission(
            submission.id, member.id, org.id, hours_completed=4.0
        )

        assert len(await _active_prompts(db_session, org, alice)) == 1

    async def test_withdrawing_a_submission_archives_its_prompts(self, db_session):
        org, alice, _, _, member = await _department(db_session)
        submission = await _submit(db_session, org, member)

        await TrainingSubmissionService(db_session).delete_submission(
            submission.id, member.id, org.id
        )

        assert await _active_prompts(db_session, org, alice) == []

    async def test_reversing_an_approval_prompts_the_other_officers(self, db_session):
        org, alice, bob, _, member = await _department(db_session)
        service = TrainingSubmissionService(db_session)
        submission = await _submit(db_session, org, member)
        await service.review_submission(submission.id, alice.id, org.id, "approve")

        await service.reverse_approval(submission.id, alice.id, org.id)

        # Back in the queue: Bob is prompted; Alice, who reversed it, is not.
        assert len(await _active_prompts(db_session, org, bob)) == 1
        assert await _active_prompts(db_session, org, alice) == []

    async def test_prompts_are_scoped_to_the_submitters_organization(self, db_session):
        org, _, _, _, member = await _department(db_session)
        other_org, other_officer, _, _, _ = await _department(db_session)

        await _submit(db_session, org, member)

        assert await _active_prompts(db_session, other_org, other_officer) == []


class TestPromptFailureNeverBlocksTheSubmission:
    async def test_a_failed_prompt_leaves_a_saved_readable_submission(
        self, db_session, monkeypatch
    ):
        org, _, _, _, member = await _department(db_session)

        async def boom(self, organization_id):
            raise RuntimeError("notification store unavailable")

        monkeypatch.setattr(TrainingSubmissionService, "_training_officers", boom)

        submission = await _submit(db_session, org, member)

        # Still readable after the failure path's rollback — the endpoint
        # serializes it next, and an expired instance would lazy-load there.
        assert submission.status == SubmissionStatus.PENDING_REVIEW
        assert submission.course_name == "Vehicle Extrication Refresher"
        saved = await TrainingSubmissionService(db_session).get_submission(
            submission.id, org.id
        )
        assert saved is not None
        assert await _all_prompts(db_session, submission.id) == []
