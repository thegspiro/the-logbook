"""scripts/relocate_uploads.py — moving stored files into the org-first layout.

Integration: real rows, real files under a temporary uploads root. Each test
builds the legacy layout the way the pre-FileStorageService code wrote it.
"""

import json
import os
from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.document import Document
from app.models.event import Event
from app.models.training import TrainingRecord, TrainingSubmission
from app.services import file_storage_service, upload_relocation

pytestmark = pytest.mark.integration


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


def _legacy(root, *parts, data=b"%PDF-1.4 legacy"):
    path = root.joinpath(*parts)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return str(path)


async def _rows(db_session, org_id, admin_id, root):
    doc_path = _legacy(root, "documents", org_id, "a1.pdf")
    document = Document(organization_id=org_id, name="SOP", file_path=doc_path)
    event_id = str(uuid4())
    shared = _legacy(root, "event-attachments", org_id, event_id, "b2.pdf")
    events = [
        Event(
            id=event_id if i == 0 else str(uuid4()),
            organization_id=org_id,
            title="Drill",
            start_datetime=datetime(2026, 10, 8, 18, tzinfo=timezone.utc),
            end_datetime=datetime(2026, 10, 8, 20, tzinfo=timezone.utc),
            # A recurring copy shares the same stored file.
            attachments=[{"id": f"att-{i}", "file_name": "b.pdf", "file_path": shared}],
        )
        for i in range(2)
    ]
    cert = _legacy(
        root, "training_attachments", "self_reported_submissions", org_id, "c3.pdf"
    )
    submission = TrainingSubmission(
        organization_id=org_id,
        submitted_by=admin_id,
        course_name="EMT",
        training_type="certification",
        completion_date=date(2026, 10, 1),
        hours_completed=4,
        attachments=[{"file_name": "cert.pdf", "file_path": cert}],
    )
    # The approved certificate is referenced by the record too.
    record = TrainingRecord(
        organization_id=org_id,
        user_id=admin_id,
        course_name="EMT",
        training_type="certification",
        hours_completed=4,
        attachments=[{"file_name": "cert.pdf", "file_path": cert}],
    )
    db_session.add_all([document, *events, submission, record])
    await db_session.flush()
    # Plain ids: the tests expire the session to re-read rows, and touching an
    # expired attribute outside an awaited query fails under asyncio.
    return (
        str(document.id),
        [str(e.id) for e in events],
        str(submission.id),
        str(record.id),
        (doc_path, shared, cert),
    )


async def _reload(db_session, model, row_id):
    db_session.expire_all()
    return (
        await db_session.execute(select(model).where(model.id == row_id))
    ).scalar_one()


class TestRelocation:
    async def test_dry_run_changes_nothing(self, db_session, setup_org_and_admin, root):
        org_id, admin_id = setup_org_and_admin
        document, *_rest, paths = await _rows(db_session, org_id, admin_id, root)

        report = await upload_relocation.apply(db_session, organization_id=org_id)

        assert len(report.moves) == 3
        assert report.manifest_path is None
        assert (await _reload(db_session, Document, document)).file_path == paths[0]
        assert not (root / org_id).exists()

    async def test_apply_copies_repoints_and_keeps_the_originals(
        self, db_session, setup_org_and_admin, root
    ):
        org_id, admin_id = setup_org_and_admin
        document, events, submission, record, paths = await _rows(
            db_session, org_id, admin_id, root
        )
        doc_path, shared, cert = paths

        report = await upload_relocation.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        doc = await _reload(db_session, Document, document)
        assert doc.file_path == str(root / org_id / "documents" / "a1.pdf")
        # Both recurring copies point at one moved file, under the event that
        # was found first.
        new_shared = {
            (await _reload(db_session, Event, e)).attachments[0]["file_path"]
            for e in events
        }
        assert len(new_shared) == 1
        assert new_shared.pop().startswith(str(root / org_id / "event-attachments"))
        # The certificate moves under its submission, and the training record
        # follows it to the same path.
        expected = str(root / org_id / "self-reports" / submission / "c3.pdf")
        sub = await _reload(db_session, TrainingSubmission, submission)
        assert sub.attachments[0]["file_path"] == expected
        rec = await _reload(db_session, TrainingRecord, record)
        assert rec.attachments[0]["file_path"] == expected
        # Nothing is deleted by apply.
        for old in paths:
            assert os.path.isfile(old)
        manifest = json.loads(open(report.manifest_path).read())
        assert len(manifest["moves"]) == 3
        assert manifest["finalized"] is False

    async def test_rollback_restores_every_row_and_removes_the_copies(
        self, db_session, setup_org_and_admin, root
    ):
        org_id, admin_id = setup_org_and_admin
        document, events, submission, record, paths = await _rows(
            db_session, org_id, admin_id, root
        )
        report = await upload_relocation.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        result = await upload_relocation.rollback(db_session, report.manifest_path)

        assert result["copies_removed"] == 3
        assert (await _reload(db_session, Document, document)).file_path == paths[0]
        rec = await _reload(db_session, TrainingRecord, record)
        assert rec.attachments[0]["file_path"] == paths[2]
        assert not any((root / org_id).rglob("*.pdf"))

    async def test_finalize_deletes_the_originals_and_seals_the_manifest(
        self, db_session, setup_org_and_admin, root
    ):
        org_id, admin_id = setup_org_and_admin
        *_rows_, paths = await _rows(db_session, org_id, admin_id, root)
        report = await upload_relocation.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        result = upload_relocation.finalize(report.manifest_path)

        assert result == {"old_files_removed": 3, "kept_unverified": 0}
        for old in paths:
            assert not os.path.exists(old)
        with pytest.raises(ValueError, match="finalized"):
            await upload_relocation.rollback(db_session, report.manifest_path)

    async def test_finalize_keeps_an_original_whose_copy_does_not_verify(
        self, db_session, setup_org_and_admin, root
    ):
        org_id, admin_id = setup_org_and_admin
        document, *_rest, paths = await _rows(db_session, org_id, admin_id, root)
        report = await upload_relocation.apply(
            db_session, organization_id=org_id, dry_run=False
        )
        moved = (await _reload(db_session, Document, document)).file_path
        with open(moved, "wb") as handle:
            handle.write(b"tampered")

        result = upload_relocation.finalize(report.manifest_path)

        assert result["kept_unverified"] == 1
        assert os.path.isfile(paths[0])

    async def test_a_path_outside_the_rows_organization_is_left_alone(
        self, db_session, setup_org_and_admin, root
    ):
        org_id, _admin_id = setup_org_and_admin
        foreign = _legacy(root, "documents", str(uuid4()), "x.pdf")
        db_session.add(Document(organization_id=org_id, name="Odd", file_path=foreign))
        await db_session.flush()

        report = await upload_relocation.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        assert foreign in report.outside_storage
        assert report.moves == []
        assert os.path.isfile(foreign)

    async def test_a_rerun_finds_nothing_left_to_move(
        self, db_session, setup_org_and_admin, root
    ):
        org_id, admin_id = setup_org_and_admin
        await _rows(db_session, org_id, admin_id, root)
        await upload_relocation.apply(db_session, organization_id=org_id, dry_run=False)

        again = await upload_relocation.apply(db_session, organization_id=org_id)

        assert again.moves == []
        assert again.already_current >= 3
