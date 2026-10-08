"""File-access hardening across the modules that store uploads.

Each section pins one boundary:

* stored paths are confined to the *owning organization's* subtree on read
  and delete — the shared module root is not a boundary, because every
  organization's files live beneath it;
* event attachments need ``events.view`` and hide drafts from non-organizers;
* equipment-check photos can only be added by the member who did the check
  (or ``inventory.check_manage``);
* a stored extension and served Content-Type come from the file's detected
  contents, never the uploader's claim;
* download filenames are cleaned before they reach ``Content-Disposition``;
* email-template attachments live on the persisted uploads volume.
"""

import importlib.util
import io
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.datastructures import Headers, UploadFile

from app.api.v1.endpoints import email_templates as email_templates_endpoint
from app.api.v1.endpoints import equipment_check as equipment_check_endpoint
from app.api.v1.endpoints import events as events_endpoint
from app.api.v1.endpoints import membership_pipeline as pipeline_endpoint
from app.api.v1.endpoints import training_enhancements, training_submissions
from app.services import membership_pipeline_service
from app.services.documents_service import DocumentsService
from app.utils import email_attachments
from app.utils.mime_validation import extension_matches_mime
from app.utils.upload_paths import (
    resolve_in_any_org_root,
    resolve_in_org,
    safe_download_filename,
)

pytestmark = pytest.mark.unit

ORG = str(uuid4())
OTHER_ORG = str(uuid4())
PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def _user(*permissions, user_id=None, org=ORG):
    return SimpleNamespace(
        id=user_id or str(uuid4()),
        organization_id=org,
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _upload(content: bytes, filename: str, content_type: str) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


def _db_returning(*values):
    """A db whose successive execute() calls resolve to *values*."""
    results = []
    for value in values:
        result = MagicMock()
        result.scalar_one_or_none = MagicMock(return_value=value)
        result.scalars = MagicMock(
            return_value=MagicMock(first=MagicMock(return_value=value))
        )
        results.append(result)
    db = MagicMock()
    db.execute = AsyncMock(side_effect=results)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    db.add = MagicMock()
    return db


def _write(path: Path, data: bytes = b"x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


# ---------------------------------------------------------------------------
# The shared containment helper
# ---------------------------------------------------------------------------


class TestResolveInOrg:
    def test_the_orgs_own_file_resolves(self, tmp_path):
        own = _write(tmp_path / ORG / "a.pdf")
        assert resolve_in_org(str(own), str(tmp_path), ORG) == os.path.realpath(own)

    def test_another_orgs_file_under_the_same_root_is_refused(self, tmp_path):
        theirs = _write(tmp_path / OTHER_ORG / "a.pdf")
        assert resolve_in_org(str(theirs), str(tmp_path), ORG) is None

    def test_traversal_out_of_the_org_subtree_is_refused(self, tmp_path):
        _write(tmp_path / OTHER_ORG / "a.pdf")
        escaped = os.path.join(str(tmp_path), ORG, "..", OTHER_ORG, "a.pdf")
        assert resolve_in_org(escaped, str(tmp_path), ORG) is None

    def test_a_symlink_out_of_the_subtree_is_refused(self, tmp_path):
        theirs = _write(tmp_path / OTHER_ORG / "a.pdf")
        link = tmp_path / ORG / "link.pdf"
        link.parent.mkdir(parents=True)
        link.symlink_to(theirs)
        assert resolve_in_org(str(link), str(tmp_path), ORG) is None

    def test_the_org_directory_itself_is_not_a_file(self, tmp_path):
        assert resolve_in_org(str(tmp_path / ORG), str(tmp_path), ORG) is None

    @pytest.mark.parametrize("org", [None, "", "  ", "..", ".", "a/b"])
    def test_it_fails_closed_without_a_usable_org(self, tmp_path, org):
        own = _write(tmp_path / "x" / "a.pdf")
        assert resolve_in_org(str(own), str(tmp_path), org) is None

    @pytest.mark.parametrize("bad", [None, "", 1, ["/tmp/x"], {"p": 1}])
    def test_a_non_string_path_is_refused_not_raised(self, tmp_path, bad):
        assert resolve_in_org(bad, str(tmp_path), ORG) is None

    def test_any_of_several_roots(self, tmp_path):
        own = _write(tmp_path / "second" / ORG / "a.pdf")
        roots = (str(tmp_path / "first"), str(tmp_path / "second"))
        assert resolve_in_any_org_root(str(own), roots, ORG) == os.path.realpath(own)
        assert resolve_in_any_org_root(str(own), roots, OTHER_ORG) is None


class TestSafeDownloadFilename:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("report.pdf", "report.pdf"),
            ("../../etc/passwd", "passwd"),
            ("C:\\Users\\chief\\cert.pdf", "cert.pdf"),
            ("bad\r\nSet-Cookie: x.pdf", "badSet-Cookie: x.pdf"),
            ("nul\x00l.pdf", "null.pdf"),
            ("Pump Test – Engine 1.pdf", "Pump Test – Engine 1.pdf"),
        ],
    )
    def test_cleans_the_name(self, raw, expected):
        assert safe_download_filename(raw) == expected

    @pytest.mark.parametrize("raw", [None, "", "   ", "..", "/", 5])
    def test_falls_back_when_nothing_usable_remains(self, raw):
        assert safe_download_filename(raw, "fallback.bin") == "fallback.bin"

    def test_a_long_name_keeps_its_extension(self):
        cleaned = safe_download_filename("a" * 500 + ".pdf")
        assert len(cleaned) == 200
        assert cleaned.endswith(".pdf")


class TestExtensionMatchesMime:
    @pytest.mark.parametrize(
        ("ext", "mime"),
        [
            (".pdf", "application/pdf"),
            (".JPG", "image/jpeg"),
            (".csv", "text/plain"),
            (".xls", "application/msword"),
            (".docx", "application/zip"),
        ],
    )
    def test_consistent_pairs(self, ext, mime):
        assert extension_matches_mime(ext, mime)

    @pytest.mark.parametrize(
        ("ext", "mime"),
        [
            (".png", "application/pdf"),
            (".docx", "image/png"),
            (".pdf", "text/plain"),
            (".pdf", "application/x-unknown"),
        ],
    )
    def test_disguised_pairs(self, ext, mime):
        assert not extension_matches_mime(ext, mime)


# ---------------------------------------------------------------------------
# Event attachments
# ---------------------------------------------------------------------------


def _event(**overrides):
    base = dict(id=str(uuid4()), organization_id=ORG, is_draft=False, attachments=[])
    base.update(overrides)
    return SimpleNamespace(**base)


class TestEventAttachmentReads:
    def test_list_and_download_require_events_view(self):
        """Being signed in is no longer enough to read an event's files."""
        from fastapi.routing import APIRoute

        guarded = {
            route.name: route
            for route in events_endpoint.router.routes
            if isinstance(route, APIRoute)
            and route.name in {"list_event_attachments", "download_event_attachment"}
        }
        assert set(guarded) == {"list_event_attachments", "download_event_attachment"}
        for route in guarded.values():
            checker = route.dependant.dependencies[-1].call
            assert sorted(checker.required_permissions) == [
                "events.manage",
                "events.view",
            ], route.name

    async def test_a_drafts_attachments_are_hidden_from_members(self):
        db = _db_returning(_event(is_draft=True))
        with pytest.raises(HTTPException) as refused:
            await events_endpoint._load_event_for_attachment_read(
                db, uuid4(), _user("events.view")
            )
        assert refused.value.status_code == 404

    async def test_an_organizer_can_read_a_drafts_attachments(self):
        draft = _event(is_draft=True)
        db = _db_returning(draft)
        loaded = await events_endpoint._load_event_for_attachment_read(
            db, uuid4(), _user("events.manage")
        )
        assert loaded is draft

    async def test_a_stored_type_outside_the_allowlist_is_served_opaque(
        self, tmp_path, monkeypatch
    ):
        """The attachments column is writable through generic event updates,
        so a stored ``text/html`` must not become the response's type."""
        monkeypatch.setattr(
            "app.utils.event_attachments.ATTACHMENT_UPLOAD_DIR", str(tmp_path)
        )
        stored = _write(tmp_path / ORG / "evt" / "a.pdf", PDF_BYTES)
        event = _event(
            attachments=[
                {
                    "id": "att-1",
                    "file_name": "../agenda.pdf",
                    "file_path": str(stored),
                    "file_type": "text/html",
                }
            ]
        )
        response = await events_endpoint.download_event_attachment(
            uuid4(), "att-1", _db_returning(event), _user("events.view")
        )
        assert isinstance(response, FileResponse)
        assert response.media_type == "application/octet-stream"
        assert 'filename="agenda.pdf"' in response.headers["content-disposition"]


class TestEventAttachmentUpload:
    async def _upload(self, tmp_path, monkeypatch, upload):
        monkeypatch.setattr(events_endpoint, "ATTACHMENT_UPLOAD_DIR", str(tmp_path))
        event = _event()
        response = await events_endpoint.upload_event_attachment(
            uuid4(), upload, None, _db_returning(event), _user("events.manage")
        )
        return event, response

    async def test_the_detected_type_is_stored_not_the_claimed_one(
        self, tmp_path, monkeypatch
    ):
        event, _ = await self._upload(
            tmp_path,
            monkeypatch,
            _upload(PDF_BYTES, "agenda.pdf", "text/html"),
        )
        assert event.attachments[0]["file_type"] == "application/pdf"

    async def test_an_extension_that_disagrees_with_the_content_is_refused(
        self, tmp_path, monkeypatch
    ):
        with pytest.raises(HTTPException) as refused:
            await self._upload(
                tmp_path, monkeypatch, _upload(PDF_BYTES, "photo.png", "image/png")
            )
        assert refused.value.status_code == 400
        assert list(tmp_path.rglob("*.*")) == []


# ---------------------------------------------------------------------------
# Equipment-check photos
# ---------------------------------------------------------------------------


class TestEquipmentCheckPhotos:
    async def _call(self, user, checked_by):
        db = _db_returning(SimpleNamespace(photo_urls=[]), checked_by)
        # An invalid image: reaching validation proves authorization passed.
        files = [_upload(b"not an image", "x.jpg", "image/jpeg")]
        return await equipment_check_endpoint.upload_check_item_photos(
            "check-1", "item-1", files, db, user
        )

    async def test_another_member_cannot_add_photos_to_your_check(self):
        intruder = _user("inventory.check_submit")
        with pytest.raises(HTTPException) as refused:
            await self._call(intruder, checked_by=str(uuid4()))
        assert refused.value.status_code == 403

    async def test_the_member_who_did_the_check_can(self):
        checker = _user("inventory.check_submit")
        with pytest.raises(HTTPException) as reached:
            await self._call(checker, checked_by=checker.id)
        assert reached.value.status_code == 400

    async def test_a_check_manager_can_add_to_any_check(self):
        manager = _user("inventory.check_manage")
        with pytest.raises(HTTPException) as reached:
            await self._call(manager, checked_by=str(uuid4()))
        assert reached.value.status_code == 400

    def test_the_route_requires_a_check_permission(self):
        from fastapi.routing import APIRoute

        route = next(
            r
            for r in equipment_check_endpoint.router.routes
            if isinstance(r, APIRoute) and r.name == "upload_check_item_photos"
        )
        checker = route.dependant.dependencies[-1].call
        assert sorted(checker.required_permissions) == [
            "inventory.check_manage",
            "inventory.check_submit",
        ]


# ---------------------------------------------------------------------------
# Training record attachments
# ---------------------------------------------------------------------------


class TestTrainingRecordDownload:
    @pytest.fixture
    def roots(self, tmp_path, monkeypatch):
        records = tmp_path / "training_attachments"
        submissions = records / "self_reported_submissions"
        monkeypatch.setattr(
            training_enhancements, "TRAINING_ATTACHMENT_DIR", str(records)
        )
        monkeypatch.setattr(
            training_submissions, "SUBMISSION_ATTACHMENT_DIR", str(submissions)
        )
        return records, submissions

    async def _download(self, path):
        owner = _user()
        record = SimpleNamespace(
            id="rec-1",
            user_id=owner.id,
            organization_id=ORG,
            attachments=[
                {"file_path": str(path), "file_name": "cert.pdf", "file_type": "x"}
            ],
        )
        return await training_enhancements.download_record_attachment(
            "rec-1", 0, _db_returning(record), owner
        )

    async def test_another_orgs_file_under_the_shared_root_is_refused(self, roots):
        records, _ = roots
        theirs = _write(records / OTHER_ORG / "cert.pdf")
        with pytest.raises(HTTPException) as refused:
            await self._download(theirs)
        assert refused.value.status_code == 404

    async def test_the_orgs_own_record_file_is_served(self, roots):
        records, _ = roots
        own = _write(records / ORG / "cert.pdf")
        assert isinstance(await self._download(own), FileResponse)

    async def test_an_approved_self_report_certificate_is_served(self, roots):
        """Approval copies the submission's attachment dicts onto the record,
        so the record download must accept the org's submission subtree."""
        _, submissions = roots
        approved = _write(submissions / ORG / "cert.pdf")
        assert isinstance(await self._download(approved), FileResponse)


# ---------------------------------------------------------------------------
# Prospect documents
# ---------------------------------------------------------------------------


class TestProspectDocuments:
    async def test_download_refuses_another_orgs_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            membership_pipeline_service, "PROSPECT_DOCUMENT_DIR", str(tmp_path)
        )
        theirs = _write(tmp_path / OTHER_ORG / "p" / "licence.jpg")
        doc = SimpleNamespace(
            id=str(uuid4()), file_path=str(theirs), file_name="x", mime_type=None
        )
        service = SimpleNamespace(get_prospect_documents=AsyncMock(return_value=[doc]))
        monkeypatch.setattr(
            pipeline_endpoint, "MembershipPipelineService", lambda db: service
        )
        with pytest.raises(HTTPException) as refused:
            await pipeline_endpoint.download_prospect_document(
                uuid4(), doc.id, MagicMock(), _user("prospective_members.view")
            )
        assert refused.value.status_code == 403

    async def test_storing_a_path_in_another_orgs_subtree_is_refused(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.setattr(
            membership_pipeline_service, "PROSPECT_DOCUMENT_DIR", str(tmp_path)
        )
        svc = membership_pipeline_service.MembershipPipelineService(AsyncMock())
        monkeypatch.setattr(
            svc,
            "get_prospect",
            AsyncMock(return_value=SimpleNamespace(pipeline=None)),
        )
        with pytest.raises(ValueError, match="this organization"):
            await svc.add_prospect_document(
                prospect_id="p1",
                organization_id=ORG,
                document_type="id",
                file_name="licence.jpg",
                file_path=str(tmp_path / OTHER_ORG / "p1" / "licence.jpg"),
            )


# ---------------------------------------------------------------------------
# Documents: deleting never unlinks outside the org
# ---------------------------------------------------------------------------


class TestDocumentDeleteConfinement:
    async def _delete(self, tmp_path, monkeypatch, stored):
        monkeypatch.setattr(DocumentsService, "UPLOAD_DIR", str(tmp_path))
        svc = DocumentsService(_db_returning())
        document = SimpleNamespace(file_path=str(stored))
        monkeypatch.setattr(svc, "get_document_by_id", AsyncMock(return_value=document))
        monkeypatch.setattr(
            svc, "_delete_facility_document_references", AsyncMock(return_value=None)
        )
        assert await svc.delete_document(uuid4(), ORG) is True

    async def test_the_orgs_own_file_is_removed(self, tmp_path, monkeypatch):
        own = _write(tmp_path / ORG / "a.pdf")
        await self._delete(tmp_path, monkeypatch, own)
        assert not own.exists()

    async def test_a_tampered_path_to_another_org_is_left_alone(
        self, tmp_path, monkeypatch
    ):
        theirs = _write(tmp_path / OTHER_ORG / "a.pdf")
        await self._delete(tmp_path, monkeypatch, theirs)
        assert theirs.exists()


# ---------------------------------------------------------------------------
# Email-template attachments
# ---------------------------------------------------------------------------


class TestEmailAttachments:
    @pytest.fixture
    def roots(self, tmp_path, monkeypatch):
        new_root = tmp_path / "uploads" / "email-attachments"
        legacy_root = tmp_path / "app" / "storage" / "email_attachments"
        monkeypatch.setattr(email_attachments, "EMAIL_ATTACHMENT_DIR", str(new_root))
        monkeypatch.setattr(
            email_attachments, "LEGACY_EMAIL_ATTACHMENT_DIR", str(legacy_root)
        )
        monkeypatch.setattr(email_attachments, "APP_ROOT", str(tmp_path / "app"))
        return new_root, legacy_root

    def test_paths_in_either_root_resolve_within_the_org(self, roots):
        new_root, legacy_root = roots
        current = _write(new_root / ORG / "a.pdf")
        legacy = _write(legacy_root / ORG / "b.pdf")
        theirs = _write(new_root / OTHER_ORG / "c.pdf")
        rows = [
            SimpleNamespace(id="1", storage_path=str(current)),
            SimpleNamespace(
                id="2",
                storage_path=os.path.join("storage", "email_attachments", ORG, "b.pdf"),
            ),
            SimpleNamespace(id="3", storage_path=str(theirs)),
            SimpleNamespace(id="4", storage_path="/etc/passwd"),
        ]
        assert email_attachments.confined_template_attachment_paths(rows, ORG) == [
            os.path.realpath(current),
            os.path.realpath(legacy),
        ]

    async def test_upload_lands_on_the_uploads_volume_with_the_detected_type(
        self, roots
    ):
        new_root, _ = roots
        template = SimpleNamespace(allow_attachments=True)
        db = _db_returning(template)
        await email_templates_endpoint.upload_attachment(
            "tpl-1",
            _upload(PDF_BYTES, "Welcome Packet.pdf", "text/html"),
            db,
            _user("settings.manage"),
        )
        attachment = db.add.call_args.args[0]
        assert attachment.content_type == "application/pdf"
        assert attachment.filename == "Welcome Packet.pdf"
        assert Path(attachment.storage_path).parent == new_root / ORG
        assert Path(attachment.storage_path).read_bytes() == PDF_BYTES

    async def test_upload_refuses_an_extension_that_disagrees(self, roots):
        new_root, _ = roots
        db = _db_returning(SimpleNamespace(allow_attachments=True))
        with pytest.raises(HTTPException) as refused:
            await email_templates_endpoint.upload_attachment(
                "tpl-1",
                _upload(PDF_BYTES, "logo.png", "image/png"),
                db,
                _user("settings.manage"),
            )
        assert refused.value.status_code == 400
        assert not new_root.exists()

    async def test_delete_never_unlinks_another_orgs_file(self, roots):
        new_root, _ = roots
        theirs = _write(new_root / OTHER_ORG / "a.pdf")
        attachment = SimpleNamespace(
            id="att-1", template_id="tpl-1", filename="a.pdf", storage_path=str(theirs)
        )
        db = _db_returning(attachment)
        await email_templates_endpoint.delete_attachment(
            "tpl-1", "att-1", db=db, current_user=_user("settings.manage")
        )
        assert theirs.exists()
        db.delete.assert_awaited()


# ---------------------------------------------------------------------------
# The email-attachment relocation migration
# ---------------------------------------------------------------------------


def _migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    (path,) = versions.glob("*_2be075025403_*.py")
    spec = importlib.util.spec_from_file_location("relocate_email_attachments", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestRelocationMigration:
    @pytest.fixture
    def layout(self, tmp_path):
        app_root = tmp_path / "app"
        new_root = tmp_path / "uploads" / "email-attachments"
        return _migration(), str(app_root), str(new_root)

    def test_a_legacy_file_is_moved_and_its_row_rewritten(self, layout):
        migration, app_root, new_root = layout
        relative = os.path.join("storage", "email_attachments", ORG, "a.pdf")
        _write(Path(app_root) / relative, PDF_BYTES)

        updates = migration.relocate([("att-1", relative, ORG)], new_root, app_root)

        moved = os.path.join(new_root, ORG, "a.pdf")
        assert updates == [("att-1", moved)]
        assert Path(moved).read_bytes() == PDF_BYTES
        assert not (Path(app_root) / relative).exists()

    def test_a_rerun_after_an_interrupted_move_completes(self, layout):
        migration, app_root, new_root = layout
        relative = os.path.join("storage", "email_attachments", ORG, "a.pdf")
        _write(Path(app_root) / relative, PDF_BYTES)
        _write(Path(new_root) / ORG / "a.pdf", PDF_BYTES)

        updates = migration.relocate([("att-1", relative, ORG)], new_root, app_root)

        assert updates == [("att-1", os.path.join(new_root, ORG, "a.pdf"))]
        assert not (Path(app_root) / relative).exists()

    def test_a_lost_file_leaves_its_row_alone(self, layout):
        migration, app_root, new_root = layout
        relative = os.path.join("storage", "email_attachments", ORG, "gone.pdf")
        assert migration.relocate([("att-1", relative, ORG)], new_root, app_root) == []

    def test_a_conflicting_destination_is_not_overwritten(self, layout):
        migration, app_root, new_root = layout
        relative = os.path.join("storage", "email_attachments", ORG, "a.pdf")
        _write(Path(app_root) / relative, PDF_BYTES)
        _write(Path(new_root) / ORG / "a.pdf", b"different")

        assert migration.relocate([("att-1", relative, ORG)], new_root, app_root) == []
        assert (Path(app_root) / relative).exists()

    def test_a_path_outside_the_rows_org_is_not_touched(self, layout):
        migration, app_root, new_root = layout
        relative = os.path.join("storage", "email_attachments", OTHER_ORG, "a.pdf")
        _write(Path(app_root) / relative, PDF_BYTES)

        assert migration.relocate([("att-1", relative, ORG)], new_root, app_root) == []
        assert (Path(app_root) / relative).exists()

    def test_restore_reverses_relocate(self, layout):
        migration, app_root, new_root = layout
        relative = os.path.join("storage", "email_attachments", ORG, "a.pdf")
        _write(Path(app_root) / relative, PDF_BYTES)
        ((_, moved),) = migration.relocate(
            [("att-1", relative, ORG)], new_root, app_root
        )

        assert migration.restore([("att-1", moved, ORG)], new_root, app_root) == [
            ("att-1", relative)
        ]
        assert (Path(app_root) / relative).read_bytes() == PDF_BYTES
        assert not Path(moved).exists()
