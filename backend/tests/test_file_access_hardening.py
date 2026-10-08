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
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.datastructures import Headers, UploadFile

from app.api.v1.endpoints import email_templates as email_templates_endpoint
from app.api.v1.endpoints import equipment_check as equipment_check_endpoint
from app.api.v1.endpoints import events as events_endpoint
from app.api.v1.endpoints import membership_pipeline as pipeline_endpoint
from app.api.v1.endpoints import training_enhancements
from app.services import file_storage_service, membership_pipeline_service
from app.services.documents_service import DocumentsService
from app.utils import email_attachments
from app.utils.mime_validation import extension_matches_mime
from app.utils.upload_paths import (
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


def _result(value):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    result.first = MagicMock(return_value=value)
    result.scalars = MagicMock(
        return_value=MagicMock(first=MagicMock(return_value=value))
    )
    return result


def _db_returning(*values):
    """A db whose successive execute() calls resolve to *values*, then to
    empty results (the organization and member lookups a download makes to
    name its file find nothing, so defaults apply)."""
    queue = [_result(value) for value in values]

    async def _execute(*_args, **_kwargs):
        return queue.pop(0) if queue else _result(None)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=_execute)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    """Point FileStorageService at *tmp_path*; files live at
    ``<tmp_path>/<org>/<area>/...``."""
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


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
    base = dict(
        id=str(uuid4()),
        organization_id=ORG,
        is_draft=False,
        attachments=[],
        title="Pump Ops Drill",
        # 9:30 pm in New York (the default zone when no organization is
        # found) — already the next day in UTC.
        start_datetime=datetime(2026, 10, 9, 1, 30, tzinfo=timezone.utc),
    )
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

    async def test_a_stored_type_outside_the_allowlist_is_served_opaque(self, uploads):
        """The attachments column is writable through generic event updates,
        so a stored ``text/html`` must not become the response's type."""
        stored = _write(
            uploads / ORG / "event-attachments" / "evt" / "a.pdf", PDF_BYTES
        )
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
        # Named from the event, dated in the department's timezone, the
        # uploader's directory components gone.
        assert (
            'filename="2026-10-08_Pump-Ops-Drill_agenda.pdf"'
            in response.headers["content-disposition"]
        )

    async def test_another_orgs_file_in_the_current_layout_is_refused(self, uploads):
        """Every organization's attachments share one uploads root, so the
        check must be per organization, not per root."""
        theirs = _write(
            uploads / OTHER_ORG / "event-attachments" / "evt" / "a.pdf", PDF_BYTES
        )
        event = _event(
            attachments=[
                {"id": "att-1", "file_name": "a.pdf", "file_path": str(theirs)}
            ]
        )
        with pytest.raises(HTTPException) as refused:
            await events_endpoint.download_event_attachment(
                uuid4(), "att-1", _db_returning(event), _user("events.view")
            )
        assert refused.value.status_code == 403


class TestEventAttachmentUpload:
    async def _upload(self, uploads, upload):
        event = _event()
        response = await events_endpoint.upload_event_attachment(
            UUID(event.id), upload, None, _db_returning(event), _user("events.manage")
        )
        return event, response

    async def test_the_detected_type_is_stored_not_the_claimed_one(self, uploads):
        event, _ = await self._upload(
            uploads, _upload(PDF_BYTES, "agenda.pdf", "text/html")
        )
        stored = event.attachments[0]
        assert stored["file_type"] == "application/pdf"
        assert Path(stored["file_path"]).parent == (
            uploads / ORG / "event-attachments" / event.id
        )

    async def test_an_extension_that_disagrees_with_the_content_is_refused(
        self, uploads
    ):
        with pytest.raises(HTTPException) as refused:
            await self._upload(uploads, _upload(PDF_BYTES, "photo.png", "image/png"))
        assert refused.value.status_code == 400
        assert list(uploads.rglob("*.*")) == []


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
    def roots(self, uploads):
        """The org's training-records and self-reports areas."""
        return (
            uploads / ORG / "training-records" / "rec-1",
            uploads / ORG / "self-reports" / "sub-1",
        )

    async def _download(self, path):
        owner = _user()
        record = SimpleNamespace(
            id="rec-1",
            user_id=owner.id,
            organization_id=ORG,
            completion_date=date(2026, 10, 8),
            course_name="EMT Recertification",
            attachments=[
                {"file_path": str(path), "file_name": "cert.pdf", "file_type": "x"}
            ],
        )
        return await training_enhancements.download_record_attachment(
            "rec-1", 0, _db_returning(record), owner
        )

    @pytest.mark.parametrize(
        "relative",
        [
            (OTHER_ORG, "training-records", "rec-1", "cert.pdf"),
            (OTHER_ORG, "self-reports", "sub-1", "cert.pdf"),
            ("training_attachments", OTHER_ORG, "cert.pdf"),
        ],
    )
    async def test_another_orgs_file_under_the_shared_root_is_refused(
        self, uploads, relative
    ):
        theirs = _write(uploads.joinpath(*relative))
        with pytest.raises(HTTPException) as refused:
            await self._download(theirs)
        assert refused.value.status_code == 404

    async def test_the_orgs_own_record_file_is_served(self, roots):
        records, _ = roots
        own = _write(records / "cert.pdf")
        assert isinstance(await self._download(own), FileResponse)

    async def test_the_download_is_named_for_the_member_and_course(self, roots):
        """Owner decision: a downloaded certificate names its member, last
        name first, so a Downloads folder sorts by member and date."""
        records, _ = roots
        own = _write(records / "cert.pdf")
        owner = _user()
        record = SimpleNamespace(
            id="rec-1",
            user_id=owner.id,
            organization_id=ORG,
            completion_date=date(2026, 10, 8),
            course_name="EMT Recertification",
            attachments=[{"file_path": str(own), "file_name": "IMG_2291.pdf"}],
        )
        member = SimpleNamespace(first_name="John", last_name="Smith")
        response = await training_enhancements.download_record_attachment(
            "rec-1", 0, _db_returning(record, member), owner
        )
        assert (
            'filename="2026-10-08_Smith-John_EMT-Recertification.pdf"'
            in response.headers["content-disposition"]
        )

    async def test_an_approved_self_report_certificate_is_served(self, roots):
        """Approval copies the submission's attachment dicts onto the record,
        so the record download must accept the org's self-reports area."""
        _, submissions = roots
        approved = _write(submissions / "cert.pdf")
        assert isinstance(await self._download(approved), FileResponse)

    @pytest.mark.parametrize(
        "relative",
        [
            ("training_attachments", ORG, "cert.pdf"),
            ("training_attachments", "self_reported_submissions", ORG, "cert.pdf"),
        ],
    )
    async def test_a_file_in_the_orgs_legacy_tree_is_served(self, uploads, relative):
        """Files written before the org-first layout stay downloadable until
        scripts/relocate_uploads.py has moved them."""
        legacy = _write(uploads.joinpath(*relative))
        assert isinstance(await self._download(legacy), FileResponse)


# ---------------------------------------------------------------------------
# Prospect documents
# ---------------------------------------------------------------------------


class TestProspectDocuments:
    async def test_download_refuses_another_orgs_file(self, uploads, monkeypatch):
        theirs = _write(uploads / OTHER_ORG / "applicants" / "p" / "licence.jpg")
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
        self, uploads, monkeypatch
    ):
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
                file_path=str(
                    uploads / OTHER_ORG / "applicants" / "p1" / "licence.jpg"
                ),
            )


# ---------------------------------------------------------------------------
# Documents: deleting never unlinks outside the org
# ---------------------------------------------------------------------------


class TestDocumentDeleteConfinement:
    async def _delete(self, monkeypatch, stored):
        svc = DocumentsService(_db_returning())
        document = SimpleNamespace(file_path=str(stored))
        monkeypatch.setattr(svc, "get_document_by_id", AsyncMock(return_value=document))
        monkeypatch.setattr(
            svc, "_delete_facility_document_references", AsyncMock(return_value=None)
        )
        assert await svc.delete_document(uuid4(), ORG) is True

    async def test_the_orgs_own_file_is_removed(self, uploads, monkeypatch):
        own = _write(uploads / ORG / "documents" / "a.pdf")
        await self._delete(monkeypatch, own)
        assert not own.exists()

    async def test_a_tampered_path_to_another_org_is_left_alone(
        self, uploads, monkeypatch
    ):
        theirs = _write(uploads / OTHER_ORG / "documents" / "a.pdf")
        await self._delete(monkeypatch, theirs)
        assert theirs.exists()


# ---------------------------------------------------------------------------
# Email-template attachments
# ---------------------------------------------------------------------------


class TestEmailAttachments:
    @pytest.fixture
    def roots(self, tmp_path, monkeypatch):
        """``(uploads root, the off-volume legacy root)``."""
        uploads = tmp_path / "uploads"
        app_root = tmp_path / "app"
        legacy_root = app_root / "storage" / "email_attachments"
        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
        monkeypatch.setattr(file_storage_service, "APP_ROOT", str(app_root))
        monkeypatch.setattr(
            file_storage_service, "LEGACY_EMAIL_ATTACHMENT_DIR", str(legacy_root)
        )
        return uploads, legacy_root

    def test_paths_in_every_root_resolve_within_the_org(self, roots):
        uploads, legacy_root = roots
        current = _write(uploads / ORG / "email-attachments" / "tpl" / "a.pdf")
        on_volume = _write(uploads / "email-attachments" / ORG / "v.pdf")
        legacy = _write(legacy_root / ORG / "b.pdf")
        theirs = _write(uploads / OTHER_ORG / "email-attachments" / "tpl" / "c.pdf")
        theirs_legacy = _write(uploads / "email-attachments" / OTHER_ORG / "d.pdf")
        rows = [
            SimpleNamespace(id="1", filename="A.pdf", storage_path=str(current)),
            SimpleNamespace(id="2", filename="V.pdf", storage_path=str(on_volume)),
            SimpleNamespace(
                id="3",
                filename="B.pdf",
                storage_path=os.path.join("storage", "email_attachments", ORG, "b.pdf"),
            ),
            SimpleNamespace(id="4", filename="C.pdf", storage_path=str(theirs)),
            SimpleNamespace(id="5", filename="D.pdf", storage_path=str(theirs_legacy)),
            SimpleNamespace(id="6", filename="E.pdf", storage_path="/etc/passwd"),
        ]
        assert email_attachments.confined_template_attachments(rows, ORG) == [
            (os.path.realpath(current), "A.pdf"),
            (os.path.realpath(on_volume), "V.pdf"),
            (os.path.realpath(legacy), "B.pdf"),
        ]

    async def test_upload_lands_on_the_uploads_volume_with_the_detected_type(
        self, roots
    ):
        uploads, _ = roots
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
        assert Path(attachment.storage_path).parent == (
            uploads / ORG / "email-attachments" / "tpl-1"
        )
        assert Path(attachment.storage_path).name != "Welcome Packet.pdf"
        assert Path(attachment.storage_path).read_bytes() == PDF_BYTES

    async def test_upload_refuses_an_extension_that_disagrees(self, roots):
        uploads, _ = roots
        db = _db_returning(SimpleNamespace(allow_attachments=True))
        with pytest.raises(HTTPException) as refused:
            await email_templates_endpoint.upload_attachment(
                "tpl-1",
                _upload(PDF_BYTES, "logo.png", "image/png"),
                db,
                _user("settings.manage"),
            )
        assert refused.value.status_code == 400
        assert not (uploads / ORG).exists()

    async def test_delete_never_unlinks_another_orgs_file(self, roots):
        uploads, _ = roots
        theirs = _write(uploads / OTHER_ORG / "email-attachments" / "tpl-1" / "a.pdf")
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
