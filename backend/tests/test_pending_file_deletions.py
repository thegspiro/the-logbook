"""The durable queue of files a committed hard delete still has to remove.

``pending_file_deletions`` rows are written in the delete's own transaction;
the endpoint processes them after its commit, and an hourly sweep retries
what is left. Every run must be safe to repeat (pitfall #36): a row resolves
once, a file already gone counts as deleted, and a file another row names is
kept.
"""

import uuid
from datetime import date
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import event, select, text

from app.models.pending_file_deletion import PendingDeletionReason, PendingFileDeletion
from app.models.training import TrainingRecord, TrainingStatus
from app.models.user import Organization, User, UserStatus
from app.services import (
    file_storage_service,
    member_files,
    pending_file_deletions,
    scheduled_tasks,
)
from app.services.file_storage_service import StorageArea
from app.services.member_files import FileRemoval, MemberFiles
from app.services.pending_file_deletions import PendingFileDeletionSweep, process


@pytest.mark.unit
class TestRegistration:
    def test_registered_with_the_scheduler(self):
        assert (
            scheduled_tasks.TASK_RUNNERS["pending_file_deletions"]
            is scheduled_tasks.run_pending_file_deletions
        )
        assert scheduled_tasks.TASK_INTERVALS_SECONDS["pending_file_deletions"] == 3600
        assert "pending_file_deletions" in scheduled_tasks.SCHEDULE

    def test_enqueue_only_adds_with_ids_assigned(self):
        added = []
        session = type("S", (), {"add": lambda self, row: added.append(row)})()

        ids = pending_file_deletions.enqueue(
            session,
            "org-1",
            {"/b": StorageArea.TRAINING_RECORDS, "/a": StorageArea.SELF_REPORTS},
            PendingDeletionReason.MEMBER_HARD_DELETE,
        )

        assert ids == [row.id for row in added]
        assert [(r.path, r.area, r.reason) for r in added] == [
            ("/a", "self-reports", "member_hard_delete"),
            ("/b", "training-records", "member_hard_delete"),
        ]
        assert all(len(row_id) == 36 for row_id in ids)

    def test_paths_by_area_takes_the_collectors_classification(self):
        files = MemberFiles(
            submission_paths={"/cert"},
            record_self_report_paths={"/cert", "/copy"},
            record_own_paths={"/upload"},
            waiver_paths={"/note"},
        )
        assert files.paths_by_area() == {
            "/cert": StorageArea.SELF_REPORTS,
            "/copy": StorageArea.SELF_REPORTS,
            "/upload": StorageArea.TRAINING_RECORDS,
            "/note": StorageArea.ATTENDANCE_WAIVERS,
        }


@pytest.fixture
def root(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    return uploads


@pytest.fixture
def audit(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr(pending_file_deletions, "log_audit_event", mock)
    return mock


async def _org(db, *, active=True):
    org = Organization(
        name="Pending FD", slug=f"pfd-{uuid.uuid4().hex[:8]}", active=active
    )
    db.add(org)
    await db.flush()
    return str(org.id)


async def _member(db, org_id):
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"p-{suffix}",
        email=f"p-{suffix}@example.org",
        first_name="Pat",
        last_name="Member",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    return str(user.id)


def _file(root, org_id, area="training-records"):
    directory = root / org_id / area / uuid.uuid4().hex
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{uuid.uuid4().hex}.pdf"
    path.write_bytes(b"%PDF-1.4")
    return path


async def _queue(db, org_id, path, area="training-records", *, aged=True):
    row = PendingFileDeletion(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        path=str(path),
        area=area,
        reason=PendingDeletionReason.MEMBER_HARD_DELETE.value,
    )
    db.add(row)
    await db.flush()
    if aged:
        await db.execute(
            text(
                "UPDATE pending_file_deletions "
                "SET created_at = created_at - INTERVAL 1 HOUR WHERE id = :id"
            ),
            {"id": row.id},
        )
    return row.id


async def _rows(db, org_id):
    return (
        await db.execute(
            select(
                PendingFileDeletion.id,
                PendingFileDeletion.attempts,
                PendingFileDeletion.last_error,
            )
            .where(PendingFileDeletion.organization_id == org_id)
            .execution_options(populate_existing=True)
        )
    ).all()


@pytest.mark.integration
class TestProcessing:
    async def test_a_shared_file_is_kept_and_its_row_resolved(
        self, db_session, root, audit
    ):
        org = await _org(db_session)
        colleague = await _member(db_session, org)
        roster = _file(root, org)
        db_session.add(
            TrainingRecord(
                organization_id=org,
                user_id=colleague,
                course_name="Drill",
                training_type="certification",
                completion_date=date(2024, 1, 1),
                hours_completed=1.0,
                status=TrainingStatus.COMPLETED,
                attachments=[{"file_name": "roster.pdf", "file_path": str(roster)}],
            )
        )
        await _queue(db_session, org, roster)

        result = await PendingFileDeletionSweep(db_session).run()

        assert roster.exists()
        assert await _rows(db_session, org) == []
        assert result["shared_kept"] == 1
        assert result["deleted"] == 0

    async def test_an_already_missing_file_resolves_its_row(
        self, db_session, root, audit
    ):
        org = await _org(db_session)
        gone = root / org / "training-records" / "x" / "gone.pdf"
        await _queue(db_session, org, gone)

        first = await PendingFileDeletionSweep(db_session).run()
        second = await PendingFileDeletionSweep(db_session).run()

        assert first["deleted"] == 1
        assert await _rows(db_session, org) == []
        assert (second["deleted"], second["shared_kept"], second["still_pending"]) == (
            0,
            0,
            0,
        )

    async def test_running_the_same_row_twice_has_one_effect(self, db_session, root):
        org = await _org(db_session)
        upload = _file(root, org)
        row_id = await _queue(db_session, org, upload)

        first = await process(db_session, org, [row_id])
        second = await process(db_session, org, [row_id])

        assert not upload.exists()
        assert first == FileRemoval(deleted=1)
        assert second == FileRemoval()
        assert await _rows(db_session, org) == []

    async def test_the_claim_skips_rows_another_run_holds(self, db_session, root):
        """The endpoint and a sweep, or two sweeps under the no-Redis
        fallback, must never work one row at once."""
        org = await _org(db_session)
        row_id = await _queue(db_session, org, _file(root, org))
        statements: list[str] = []
        engine = (await db_session.connection()).engine.sync_engine

        def capture(conn, cursor, statement, *args):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", capture)
        try:
            await process(db_session, org, [row_id])
        finally:
            event.remove(engine, "before_cursor_execute", capture)

        claims = [s for s in statements if "FROM pending_file_deletions" in s]
        assert claims
        assert "FOR UPDATE SKIP LOCKED" in claims[0]

    async def test_a_failed_delete_is_kept_and_retried(
        self, db_session, root, audit, monkeypatch
    ):
        org = await _org(db_session)
        upload = _file(root, org)
        await _queue(db_session, org, upload)
        monkeypatch.setattr(
            file_storage_service, "delete", AsyncMock(return_value=False)
        )

        result = await PendingFileDeletionSweep(db_session).run()

        [row] = await _rows(db_session, org)
        assert row.attempts == 1
        assert row.last_error == "storage delete failed"
        assert "/" not in row.last_error
        assert result["still_pending"] == 1
        assert upload.exists()

        monkeypatch.undo()
        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(root))
        monkeypatch.setattr(
            file_storage_service, "_load_settings", AsyncMock(return_value={})
        )
        monkeypatch.setattr(pending_file_deletions, "log_audit_event", audit)
        await PendingFileDeletionSweep(db_session).run()

        assert not upload.exists()
        assert await _rows(db_session, org) == []

    async def test_an_unconfined_path_is_never_deleted(self, db_session, root, audit):
        org = await _org(db_session)
        other_org = str(uuid.uuid4())
        theirs = _file(root, other_org)
        await _queue(db_session, org, theirs)

        result = await PendingFileDeletionSweep(db_session).run()

        assert theirs.exists()
        [row] = await _rows(db_session, org)
        assert row.attempts == 1
        assert row.last_error == "path no longer confined"
        assert result["still_pending"] == 1

    async def test_an_unknown_area_is_never_deleted(self, db_session, root, audit):
        org = await _org(db_session)
        upload = _file(root, org)
        await _queue(db_session, org, upload, area="bogus")

        await PendingFileDeletionSweep(db_session).run()

        assert upload.exists()
        [row] = await _rows(db_session, org)
        assert row.attempts == 1
        assert row.last_error == "path no longer confined"

    async def test_an_unanswerable_reference_check_leaves_the_rows(
        self, db_session, root, monkeypatch
    ):
        org = await _org(db_session)
        upload = _file(root, org)
        row_id = await _queue(db_session, org, upload)
        monkeypatch.setattr(
            member_files,
            "referenced_elsewhere",
            AsyncMock(side_effect=RuntimeError("database went away")),
        )

        result = await process(db_session, org, [row_id])

        assert result == FileRemoval(not_deleted=1)
        assert upload.exists()
        [row] = await _rows(db_session, org)
        assert row.attempts == 0


@pytest.mark.integration
class TestTheSweep:
    async def test_each_organization_is_checked_against_its_own_references(
        self, db_session, root, audit, monkeypatch
    ):
        org_a = await _org(db_session)
        org_b = await _org(db_session)
        await _queue(db_session, org_a, _file(root, org_a))
        await _queue(db_session, org_b, _file(root, org_b))
        check = AsyncMock(return_value=set())
        monkeypatch.setattr(member_files, "referenced_elsewhere", check)

        await PendingFileDeletionSweep(db_session).run()

        asked = {call.args[1] for call in check.await_args_list}
        assert {org_a, org_b} <= asked
        for call in check.await_args_list:
            if call.args[1] == org_a:
                assert all(org_a in path for path in call.args[2])

    async def test_recent_rows_wait_for_the_grace_period(self, db_session, root, audit):
        org = await _org(db_session)
        upload = _file(root, org)
        await _queue(db_session, org, upload, aged=False)

        await PendingFileDeletionSweep(db_session).run()

        assert upload.exists()
        assert len(await _rows(db_session, org)) == 1

    async def test_never_attempted_rows_come_first(self, db_session, root, audit):
        """Runs the real ordering on MySQL, which has no NULLS FIRST."""
        org = await _org(db_session)
        retried = _file(root, org)
        fresh = _file(root, org)
        retried_id = await _queue(db_session, org, retried)
        await _queue(db_session, org, fresh)
        await db_session.execute(
            text(
                "UPDATE pending_file_deletions SET attempts = 3, "
                "last_attempt_at = NOW() WHERE id = :id"
            ),
            {"id": retried_id},
        )

        await PendingFileDeletionSweep(db_session).run(max_rows=1)

        assert not fresh.exists()
        assert retried.exists()

    async def test_the_audit_event_carries_integer_counts_only(
        self, db_session, root, audit
    ):
        org = await _org(db_session)
        await _queue(db_session, org, _file(root, org))

        await PendingFileDeletionSweep(db_session).run()

        audit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "pending_file_deletions_completed"
        assert kwargs["organization_id"] == org
        assert kwargs["event_data"] == {
            "files_deleted": 1,
            "files_shared_kept": 0,
            "files_still_pending": 0,
        }
        assert all(type(v) is int for v in kwargs["event_data"].values())

    async def test_nothing_done_writes_no_audit_event(self, db_session, root, audit):
        await PendingFileDeletionSweep(db_session).run()
        audit.assert_not_awaited()

    async def test_rows_and_audit_commit_together(self, db_session, root, monkeypatch):
        org = await _org(db_session)
        upload = _file(root, org)
        await _queue(db_session, org, upload)
        await db_session.commit()
        monkeypatch.setattr(
            pending_file_deletions,
            "log_audit_event",
            AsyncMock(side_effect=RuntimeError("audit store down")),
        )

        result = await PendingFileDeletionSweep(db_session).run()

        assert result["errors"] == [{"org_id": org}]
        assert not upload.exists()
        assert len(await _rows(db_session, org)) == 1

        audit = AsyncMock()
        monkeypatch.setattr(pending_file_deletions, "log_audit_event", audit)
        again = await PendingFileDeletionSweep(db_session).run()

        assert again["deleted"] == 1
        assert await _rows(db_session, org) == []
        audit.assert_awaited_once()

    async def test_a_deactivated_department_is_still_swept(
        self, db_session, root, audit
    ):
        org = await _org(db_session, active=False)
        upload = _file(root, org)
        await _queue(db_session, org, upload)

        await PendingFileDeletionSweep(db_session).run()

        assert not upload.exists()
