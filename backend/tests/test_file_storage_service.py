"""The shared file storage service: layout, encryption at rest, confinement.

Every module that keeps an uploaded file goes through
``app/services/file_storage_service.py``. These tests pin the three things
that service exists to guarantee:

* files are encrypted on disk, and a file that has been tampered with,
  truncated or re-ordered fails to read rather than being served;
* a read names the organization, area and (where it applies) record it
  expects, and a reference to anything else is refused — so access to one
  module's files never reaches another's;
* files stored before the service existed (plaintext, absolute paths) stay
  readable, but only inside the directory their module always used.
"""

import io
import os
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core import file_encryption
from app.core.config import settings
from app.core.file_encryption import (
    DEFAULT_CHUNK_SIZE,
    HEADER_BYTES,
    TAG_BYTES,
    FileDecryptionError,
)
from app.core.security import reset_encryption_ciphers
from app.services.file_storage_service import (
    FileStorageService,
    StorageAccessDenied,
    StorageArea,
    StoredFileNotFound,
    content_disposition,
    get_file_storage,
    is_storage_key,
    stored_file_response,
)

ORG = "0f9c2b1a-0000-4000-8000-00000000000a"
OTHER_ORG = "0f9c2b1a-0000-4000-8000-00000000000b"
ENTITY = "0f9c2b1a-0000-4000-8000-0000000000e1"


def _save(content=b"%PDF-1.4 secret", org=ORG, area=StorageArea.DOCUMENTS):
    return get_file_storage().save(
        content, organization_id=org, area=area, entity_id=ENTITY
    )


def _disk_path(key: str) -> str:
    return os.path.join(settings.UPLOAD_DIR, key)


@pytest.mark.unit
class TestEncryptionAtRest:
    @pytest.mark.parametrize(
        "size",
        [0, 1, DEFAULT_CHUNK_SIZE - 1, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_SIZE + 1],
    )
    def test_round_trip_at_chunk_boundaries(self, size):
        content = os.urandom(size)
        stored = _save(content)

        opened = get_file_storage().open(
            stored.key, organization_id=ORG, area=StorageArea.DOCUMENTS
        )
        assert opened.size == size
        assert opened.read_all() == content

    def test_the_plaintext_never_reaches_the_disk(self):
        marker = b"PATIENT-NAME-JANE-DOE " * 100
        stored = _save(marker)

        on_disk = open(_disk_path(stored.key), "rb").read()
        assert b"PATIENT-NAME-JANE-DOE" not in on_disk
        assert on_disk.startswith(file_encryption.MAGIC)

    def test_layout_is_org_then_area_then_entity(self):
        stored = _save()
        org, area, entity, name = stored.key.split("/")
        assert (org, area, entity) == (ORG, "documents", ENTITY)
        assert name.endswith(".enc")
        assert is_storage_key(stored.key)

    def test_no_temporary_file_is_left_behind(self):
        stored = _save()
        directory = os.path.dirname(_disk_path(stored.key))
        assert os.listdir(directory) == [os.path.basename(stored.key)]

    def test_mtime_override_is_applied(self):
        when = datetime(2026, 1, 1, tzinfo=timezone.utc)
        stored = get_file_storage().save(
            b"x",
            organization_id=ORG,
            area=StorageArea.SUGGESTIONS,
            entity_id=ENTITY,
            mtime=when,
        )
        assert os.path.getmtime(_disk_path(stored.key)) == when.timestamp()
        # The per-record directory must not keep the real arrival time either.
        assert os.path.getmtime(os.path.dirname(_disk_path(stored.key))) == (
            when.timestamp()
        )


@pytest.mark.unit
class TestTamperingFailsClosed:
    def _read(self, key):
        return get_file_storage().read_bytes(
            key, organization_id=ORG, area=StorageArea.DOCUMENTS
        )

    def _rewrite(self, key, transform):
        path = _disk_path(key)
        data = open(path, "rb").read()
        with open(path, "wb") as handle:
            handle.write(transform(data))

    def test_a_flipped_byte_is_detected(self):
        stored = _save(b"A" * 1000)
        self._rewrite(
            stored.key,
            lambda d: d[: HEADER_BYTES + 5]
            + bytes([d[HEADER_BYTES + 5] ^ 1])
            + d[HEADER_BYTES + 6 :],
        )
        with pytest.raises(FileDecryptionError):
            self._read(stored.key)

    def test_an_edited_header_is_detected(self):
        stored = _save(b"A" * 1000)
        # The last header byte is part of the chunk size, which every chunk
        # authenticates as associated data.
        self._rewrite(
            stored.key,
            lambda d: d[: HEADER_BYTES - 2] + b"\x00\x01" + d[HEADER_BYTES:],
        )
        with pytest.raises(FileDecryptionError):
            self._read(stored.key)

    def test_dropping_the_final_chunk_is_detected(self):
        # Two full chunks: removing the second leaves a well-formed first
        # chunk that was not flagged final, which must not pass as the file.
        stored = _save(os.urandom(DEFAULT_CHUNK_SIZE * 2))
        block = DEFAULT_CHUNK_SIZE + TAG_BYTES
        self._rewrite(stored.key, lambda d: d[: HEADER_BYTES + block])
        with pytest.raises(FileDecryptionError):
            self._read(stored.key)

    def test_reordered_chunks_are_detected(self):
        stored = _save(os.urandom(DEFAULT_CHUNK_SIZE * 2 + 10))
        block = DEFAULT_CHUNK_SIZE + TAG_BYTES

        def _swap(d):
            header = d[:HEADER_BYTES]
            first = d[HEADER_BYTES : HEADER_BYTES + block]
            second = d[HEADER_BYTES + block : HEADER_BYTES + 2 * block]
            rest = d[HEADER_BYTES + 2 * block :]
            return header + second + first + rest

        self._rewrite(stored.key, _swap)
        with pytest.raises(FileDecryptionError):
            self._read(stored.key)

    def test_plaintext_planted_under_a_key_is_refused(self):
        stored = _save(b"real")
        self._rewrite(stored.key, lambda d: b"%PDF-1.4 planted plaintext")
        with pytest.raises(FileDecryptionError):
            self._read(stored.key)


@pytest.mark.unit
class TestKeys:
    @pytest.fixture(autouse=True)
    def _restore_ciphers(self):
        yield
        reset_encryption_ciphers()

    def test_a_different_key_cannot_read_the_file(self, monkeypatch):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "a" * 64)
        stored = _save(b"secret")
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "b" * 64)
        with pytest.raises(FileDecryptionError):
            get_file_storage().read_bytes(
                stored.key, organization_id=ORG, area=StorageArea.DOCUMENTS
            )

    def test_a_rotated_key_reads_through_the_legacy_ring(self, monkeypatch):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "a" * 64)
        stored = _save(b"secret")
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "b" * 64)
        monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", "a" * 64)
        assert (
            get_file_storage().read_bytes(
                stored.key, organization_id=ORG, area=StorageArea.DOCUMENTS
            )
            == b"secret"
        )


@pytest.mark.unit
class TestConfinement:
    def test_another_organization_is_refused(self):
        stored = _save()
        with pytest.raises(StorageAccessDenied):
            get_file_storage().open(
                stored.key, organization_id=OTHER_ORG, area=StorageArea.DOCUMENTS
            )

    def test_another_module_is_refused(self):
        """Access to one area never reaches another, even in the same org."""
        stored = _save(area=StorageArea.TRAINING)
        with pytest.raises(StorageAccessDenied):
            get_file_storage().open(
                stored.key, organization_id=ORG, area=StorageArea.DOCUMENTS
            )

    def test_another_record_is_refused_when_the_entity_is_named(self):
        stored = _save()
        with pytest.raises(StorageAccessDenied):
            get_file_storage().open(
                stored.key,
                organization_id=ORG,
                area=StorageArea.DOCUMENTS,
                entity_id=str(uuid4()),
            )

    @pytest.mark.parametrize(
        "reference",
        [
            "/etc/passwd",
            f"{ORG}/documents/../../etc/passwd",
            f"{ORG}/documents/{ENTITY}/../x.enc",
            f"../{ORG}/documents/{ENTITY}/{'a' * 32}.enc",
            "",
            None,
            42,
        ],
    )
    def test_malformed_and_traversal_references_are_refused(self, reference):
        with pytest.raises(StorageAccessDenied):
            get_file_storage().resolve(
                reference, organization_id=ORG, area=StorageArea.DOCUMENTS
            )

    def test_a_symlink_out_of_the_area_is_refused(self, tmp_path):
        outside = tmp_path / "outside.txt"
        outside.write_bytes(b"not yours")
        key = f"{ORG}/documents/{ENTITY}/{'b' * 32}.enc"
        os.makedirs(os.path.dirname(_disk_path(key)), exist_ok=True)
        os.symlink(outside, _disk_path(key))
        with pytest.raises(StorageAccessDenied):
            get_file_storage().open(
                key, organization_id=ORG, area=StorageArea.DOCUMENTS
            )

    def test_a_missing_file_is_not_found(self):
        key = f"{ORG}/documents/{ENTITY}/{'c' * 32}.enc"
        with pytest.raises(StoredFileNotFound):
            get_file_storage().open(
                key, organization_id=ORG, area=StorageArea.DOCUMENTS
            )

    def test_delete_is_confined_too(self, tmp_path):
        victim = tmp_path / "victim.pdf"
        victim.write_bytes(b"keep me")
        with pytest.raises(StorageAccessDenied):
            get_file_storage().delete(
                str(victim), organization_id=ORG, area=StorageArea.DOCUMENTS
            )
        assert victim.exists()

    def test_delete_reports_a_file_already_gone(self):
        stored = _save()
        storage = get_file_storage()
        scope = {"organization_id": ORG, "area": StorageArea.DOCUMENTS}
        assert storage.delete(stored.key, **scope) is True
        assert storage.delete(stored.key, **scope) is False


@pytest.mark.unit
class TestLegacyFiles:
    def test_a_legacy_plaintext_file_inside_its_directory_is_served(self, tmp_path):
        legacy_dir = tmp_path / ORG
        legacy_dir.mkdir()
        legacy = legacy_dir / "old.pdf"
        legacy.write_bytes(b"%PDF legacy")

        opened = get_file_storage().open(
            str(legacy),
            organization_id=ORG,
            area=StorageArea.DOCUMENTS,
            legacy_dirs=[str(legacy_dir)],
        )
        assert opened.size == len(b"%PDF legacy")
        assert opened.read_all() == b"%PDF legacy"

    def test_a_legacy_path_in_another_orgs_directory_is_refused(self, tmp_path):
        theirs = tmp_path / OTHER_ORG / "theirs.pdf"
        theirs.parent.mkdir()
        theirs.write_bytes(b"%PDF theirs")
        with pytest.raises(StorageAccessDenied):
            get_file_storage().open(
                str(theirs),
                organization_id=ORG,
                area=StorageArea.DOCUMENTS,
                legacy_dirs=[str(tmp_path / ORG)],
            )


@pytest.mark.unit
class TestConfiguration:
    def test_a_relative_upload_dir_resolves_to_an_absolute_root(self, monkeypatch):
        monkeypatch.setattr(settings, "UPLOAD_DIR", "./uploads")
        assert os.path.isabs(FileStorageService().root)

    def test_an_unimplemented_storage_type_still_stores_locally(self, monkeypatch):
        """STORAGE_TYPE was read by nothing before; an install carrying a
        non-local value must keep working rather than refuse every upload."""
        monkeypatch.setattr(settings, "STORAGE_TYPE", "s3")
        stored = _save(b"still local")
        assert os.path.isfile(_disk_path(stored.key))


@pytest.mark.unit
class TestDownloadResponse:
    async def test_streams_the_decrypted_file_with_safe_headers(self):
        stored = _save(b"%PDF-1.4 body")
        opened = get_file_storage().open(
            stored.key, organization_id=ORG, area=StorageArea.DOCUMENTS
        )
        response = stored_file_response(
            opened, filename="report.pdf", media_type="application/pdf"
        )
        body = b"".join([chunk async for chunk in response.body_iterator])

        assert body == b"%PDF-1.4 body"
        assert response.headers["content-length"] == str(len(body))
        assert response.headers["content-disposition"] == (
            'attachment; filename="report.pdf"'
        )
        assert response.headers["cache-control"] == "private, no-store"
        assert response.headers["x-content-type-options"] == "nosniff"

    def test_a_stored_name_cannot_inject_a_header(self):
        value = content_disposition('evil"\r\nSet-Cookie: x=1.pdf')
        assert "\r" not in value
        assert "\n" not in value
        assert value == "attachment; filename*=utf-8''evilSet-Cookie%3A%20x%3D1.pdf"

    def test_a_non_ascii_name_uses_rfc_5987(self):
        assert content_disposition("Übung.pdf") == (
            "attachment; filename*=utf-8''%C3%9Cbung.pdf"
        )


@pytest.mark.unit
class TestModuleScopes:
    def test_event_attachment_keys_are_org_scoped_not_event_scoped(self):
        """Recurring occurrences and duplicates share one file deliberately."""
        from app.utils.event_attachments import is_path_in_org

        stored = get_file_storage().save(
            b"x", organization_id=ORG, area=StorageArea.EVENTS, entity_id=ENTITY
        )
        assert is_path_in_org(stored.key, ORG) is True
        assert is_path_in_org(stored.key, OTHER_ORG) is False
        assert is_path_in_org(_save().key, ORG) is False  # a documents key

    def test_retention_deletes_only_the_submitters_own_certificates(self, tmp_path):
        from app.services.self_report_attachment_retention import _delete_certificate

        member, other_member = str(uuid4()), str(uuid4())
        storage = get_file_storage()
        own = storage.save(
            b"own",
            organization_id=ORG,
            area=StorageArea.TRAINING_SUBMISSIONS,
            entity_id=member,
        )
        others = storage.save(
            b"theirs",
            organization_id=ORG,
            area=StorageArea.TRAINING_SUBMISSIONS,
            entity_id=other_member,
        )
        submission = SimpleNamespace(
            id="sub-1", organization_id=ORG, submitted_by=member
        )

        assert _delete_certificate(own.key, submission, str(tmp_path)) is True
        assert not os.path.exists(_disk_path(own.key))
        assert _delete_certificate(others.key, submission, str(tmp_path)) is False
        assert os.path.exists(_disk_path(others.key))

    def test_a_record_reads_its_owners_approved_certificates(self):
        from app.api.v1.endpoints.training_enhancements import open_record_attachment

        member = str(uuid4())
        record = SimpleNamespace(id=str(uuid4()), organization_id=ORG, user_id=member)
        certificate = get_file_storage().save(
            b"cert",
            organization_id=ORG,
            area=StorageArea.TRAINING_SUBMISSIONS,
            entity_id=member,
        )
        someone_elses = get_file_storage().save(
            b"other",
            organization_id=ORG,
            area=StorageArea.TRAINING_SUBMISSIONS,
            entity_id=str(uuid4()),
        )

        assert open_record_attachment(certificate.key, record).read_all() == b"cert"
        with pytest.raises(StorageAccessDenied):
            open_record_attachment(someone_elses.key, record)

    def test_cloudflare_attachments_accept_in_memory_files(self):
        from app.services.email_service import EmailAttachmentFile, EmailService

        attachments = EmailService._build_cloudflare_attachments(
            None,
            attachment_files=[
                EmailAttachmentFile("Handbook.pdf", b"%PDF", "application/pdf")
            ],
        )
        assert attachments[0]["filename"] == "Handbook.pdf"
        assert attachments[0]["type"] == "application/pdf"


@pytest.mark.integration
class TestDocumentUploadAndDownload:
    """End to end through the documents endpoints against a real database."""

    async def _org_and_manager(self, db_session):
        from app.models.user import Organization, Position, User, user_positions

        org = Organization(name="Falls Church VFD", slug=f"fcvfd-fs-{uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        user = User(
            organization_id=org.id,
            username=f"mgr-{uuid4().hex[:8]}",
            email=f"{uuid4().hex[:8]}@example.com",
        )
        db_session.add(user)
        await db_session.flush()
        position = Position(
            organization_id=org.id,
            name="Clerk",
            slug=f"clerk-{user.id[:8]}",
            permissions=["documents.manage", "documents.view"],
        )
        db_session.add(position)
        await db_session.flush()
        await db_session.execute(
            user_positions.insert().values(user_id=user.id, position_id=position.id)
        )
        await db_session.flush()
        result = await db_session.execute(
            select(User)
            .where(User.id == user.id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
        return org, result.scalar_one()

    async def _upload(self, db_session, user, content, filename="report.pdf"):
        from app.api.v1.endpoints.documents import upload_document

        return await upload_document(
            file=UploadFile(file=io.BytesIO(content), filename=filename),
            name="Report",
            description=None,
            folder_id=None,
            tags=None,
            db=db_session,
            current_user=user,
        )

    async def test_upload_is_encrypted_and_downloads_intact(self, db_session):
        from app.api.v1.endpoints.documents import download_document

        org, user = await self._org_and_manager(db_session)
        content = b"%PDF-1.4 confidential incident report"
        document = await self._upload(db_session, user, content)

        assert document.file_path.startswith(f"{org.id}/documents/{document.id}/")
        on_disk = open(_disk_path(document.file_path), "rb").read()
        assert b"confidential incident report" not in on_disk

        response = await download_document(
            document.id, db=db_session, current_user=user
        )
        body = b"".join([chunk async for chunk in response.body_iterator])
        assert body == content
        assert 'filename="report.pdf"' in response.headers["content-disposition"]

    async def test_a_row_pointing_at_another_documents_file_is_refused(
        self, db_session
    ):
        from app.api.v1.endpoints.documents import download_document

        _org, user = await self._org_and_manager(db_session)
        first = await self._upload(db_session, user, b"%PDF-1.4 first")
        second = await self._upload(db_session, user, b"%PDF-1.4 second")

        second.file_path = first.file_path
        await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await download_document(second.id, db=db_session, current_user=user)
        assert exc.value.status_code == 403

    async def test_deleting_the_document_removes_its_file(self, db_session):
        from app.api.v1.endpoints.documents import delete_document

        _org, user = await self._org_and_manager(db_session)
        document = await self._upload(db_session, user, b"%PDF-1.4 to delete")
        path = _disk_path(document.file_path)
        assert os.path.exists(path)

        await delete_document(document.id, db=db_session, current_user=user)

        assert not os.path.exists(path)
