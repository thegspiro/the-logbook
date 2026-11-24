"""scripts/relink_restored_drive_files.py — pointing records at Shared Drive
files put back from a copy (KNOWN_LIMITATIONS, "A copy of a Shared Drive
cannot simply be put back").

A file uploaded again from a copy keeps its name, which is its storage key,
and gets a new id. ``FakeDrive`` (from the Drive backend's own tests) stands
in for Google, with a files.list added.
"""

import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.core import file_encryption
from app.models.document import Document
from app.models.event import Event
from app.schemas.organization import encrypt_settings_secrets
from app.services import drive_restore_relink
from app.services import file_storage_service as file_storage
from app.services import google_drive_storage as gdrive
from app.services.google_drive_storage import GoogleDriveBackend
from tests.test_google_drive_storage import DRIVE, FakeDrive, FakeResponse, _settings

SCRIPTS = os.path.join(os.path.dirname(__file__), "..", "scripts")


class ListingDrive(FakeDrive):
    """FakeDrive with files.list, paged two files at a time so paging is
    exercised, and a way to put a copy back the way a person would: a new
    upload under the same name, which Drive gives a new id."""

    page_size = 2

    def request(self, method, url, params=None, timeout=None, **kwargs):
        if method == "GET" and urlparse(url).path == "/drive/v3/files":
            assert timeout is not None
            params = params or {}
            self.calls.append((method, url, params))
            assert params["corpora"] == "drive"
            assert params["driveId"] == self.drive_id
            assert params["includeItemsFromAllDrives"] == "true"
            assert params["supportsAllDrives"] == "true"
            if self.down:
                raise ConnectionError("network is unreachable")
            live = sorted(
                (i, f["name"])
                for i, f in self.files.items()
                if not f.get("trashed") and f["drive"] == self.drive_id
            )
            start = int(params.get("pageToken") or 0)
            page = live[start : start + self.page_size]
            body = {"files": [{"id": i, "name": n} for i, n in page]}
            if start + self.page_size < len(live):
                body["nextPageToken"] = str(start + self.page_size)
            return FakeResponse(200, payload=body)
        return super().request(method, url, params=params, timeout=timeout, **kwargs)

    def restore_copy(self, name: str, ciphertext: bytes) -> str:
        new_id = self._id()
        self.files[new_id] = {
            "bytes": ciphertext,
            "name": name,
            "parents": [self.drive_id],
            "drive": self.drive_id,
            "mime": "application/octet-stream",
        }
        return new_id

    def lose(self, file_id: str) -> bytes:
        """The original, gone for good (the trash was emptied)."""
        return self.files.pop(file_id)["bytes"]


@pytest.fixture
def drive(monkeypatch):
    fake = ListingDrive()
    monkeypatch.setattr(gdrive, "_authorized_session", lambda config: fake)
    file_storage.forget_org_storage()
    yield fake
    file_storage.forget_org_storage()


def _backend(drive) -> GoogleDriveBackend:
    config = gdrive.config_from_settings(_settings())
    assert config is not None
    return GoogleDriveBackend(config, session=drive)


def _store(drive, org, area, data, name="a.pdf") -> str:
    backend = _backend(drive)
    ref = backend.ref_for(f"{org}/{area}/{uuid4().hex}/{name}")
    backend.put(ref, data)
    return ref


def _restored(drive, ref) -> str:
    """Lose the original and put back a copy of it; the new reference."""
    location = gdrive.parse_ref(ref)
    ciphertext = drive.lose(location.file_id)
    new_id = drive.restore_copy(gdrive.file_name_for(location.key), ciphertext)
    return gdrive.make_ref(DRIVE, new_id, location.key)


@pytest.mark.unit
class TestTheListing:
    def test_every_page_is_read_and_the_trash_is_left_out(self, drive):
        org = str(uuid4())
        refs = [_store(drive, org, "documents", b"%PDF-1.4 x") for _ in range(5)]
        trashed = gdrive.parse_ref(refs[0]).file_id
        drive.files[trashed]["trashed"] = True

        listed = _backend(drive).list_files()

        assert sorted(i for i, _n in listed) == sorted(
            gdrive.parse_ref(r).file_id for r in refs[1:]
        )
        names = {gdrive.file_name_for(gdrive.parse_ref(r).key) for r in refs[1:]}
        assert {n for _i, n in listed} == names

    def test_a_refused_listing_raises(self, drive):
        drive.down = True
        with pytest.raises(gdrive.GoogleDriveStorageError):
            _backend(drive).list_files()

    def test_the_name_a_file_is_stored_under_is_the_one_matched(self, drive):
        org = str(uuid4())
        ref = _store(drive, org, "documents", b"%PDF-1.4 x")
        location = gdrive.parse_ref(ref)
        assert drive.files[location.file_id]["name"] == gdrive.file_name_for(
            location.key
        )


@pytest.mark.unit
class TestTheCommandLine:
    def _cli(self):
        spec = importlib.util.spec_from_file_location(
            "relink_restored_drive_files",
            os.path.join(SCRIPTS, "relink_restored_drive_files.py"),
        )
        assert spec is not None
        assert spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_an_unknown_option_is_refused(self, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["relink_restored_drive_files.py", "--yes"])
        with pytest.raises(SystemExit) as caught:
            self._cli().main()
        assert caught.value.code == 2

    def test_a_failure_exits_2(self, monkeypatch, capsys):
        module = self._cli()

        async def broken(args):
            raise RuntimeError("database is down")

        monkeypatch.setattr(module, "_run", broken)
        monkeypatch.setattr(sys, "argv", ["relink_restored_drive_files.py"])
        assert module.main() == 2
        assert "Drive relink failed: RuntimeError" in capsys.readouterr().err


async def _use_drive(db_session, org_id):
    """Save Google Drive settings for the department. No connection test:
    the relink reads through saved settings, not the current write target."""
    stored = encrypt_settings_secrets({"file_storage": dict(_settings())})
    await db_session.execute(
        text("UPDATE organizations SET settings = :s WHERE id = :id"),
        {"s": json.dumps(stored), "id": org_id},
    )
    await db_session.flush()
    file_storage.forget_org_storage()


async def _rows(db_session, drive, org_id):
    doc_ref = _store(drive, org_id, "documents", b"%PDF-1.4 sop")
    event_ref = _store(drive, org_id, "event-attachments", b"%PDF-1.4 drill")
    document = Document(organization_id=org_id, name="SOP", file_path=doc_ref)
    events = [
        Event(
            organization_id=org_id,
            title="Drill",
            start_datetime=datetime(2026, 10, 8, 18, tzinfo=timezone.utc),
            end_datetime=datetime(2026, 10, 8, 20, tzinfo=timezone.utc),
            # A recurring copy shares the stored file.
            attachments=[{"id": f"a{i}", "file_path": event_ref}],
        )
        for i in range(2)
    ]
    db_session.add_all([document, *events])
    await db_session.flush()
    return document.id, doc_ref, event_ref


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
    return sorted(attachments[0]["file_path"] for attachments in rows)


@pytest.mark.integration
class TestRelinking:
    async def test_a_dry_run_reports_and_changes_nothing(
        self, db_session, setup_org_and_admin, drive
    ):
        org_id, _admin = setup_org_and_admin
        await _use_drive(db_session, org_id)
        document_id, doc_ref, _event_ref = await _rows(db_session, drive, org_id)
        new_doc = _restored(drive, doc_ref)

        report = await drive_restore_relink.apply(db_session, organization_id=org_id)

        assert [(r.old_ref, r.new_ref) for r in report.relinks] == [(doc_ref, new_doc)]
        assert report.present == 1
        assert report.rows_updated == 0
        assert await _document_path(db_session, document_id) == doc_ref

    async def test_apply_repoints_every_row_and_the_file_reads_back(
        self, db_session, setup_org_and_admin, drive
    ):
        org_id, _admin = setup_org_and_admin
        await _use_drive(db_session, org_id)
        document_id, doc_ref, event_ref = await _rows(db_session, drive, org_id)
        new_doc = _restored(drive, doc_ref)
        new_event = _restored(drive, event_ref)

        report = await drive_restore_relink.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        assert report.rows_updated == 3
        assert not report.problems
        assert await _document_path(db_session, document_id) == new_doc
        assert await _event_paths(db_session, org_id) == [new_event, new_event]
        assert await file_storage.read_bytes(new_doc) == b"%PDF-1.4 sop"

    async def test_a_second_run_changes_nothing(
        self, db_session, setup_org_and_admin, drive
    ):
        org_id, _admin = setup_org_and_admin
        await _use_drive(db_session, org_id)
        _document_id, doc_ref, _event_ref = await _rows(db_session, drive, org_id)
        _restored(drive, doc_ref)
        await drive_restore_relink.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        again = await drive_restore_relink.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        assert again.relinks == []
        assert again.present == 2
        assert again.rows_updated == 0

    async def test_no_match_and_two_matches_are_reported_and_left_alone(
        self, db_session, setup_org_and_admin, drive
    ):
        org_id, _admin = setup_org_and_admin
        await _use_drive(db_session, org_id)
        document_id, doc_ref, event_ref = await _rows(db_session, drive, org_id)
        drive.lose(gdrive.parse_ref(doc_ref).file_id)
        location = gdrive.parse_ref(event_ref)
        ciphertext = drive.lose(location.file_id)
        for _ in range(2):
            drive.restore_copy(gdrive.file_name_for(location.key), ciphertext)

        report = await drive_restore_relink.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        assert report.not_found == [doc_ref]
        assert report.ambiguous == [event_ref]
        assert report.problems
        assert report.rows_updated == 0
        assert await _document_path(db_session, document_id) == doc_ref
        assert await _event_paths(db_session, org_id) == [event_ref, event_ref]

    async def test_a_match_that_is_not_one_of_our_files_is_refused(
        self, db_session, setup_org_and_admin, drive
    ):
        org_id, _admin = setup_org_and_admin
        await _use_drive(db_session, org_id)
        document_id, doc_ref, _event_ref = await _rows(db_session, drive, org_id)
        location = gdrive.parse_ref(doc_ref)
        drive.lose(location.file_id)
        # Someone uploaded the decrypted file under the stored name.
        drive.restore_copy(gdrive.file_name_for(location.key), b"%PDF-1.4 sop")
        assert not file_encryption.is_encrypted_bytes(b"%PDF-1.4 sop")

        report = await drive_restore_relink.apply(
            db_session, organization_id=org_id, dry_run=False
        )

        assert report.unreadable == [doc_ref]
        assert await _document_path(db_session, document_id) == doc_ref

    async def test_a_department_without_drive_settings_is_refused_by_name(
        self, db_session, setup_org_and_admin, drive
    ):
        org_id, _admin = setup_org_and_admin
        with pytest.raises(ValueError, match="no usable Google Drive settings"):
            await drive_restore_relink.apply(db_session, organization_id=org_id)
