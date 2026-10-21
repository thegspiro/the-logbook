"""Cancelling a scheduled email, and deleting a pipeline stage, leave a record.

- ``DELETE /email-templates/scheduled/{id}`` hard-deleted the row, so the list
  lost it and nothing recorded who called it off. It now marks the row
  CANCELLED, which the sender never picks up, and writes an audit entry.
- Deleting a pipeline stage deletes every applicant's progress record for it,
  with no audit entry naming who did it.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints import email_templates as email_templates_ep
from app.api.v1.endpoints import membership_pipeline as pipeline_ep
from app.models.audit import AuditLog
from app.models.email_template import (
    EmailTemplateType,
    ScheduledEmail,
    ScheduledEmailStatus,
)
from app.models.membership_pipeline import MembershipPipelineStep
from app.services import scheduled_tasks
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = pytest.mark.integration


@pytest.fixture
def officer(setup_org_and_admin):
    org_id, admin_id = setup_org_and_admin
    return SimpleNamespace(
        id=admin_id, organization_id=org_id, username=f"admin-{org_id[:8]}"
    )


async def _scheduled(db, org_id, *, status=ScheduledEmailStatus.PENDING, due=False):
    item = ScheduledEmail(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        template_type=EmailTemplateType.CUSTOM,
        to_emails=[f"{uuid.uuid4().hex[:8]}@example.test"],
        context={},
        scheduled_at=datetime.now(timezone.utc)
        + (timedelta(minutes=-5) if due else timedelta(days=1)),
        status=status,
    )
    db.add(item)
    await db.flush()
    return item.id


async def _status(db, scheduled_id):
    return (
        await db.execute(
            select(ScheduledEmail.status).where(ScheduledEmail.id == scheduled_id)
        )
    ).scalar_one_or_none()


async def _audits(db, event_type):
    return (
        (await db.execute(select(AuditLog).where(AuditLog.event_type == event_type)))
        .scalars()
        .all()
    )


class TestCancellingAScheduledEmail:
    async def test_it_is_marked_cancelled_and_audited(self, db_session, officer):
        scheduled_id = await _scheduled(db_session, officer.organization_id)
        await db_session.commit()

        await email_templates_ep.cancel_scheduled_email(
            scheduled_id, db=db_session, current_user=officer
        )

        assert await _status(db_session, scheduled_id) == ScheduledEmailStatus.CANCELLED
        [audit] = await _audits(db_session, "scheduled_email_cancelled")
        assert audit.event_data["scheduled_email_id"] == scheduled_id
        assert audit.event_data["previous_status"] == "pending"
        assert audit.user_id == officer.id

    async def test_the_sender_does_not_send_it(self, db_session, officer):
        scheduled_id = await _scheduled(db_session, officer.organization_id, due=True)
        await db_session.commit()
        await email_templates_ep.cancel_scheduled_email(
            scheduled_id, db=db_session, current_user=officer
        )

        result = await scheduled_tasks._run_scheduled_emails_inner(db_session)

        assert result["sent"] == 0
        assert result["failed"] == 0
        assert await _status(db_session, scheduled_id) == ScheduledEmailStatus.CANCELLED

    async def test_a_row_cancelled_after_the_batch_was_read_is_not_sent(
        self, db_session, officer, monkeypatch
    ):
        # The sender reads its batch without a lock, so a cancel can commit
        # between that read and the send. Simulated by cancelling inside the
        # first statement the sender issues for the row.
        scheduled_id = await _scheduled(db_session, officer.organization_id, due=True)
        await db_session.commit()
        real_execute = db_session.execute
        cancelled = False

        async def execute(statement, *args, **kwargs):
            nonlocal cancelled
            result = await real_execute(statement, *args, **kwargs)
            if not cancelled:
                cancelled = True
                await real_execute(
                    ScheduledEmail.__table__.update()
                    .where(ScheduledEmail.id == scheduled_id)
                    .values(status=ScheduledEmailStatus.CANCELLED.value)
                )
            return result

        monkeypatch.setattr(db_session, "execute", execute)

        result = await scheduled_tasks._run_scheduled_emails_inner(db_session)
        monkeypatch.undo()

        assert result["sent"] == 0
        assert result["failed"] == 0
        assert await _status(db_session, scheduled_id) == ScheduledEmailStatus.CANCELLED

    async def test_a_sent_email_cannot_be_cancelled(self, db_session, officer):
        scheduled_id = await _scheduled(
            db_session, officer.organization_id, status=ScheduledEmailStatus.SENT
        )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc_info:
            await email_templates_ep.cancel_scheduled_email(
                scheduled_id, db=db_session, current_user=officer
            )

        assert exc_info.value.status_code == 400
        assert await _status(db_session, scheduled_id) == ScheduledEmailStatus.SENT
        assert await _audits(db_session, "scheduled_email_cancelled") == []

    async def test_another_orgs_email_is_not_found(self, db_session, officer):
        scheduled_id = await _scheduled(db_session, officer.organization_id)
        await db_session.commit()
        stranger = SimpleNamespace(
            id=officer.id, organization_id=str(uuid.uuid4()), username="x"
        )

        with pytest.raises(HTTPException) as exc_info:
            await email_templates_ep.cancel_scheduled_email(
                scheduled_id, db=db_session, current_user=stranger
            )

        assert exc_info.value.status_code == 404
        assert await _status(db_session, scheduled_id) == ScheduledEmailStatus.PENDING


class TestDeletingAPipelineStage:
    async def test_it_is_audited(self, db_session, officer):
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(
            organization_id=officer.organization_id, name="Audit Pipeline"
        )
        pipeline_id = str(pipeline.id)
        for name in ("Application", "Interview"):
            await svc.add_step(
                pipeline_id,
                officer.organization_id,
                {"name": name, "step_type": "manual_approval", "required": False},
            )
        step_id = (
            await db_session.execute(
                select(MembershipPipelineStep.id).where(
                    MembershipPipelineStep.pipeline_id == pipeline_id,
                    MembershipPipelineStep.name == "Interview",
                )
            )
        ).scalar_one()
        await db_session.commit()

        await pipeline_ep.delete_step(
            UUID(pipeline_id), UUID(step_id), db=db_session, current_user=officer
        )

        [audit] = await _audits(db_session, "membership_pipeline.step_deleted")
        assert audit.event_data == {"pipeline_id": pipeline_id, "step_id": step_id}
        assert audit.user_id == officer.id
