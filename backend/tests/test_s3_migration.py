"""scripts/migrate_uploads_to_s3.py — moving a department's files into its bucket.

Integration: real rows and real files under a temporary uploads root, with
moto standing in for the department's bucket.
"""

import json
import os
from datetime import datetime, timezone
from uuid import uuid4

import boto3
import pytest
from moto import mock_aws
from sqlalchemy import select, text

from app.core import file_encryption
from app.core.config import settings
from app.core.security import reset_encryption_ciphers
from app.models.document import Document
from app.models.event import Event
from app.schemas.organization import encrypt_settings_secrets
from app.services import file_storage_service as file_storage
from app.services import remote_migration, s3_storage
from app.services.file_storage_service import ACTIVATION_KEY, StorageArea
from app.services.s3_storage import S3Backend, S3StorageError

pytestmark = pytest.mark.integration

BUCKET = "dept-files"
FILE_STORAGE = {
    "platform": "s3",
    "s3_bucket_name": BUCKET,
    "s3_access_key_id": "AKIATESTKEY",
    "s3_secret_access_key": "test-secret",
    "s3_region": "us-east-1",
}


@pytest.fixture
def root(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(file_storage, "UPLOADS_ROOT", str(uploads))
    return uploads


@pytest.fixture
def bucket(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        yield client


async def _switch_to_s3(db_session, org_id):
    config = s3_storage.config_from_settings(FILE_STORAGE)
    assert config is not None
    stored = encrypt_settings_secrets(
        {
            "file_storage": dict(FILE_STORAGE),
            ACTIVATION_KEY: {
                "platform": "s3",
                "fingerprint": config.fingerprint(),
                "bucket": BUCKET,
                "activated_at": "2026-10-22T12:00:00+00:00",
            },
        }
    )
    await db_session.execute(
        text("UPDATE organizations SET settings = :s WHERE id = :id"),
        {"s": json.dumps(stored), "id": org_id},
    )
    await db_session.flush()


def _on_disk(org_id, area, record, name, data):
    directory = file_storage.area_directory(org_id, area, record)
    return file_storage.write_atomically(directory, name, data)


async def _rows(db_session, org_id, root):
    document_id = str(uuid4())
    doc_path = _on_disk(
        org_id, StorageArea.DOCUMENTS, document_id, "a.pdf", b"%PDF-1.4 sop"
    )
    event_id = str(uuid4())
    shared = _on_disk(
        org_id, StorageArea.EVENT_ATTACHMENTS, event_id, "b.pdf", b"%PDF-1.4 drill"
    )
    legacy = root / "documents" / org_id / "old.pdf"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"%PDF-1.4 legacy")
    db_session.add_all(
        [
            Document(
                id=document_id, organization_id=org_id, name="SOP", file_path=doc_path
            ),
            Document(organization_id=org_id, name="Old", file_path=str(legacy)),
            *[
                Event(
                    id=event_id if i == 0 else str(uuid4()),
                    organization_id=org_id,
                    title="Drill",
                    start_datetime=datetime(2026, 10, 8, 18, tzinfo=timezone.utc),
                    end_datetime=datetime(2026, 10, 8, 20, tzinfo=timezone.utc),
                    # A recurring copy shares the stored file.
                    attachments=[{"id": f"a{i}", "file_path": shared}],
                )
                for i in range(2)
            ],
        ]
    )
    await db_session.flush()
    return document_id, doc_path, shared, str(legacy)


async def _document_path(db_session, document_id):
    db_session.expire_all()
    return (
        await db_session.execute(
            select(Document.file_path).where(Document.id == document_id)
        )
    ).scalar_one()


async def _event_paths(db_session, org_id):
    db_session.expire_all()
    rows = (
        await db_session.execute(
            select(Event.attachments).where(Event.organization_id == org_id)
        )
    ).scalars()
    return {attachments[0]["file_path"] for attachments in rows}


class TestApply:
    async def test_dry_run_changes_nothing(
        self, db_session, setup_org_and_admin, root, bucket
    ):
        org_id, _admin = setup_org_and_admin
        await _switch_to_s3(db_session, org_id)
        document_id, doc_path, _shared, legacy = await _rows(db_session, org_id, root)

        report = await remote_migration.apply(db_session, organization_id=org_id)

        assert len(report.copies) == 2
        assert report.needs_relocation == [legacy]
        assert report.manifest_path is None
        assert await _document_path(db_session, document_id) == doc_path
        assert bucket.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0

    async def test_apply_copies_verifies_repoints_and_keeps_the_disk_copies(
        self, db_session, setup_org_and_admin, root, bucket
    ):
        org_id, _admin = setup_org_and_admin
        await _switch_to_s3(db_session, org_id)
        document_id, doc_path, shared, _legacy = await _rows(db_session, org_id, root)

        report = await remote_migration.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        new_doc = await _document_path(db_session, document_id)
        assert new_doc == (f"s3://{BUCKET}/{org_id}/documents/{document_id}/a.pdf")
        # Both recurring copies point at the one object.
        events = await _event_paths(db_session, org_id)
        assert len(events) == 1
        assert events.pop().startswith(f"s3://{BUCKET}/{org_id}/event-attachments/")
        # Encrypted in the bucket, served as plaintext, and still on disk.
        raw = bucket.get_object(
            Bucket=BUCKET, Key=f"{org_id}/documents/{document_id}/a.pdf"
        )["Body"].read()
        assert file_encryption.is_encrypted_bytes(raw)
        assert await file_storage.read_bytes(new_doc) == b"%PDF-1.4 sop"
        assert os.path.isfile(doc_path)
        assert os.path.isfile(shared)
        manifest = json.loads(open(report.manifest_path).read())
        assert manifest["kind"] == "s3-migration"
        assert len(manifest["copies"]) == 2
        assert report.rows_updated == 3

    async def test_a_second_run_finds_nothing_left(
        self, db_session, setup_org_and_admin, root, bucket
    ):
        org_id, _admin = setup_org_and_admin
        await _switch_to_s3(db_session, org_id)
        await _rows(db_session, org_id, root)
        await remote_migration.apply(db_session, organization_id=org_id, dry_run=False)
        file_storage.forget_org_storage()

        again = await remote_migration.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        assert again.copies == []
        assert again.already_in_bucket == 3
        assert again.manifest_path is None

    async def test_a_copy_that_fails_leaves_its_rows_on_disk(
        self, db_session, setup_org_and_admin, root, bucket, monkeypatch
    ):
        org_id, _admin = setup_org_and_admin
        await _switch_to_s3(db_session, org_id)
        document_id, doc_path, _shared, _legacy = await _rows(db_session, org_id, root)
        real_put = S3Backend.put

        def flaky_put(self, location, plaintext):
            if location.key.startswith(f"{org_id}/documents/"):
                raise S3StorageError("S3 upload failed")
            return real_put(self, location, plaintext)

        monkeypatch.setattr(S3Backend, "put", flaky_put)

        report = await remote_migration.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        assert report.failed == [doc_path]
        assert await _document_path(db_session, document_id) == doc_path
        assert len(report.copies) == 1

    async def test_naming_a_department_that_has_not_switched_is_refused(
        self, db_session, setup_org_and_admin, root
    ):
        org_id, _admin = setup_org_and_admin
        with pytest.raises(ValueError, match="connection test"):
            await remote_migration.apply(db_session, organization_id=org_id)

    async def test_departments_that_have_not_switched_are_left_alone(
        self, db_session, setup_org_and_admin, root
    ):
        org_id, _admin = setup_org_and_admin
        await _rows(db_session, org_id, root)

        report = await remote_migration.apply(db_session, dry_run=False)

        assert org_id not in report.organizations
        assert report.copies == [] or all(
            copy.organization_id != org_id for copy in report.copies
        )


class TestRollbackAndFinalize:
    async def _applied(self, db_session, org_id, root):
        await _switch_to_s3(db_session, org_id)
        rows = await _rows(db_session, org_id, root)
        report = await remote_migration.apply(
            db_session, organization_id=org_id, dry_run=False
        )
        return rows, report.manifest_path

    async def test_rollback_points_rows_back_and_removes_the_bucket_copies(
        self, db_session, setup_org_and_admin, root, bucket
    ):
        org_id, _admin = setup_org_and_admin
        (document_id, doc_path, shared, _legacy), manifest = await self._applied(
            db_session, org_id, root
        )

        result = await remote_migration.rollback(db_session, manifest)

        assert result == {
            "rows_restored": 3,
            "bucket_copies_removed": 2,
            "bucket_copies_kept": 0,
        }
        assert await _document_path(db_session, document_id) == doc_path
        assert await _event_paths(db_session, org_id) == {shared}
        assert bucket.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0
        with pytest.raises(ValueError, match="rolled back"):
            await remote_migration.finalize(db_session, manifest)

    async def test_finalize_deletes_the_disk_copies_once_verified(
        self, db_session, setup_org_and_admin, root, bucket
    ):
        org_id, _admin = setup_org_and_admin
        (document_id, doc_path, shared, legacy), manifest = await self._applied(
            db_session, org_id, root
        )

        result = await remote_migration.finalize(db_session, manifest)

        assert result == {"disk_copies_removed": 2, "kept_unverified": 0}
        assert not os.path.exists(doc_path)
        assert not os.path.exists(shared)
        assert os.path.isfile(legacy)  # never part of the run
        new_doc = await _document_path(db_session, document_id)
        assert await file_storage.read_bytes(new_doc) == b"%PDF-1.4 sop"
        assert json.loads(open(manifest).read())["finalized"] is True
        with pytest.raises(ValueError, match="finalized"):
            await remote_migration.rollback(db_session, manifest)

    async def test_finalize_keeps_a_disk_copy_whose_bucket_copy_is_gone(
        self, db_session, setup_org_and_admin, root, bucket
    ):
        org_id, _admin = setup_org_and_admin
        (document_id, doc_path, _shared, _legacy), manifest = await self._applied(
            db_session, org_id, root
        )
        bucket.delete_object(
            Bucket=BUCKET, Key=f"{org_id}/documents/{document_id}/a.pdf"
        )

        result = await remote_migration.finalize(db_session, manifest)

        assert result == {"disk_copies_removed": 1, "kept_unverified": 1}
        assert os.path.isfile(doc_path)
        assert json.loads(open(manifest).read())["finalized"] is False

    async def test_a_manifest_of_another_kind_is_refused(
        self, db_session, root, tmp_path
    ):
        other = tmp_path / "relocation.json"
        other.write_text(json.dumps({"version": 1, "moves": []}))
        with pytest.raises(ValueError, match="not a storage migration manifest"):
            await remote_migration.rollback(db_session, str(other))


class TestInventoryAndRewrap:
    async def test_inventory_counts_files_per_bucket(
        self, db_session, setup_org_and_admin, root, bucket
    ):
        org_id, _admin = setup_org_and_admin
        await _switch_to_s3(db_session, org_id)
        await _rows(db_session, org_id, root)
        await remote_migration.apply(db_session, organization_id=org_id, dry_run=False)

        inventory = await remote_migration.bucket_inventory(db_session)

        assert {
            "organization_id": org_id,
            "platform": "s3",
            "bucket": BUCKET,
            "files": 2,
        } in inventory

    async def test_rewrap_moves_bucket_objects_off_a_retired_key(
        self, db_session, setup_org_and_admin, root, bucket, monkeypatch
    ):
        key_a, key_b = "a" * 64, "b" * 64
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", key_a)
        monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", "")
        reset_encryption_ciphers()
        org_id, _admin = setup_org_and_admin
        await _switch_to_s3(db_session, org_id)
        document_id, *_rest = await _rows(db_session, org_id, root)
        await remote_migration.apply(db_session, organization_id=org_id, dry_run=False)

        monkeypatch.setattr(settings, "ENCRYPTION_KEY", key_b)
        monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", key_a)
        reset_encryption_ciphers()
        file_storage.forget_org_storage()
        try:
            dry = await remote_migration.rewrap_bucket_objects(db_session, dry_run=True)
            assert dry["bucket_objects_under_a_retired_key"] == 2
            done = await remote_migration.rewrap_bucket_objects(
                db_session, dry_run=False
            )
            assert done["bucket_objects_rewrapped"] == 2
            assert done["failed"] == 0

            # Readable with the old key gone.
            monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", "")
            reset_encryption_ciphers()
            ref = await _document_path(db_session, document_id)
            assert await file_storage.read_bytes(ref) == b"%PDF-1.4 sop"
            again = await remote_migration.rewrap_bucket_objects(
                db_session, dry_run=True
            )
            assert again["bucket_objects_under_a_retired_key"] == 0
        finally:
            monkeypatch.undo()
            reset_encryption_ciphers()
