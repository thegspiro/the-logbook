"""Department-set retention for self-reported certificate files.

The sweep runs against the real database (rolled back per test) and a
temporary upload directory standing in for the volume.
"""

import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text

from app.api.v1.endpoints import training_submissions
from app.models.training import (
    SelfReportConfig,
    SubmissionStatus,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
)
from app.models.user import User
from app.schemas.training_submission import (
    ATTACHMENT_RETENTION_MIN_DAYS,
    SelfReportConfigUpdate,
)
from app.services import file_storage_service
from app.services.scheduled_tasks import (
    SCHEDULE,
    TASK_INTERVALS_SECONDS,
    TASK_RUNNERS,
    run_self_report_attachment_retention,
)
from app.services.self_report_attachment_retention import (
    SelfReportAttachmentRetention,
)

NOW = datetime.now(timezone.utc)


@pytest.fixture
def upload_root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


async def _org_and_member(db_session) -> tuple[str, str]:
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Retention VFD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"srar-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Pat', 'Member', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@test.com",
        },
    )
    return org_id, user_id


def _stored_file(
    root, org_id: str, name: str | None = None, legacy: bool = False
) -> dict:
    """A certificate in the org's self-reports area — or, with *legacy*, in
    the pre-org-first ``training_attachments/self_reported_submissions/<org>/``
    tree, which is still swept until scripts/relocate_uploads.py moves it."""
    if legacy:
        directory = root / "training_attachments" / "self_reported_submissions" / org_id
    else:
        directory = root / org_id / "self-reports" / uuid.uuid4().hex
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (name or f"{uuid.uuid4().hex}.pdf")
    path.write_bytes(b"%PDF-1.4 certificate")
    return {"file_name": "cert.pdf", "file_path": str(path), "file_type": "x"}


def _submission(org_id, user_id, attachments, status, decided_days_ago):
    return TrainingSubmission(
        organization_id=org_id,
        submitted_by=user_id,
        course_name="CPR",
        training_type="certification",
        completion_date=date(2024, 1, 1),
        hours_completed=4.0,
        status=status,
        reviewed_at=(
            NOW - timedelta(days=decided_days_ago)
            if decided_days_ago is not None
            else None
        ),
        attachments=attachments,
    )


def _record(org_id, user_id, attachments, status=TrainingStatus.COMPLETED):
    return TrainingRecord(
        organization_id=org_id,
        user_id=user_id,
        course_name="CPR",
        training_type="certification",
        completion_date=date(2024, 1, 1),
        hours_completed=4.0,
        status=status,
        attachments=attachments,
    )


async def _set_retention(db_session, org_id, days):
    db_session.add(
        SelfReportConfig(organization_id=org_id, attachment_retention_days=days)
    )
    await db_session.flush()


async def _audit_rows(db_session, org_id):
    result = await db_session.execute(
        text(
            "SELECT event_data FROM audit_logs WHERE organization_id = :org "
            "AND event_type = 'self_report_attachment_retention'"
        ),
        {"org": org_id},
    )
    return result.fetchall()


@pytest.mark.integration
class TestSweep:
    async def test_expired_decided_files_are_deleted_and_unreferenced(
        self, db_session, upload_root
    ):
        org_id, user_id = await _org_and_member(db_session)
        await _set_retention(db_session, org_id, 365)
        approved_file = _stored_file(upload_root, org_id)
        rejected_file = _stored_file(upload_root, org_id)
        recent_file = _stored_file(upload_root, org_id)
        pending_file = _stored_file(upload_root, org_id)
        link = {"file_name": "elsewhere", "file_path": "https://example.org/c.pdf"}

        approved = _submission(
            org_id, user_id, [approved_file, link], SubmissionStatus.APPROVED, 400
        )
        rejected = _submission(
            org_id, user_id, [rejected_file], SubmissionStatus.REJECTED, 400
        )
        recent = _submission(
            org_id, user_id, [recent_file], SubmissionStatus.APPROVED, 30
        )
        pending = _submission(
            org_id, user_id, [pending_file], SubmissionStatus.PENDING_REVIEW, None
        )
        # The live record approval created, and a voided one left by an
        # earlier reversal: both copied the same attachment list.
        live = _record(org_id, user_id, [approved_file, link])
        voided = _record(
            org_id, user_id, [approved_file], status=TrainingStatus.CANCELLED
        )
        db_session.add_all([approved, rejected, recent, pending, live, voided])
        await db_session.flush()

        result = await SelfReportAttachmentRetention(db_session).sweep()

        assert result["files_deleted"] == 2
        assert result["errors"] == []
        assert not os.path.exists(approved_file["file_path"])
        assert not os.path.exists(rejected_file["file_path"])
        assert os.path.exists(recent_file["file_path"])
        assert os.path.exists(pending_file["file_path"])

        for row in (approved, rejected, recent, pending, live, voided):
            await db_session.refresh(row)
        assert approved.attachments == [link]
        assert rejected.attachments == []
        assert recent.attachments == [recent_file]
        assert pending.attachments == [pending_file]
        # Records survive; only the dead file reference goes.
        assert live.attachments == [link]
        assert voided.attachments == []

        audits = await _audit_rows(db_session, org_id)
        assert len(audits) == 1

        again = await SelfReportAttachmentRetention(db_session).sweep()
        assert again["files_deleted"] == 0
        assert len(await _audit_rows(db_session, org_id)) == 1

    async def test_unset_retention_keeps_everything(self, db_session, upload_root):
        org_id, user_id = await _org_and_member(db_session)
        no_config_file = _stored_file(upload_root, org_id)
        db_session.add(
            _submission(
                org_id, user_id, [no_config_file], SubmissionStatus.APPROVED, 5000
            )
        )
        other_org, other_user = await _org_and_member(db_session)
        await _set_retention(db_session, other_org, None)
        null_file = _stored_file(upload_root, other_org)
        db_session.add(
            _submission(
                other_org, other_user, [null_file], SubmissionStatus.APPROVED, 5000
            )
        )
        await db_session.flush()

        await SelfReportAttachmentRetention(db_session).sweep()

        assert os.path.exists(no_config_file["file_path"])
        assert os.path.exists(null_file["file_path"])

    async def test_an_expired_file_in_the_legacy_tree_is_deleted(
        self, db_session, upload_root
    ):
        org_id, user_id = await _org_and_member(db_session)
        await _set_retention(db_session, org_id, ATTACHMENT_RETENTION_MIN_DAYS)
        legacy = _stored_file(upload_root, org_id, legacy=True)
        submission = _submission(
            org_id, user_id, [legacy], SubmissionStatus.APPROVED, 400
        )
        db_session.add(submission)
        await db_session.flush()

        result = await SelfReportAttachmentRetention(db_session).sweep()

        assert result["files_deleted"] == 1
        assert not os.path.exists(legacy["file_path"])
        await db_session.refresh(submission)
        assert submission.attachments == []

    @pytest.mark.parametrize("legacy", [False, True])
    async def test_never_deletes_another_organizations_file(
        self, db_session, upload_root, legacy
    ):
        org_id, user_id = await _org_and_member(db_session)
        await _set_retention(db_session, org_id, ATTACHMENT_RETENTION_MIN_DAYS)
        victim_org, _ = await _org_and_member(db_session)
        # file_path is client-writable through the submission schemas.
        foreign = _stored_file(upload_root, victim_org, legacy=legacy)
        forged = _submission(org_id, user_id, [foreign], SubmissionStatus.APPROVED, 400)
        db_session.add(forged)
        await db_session.flush()

        await SelfReportAttachmentRetention(db_session).sweep()

        assert os.path.exists(foreign["file_path"])
        await db_session.refresh(forged)
        assert forged.attachments == [foreign]

    async def test_a_file_already_gone_is_still_unreferenced(
        self, db_session, upload_root
    ):
        """A previous run that unlinked the file and then failed to commit."""
        org_id, user_id = await _org_and_member(db_session)
        await _set_retention(db_session, org_id, 365)
        missing = _stored_file(upload_root, org_id)
        os.remove(missing["file_path"])
        submission = _submission(
            org_id, user_id, [missing], SubmissionStatus.APPROVED, 400
        )
        db_session.add(submission)
        await db_session.flush()

        await SelfReportAttachmentRetention(db_session).sweep()

        await db_session.refresh(submission)
        assert submission.attachments == []

    async def test_runs_as_a_scheduled_task(self, db_session, upload_root):
        org_id, user_id = await _org_and_member(db_session)
        await _set_retention(db_session, org_id, 365)
        expired = _stored_file(upload_root, org_id)
        db_session.add(
            _submission(org_id, user_id, [expired], SubmissionStatus.APPROVED, 400)
        )
        await db_session.flush()

        result = await run_self_report_attachment_retention(db_session)

        assert result["task"] == "self_report_attachment_retention"
        assert not os.path.exists(expired["file_path"])


@pytest.mark.unit
class TestSetting:
    def test_registered_with_the_scheduler(self):
        name = "self_report_attachment_retention"
        assert TASK_RUNNERS[name] is run_self_report_attachment_retention
        assert TASK_INTERVALS_SECONDS[name] == 86400
        assert name in SCHEDULE

    def test_default_is_keep_indefinitely(self):
        assert SelfReportConfig.__table__.c.attachment_retention_days.nullable
        assert SelfReportConfig.__table__.c.attachment_retention_days.default is None

    def test_floor_rejects_a_mistyped_short_period(self):
        with pytest.raises(ValidationError):
            SelfReportConfigUpdate(
                attachment_retention_days=ATTACHMENT_RETENTION_MIN_DAYS - 1
            )

    def test_null_clears_the_period(self):
        update = SelfReportConfigUpdate(attachment_retention_days=None)
        assert update.model_dump(exclude_unset=True) == {
            "attachment_retention_days": None
        }


@pytest.mark.integration
async def test_changing_the_period_is_audited(db_session):
    org_id, user_id = await _org_and_member(db_session)
    member = (
        await db_session.execute(select(User).where(User.id == user_id))
    ).scalar_one()
    await training_submissions.update_self_report_config(
        SelfReportConfigUpdate(attachment_retention_days=730),
        db=db_session,
        current_user=member,
    )
    rows = (
        await db_session.execute(
            text(
                "SELECT event_data FROM audit_logs WHERE organization_id = :org "
                "AND event_type = 'self_report_attachment_retention_updated'"
            ),
            {"org": org_id},
        )
    ).fetchall()
    assert len(rows) == 1
