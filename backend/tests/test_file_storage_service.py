"""FileStorageService, upload scanning, download names and system notices.

The per-module behaviour (who may read what, where each upload lands) is in
test_file_access_hardening.py; this file pins the shared pieces they all use.
"""

import os
import stat
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core import file_encryption
from app.core.error_codes import ErrorCode
from app.services import file_storage_service as file_storage
from app.services import upload_scanning
from app.services.file_storage_service import (
    FileRules,
    FileStorageService,
    StorageArea,
)
from app.services.malware_scan_service import MalwareScanUnavailable, ScanResult
from app.utils.download_names import (
    descriptive_filename,
    member_name_part,
    without_extension,
)

pytestmark = pytest.mark.unit

ORG = str(uuid4())
OTHER_ORG = str(uuid4())
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
PDF_RULES = FileRules(
    allowed_types={"application/pdf": ".pdf"},
    max_bytes=1024,
    description="PDF",
)


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


def _user():
    return SimpleNamespace(id=str(uuid4()), username="chief")


def _scanner(monkeypatch, *, enabled=True, result=None, error=None):
    monkeypatch.setattr(upload_scanning, "is_malware_scan_enabled", lambda: enabled)
    scan = AsyncMock(side_effect=error, return_value=result or ScanResult(False))
    monkeypatch.setattr(upload_scanning, "scan_bytes", scan)
    return scan


# ---------------------------------------------------------------------------
# Storing
# ---------------------------------------------------------------------------


class TestStore:
    async def test_lands_org_first_with_a_uuid_name_and_tight_modes(self, root):
        stored = await FileStorageService(None).store_bytes(
            PDF,
            original_name="C:\\scans\\Pump Test.pdf",
            organization_id=ORG,
            area=StorageArea.DOCUMENTS,
            record_id="rec-1",
            rules=PDF_RULES,
            user=_user(),
        )
        directory = root / ORG / "documents" / "rec-1"
        assert os.path.dirname(stored.path) == str(directory)
        name = os.path.basename(stored.path)
        assert name.endswith(".pdf")
        assert len(name) == 32 + 4
        assert stored.original_name == "Pump Test.pdf"
        assert stored.mime_type == "application/pdf"
        # Encrypted at rest; the plaintext comes back intact.
        assert PDF not in open(stored.path, "rb").read()
        assert file_encryption.read_plaintext(stored.path) == PDF
        assert stat.S_IMODE(os.stat(stored.path).st_mode) == 0o640
        # No partial file is left behind by the write-then-rename.
        assert os.listdir(directory) == [name]

    async def test_the_extension_comes_from_the_content_not_the_name(self, root):
        stored = await FileStorageService(None).store_bytes(
            PDF,
            original_name="report.pdf.exe",
            organization_id=ORG,
            area=StorageArea.DOCUMENTS,
            rules=PDF_RULES,
            user=_user(),
        )
        assert stored.path.endswith(".pdf")

    @pytest.mark.parametrize(
        ("content", "code"),
        [
            (b"", ErrorCode.UPLD_TYPE_NOT_ALLOWED),
            (b"MZ\x90\x00 not a pdf", ErrorCode.UPLD_TYPE_NOT_ALLOWED),
            (PDF + b"x" * 2048, ErrorCode.UPLD_TOO_LARGE),
        ],
    )
    async def test_refused_files_are_never_written(self, root, content, code):
        with pytest.raises(HTTPException) as refused:
            await FileStorageService(None).store_bytes(
                content,
                original_name="x.pdf",
                organization_id=ORG,
                area=StorageArea.DOCUMENTS,
                rules=PDF_RULES,
                user=_user(),
            )
        assert refused.value.error_code == code
        assert list(root.rglob("*")) == []

    async def test_an_infected_file_is_audited_and_never_written(
        self, root, monkeypatch
    ):
        _scanner(monkeypatch, result=ScanResult(True, "Eicar-Signature"))
        audit = AsyncMock()
        monkeypatch.setattr(upload_scanning, "log_audit_event", audit)
        db = SimpleNamespace(commit=AsyncMock())
        with pytest.raises(HTTPException) as refused:
            await FileStorageService(db).store_bytes(
                PDF,
                original_name="x.pdf",
                organization_id=ORG,
                area=StorageArea.EVENT_ATTACHMENTS,
                rules=PDF_RULES,
                user=_user(),
            )
        assert refused.value.error_code == ErrorCode.UPLD_MALWARE_DETECTED
        assert audit.await_args.kwargs["event_data"]["upload"] == "event-attachments"
        db.commit.assert_awaited()
        assert list(root.rglob("*")) == []

    async def test_an_unreachable_scanner_refuses_rather_than_stores(
        self, root, monkeypatch
    ):
        _scanner(monkeypatch, error=MalwareScanUnavailable("down"))
        with pytest.raises(HTTPException) as refused:
            await FileStorageService(None).store_bytes(
                PDF,
                original_name="x.pdf",
                organization_id=ORG,
                area=StorageArea.DOCUMENTS,
                rules=PDF_RULES,
                user=_user(),
            )
        assert refused.value.status_code == 503
        assert refused.value.headers == {"Retry-After": "60"}
        assert list(root.rglob("*")) == []

    async def test_with_scanning_off_the_scanner_is_never_contacted(
        self, root, monkeypatch
    ):
        scan = _scanner(monkeypatch, enabled=False)
        await FileStorageService(None).store_bytes(
            PDF,
            original_name="x.pdf",
            organization_id=ORG,
            area=StorageArea.DOCUMENTS,
            rules=PDF_RULES,
            user=_user(),
        )
        scan.assert_not_awaited()

    @pytest.mark.parametrize("org", [None, "", "..", "a/b"])
    def test_a_directory_needs_a_usable_organization(self, root, org):
        with pytest.raises(ValueError, match="needs an organization"):
            file_storage.area_directory(org, StorageArea.DOCUMENTS)

    @pytest.mark.parametrize("record", ["..", "a/b", "a\\b", ""])
    def test_a_record_id_cannot_escape_its_area(self, root, record):
        with pytest.raises(ValueError, match="Invalid record id"):
            file_storage.area_directory(ORG, StorageArea.DOCUMENTS, record)


class TestConsistentExtension:
    RULES = FileRules(
        allowed_types={
            "text/plain": ".txt",
            "text/csv": ".csv",
            "application/pdf": ".pdf",
        },
        max_bytes=1024,
        description="text or PDF",
        keep_consistent_extension=True,
        allowed_extensions=frozenset({".txt", ".csv", ".pdf"}),
    )

    async def _store(self, name, content):
        return await FileStorageService(None).store_bytes(
            content,
            original_name=name,
            organization_id=ORG,
            area=StorageArea.EVENT_ATTACHMENTS,
            rules=self.RULES,
            user=_user(),
        )

    async def test_a_csv_keeps_its_extension(self, root):
        stored = await self._store("roster.csv", b"name,rank\nA,B\n")
        assert stored.path.endswith(".csv")

    async def test_a_disguised_pdf_is_refused(self, root):
        with pytest.raises(HTTPException) as refused:
            await self._store("roster.csv", PDF)
        assert "does not match" in refused.value.detail

    async def test_an_extension_outside_the_list_is_refused(self, root):
        with pytest.raises(HTTPException) as refused:
            await self._store("notes.ics", b"BEGIN:VCALENDAR\n")
        assert "not allowed" in refused.value.detail


# ---------------------------------------------------------------------------
# Resolving
# ---------------------------------------------------------------------------


def _touch(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    return str(path)


class TestResolve:
    def test_current_layout_in_the_right_area(self, root):
        own = _touch(root / ORG / "documents" / "a.pdf")
        assert file_storage.resolve(own, ORG, StorageArea.DOCUMENTS) == own

    def test_the_wrong_area_is_refused(self, root):
        own = _touch(root / ORG / "suggestions" / "a.webp")
        assert file_storage.resolve(own, ORG, StorageArea.DOCUMENTS) is None

    def test_another_orgs_file_is_refused_in_either_layout(self, root):
        current = _touch(root / OTHER_ORG / "documents" / "a.pdf")
        legacy = _touch(root / "documents" / OTHER_ORG / "a.pdf")
        for path in (current, legacy):
            assert file_storage.resolve(path, ORG, StorageArea.DOCUMENTS) is None

    def test_the_legacy_layout_is_still_read(self, root):
        legacy = _touch(root / "prospect-documents" / ORG / "p1" / "a.pdf")
        assert file_storage.resolve(legacy, ORG, StorageArea.APPLICANTS) == legacy

    def test_traversal_and_symlinks_are_refused(self, root):
        theirs = _touch(root / OTHER_ORG / "documents" / "a.pdf")
        escaped = str(
            root / ORG / "documents" / ".." / ".." / OTHER_ORG / "documents" / "a.pdf"
        )
        assert file_storage.resolve(escaped, ORG, StorageArea.DOCUMENTS) is None
        link = root / ORG / "documents" / "link.pdf"
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(theirs)
        assert file_storage.resolve(str(link), ORG, StorageArea.DOCUMENTS) is None

    def test_a_pre_volume_relative_email_path_is_read(
        self, root, monkeypatch, tmp_path
    ):
        app_root = tmp_path / "app"
        monkeypatch.setattr(file_storage, "APP_ROOT", str(app_root))
        monkeypatch.setattr(
            file_storage,
            "LEGACY_EMAIL_ATTACHMENT_DIR",
            str(app_root / "storage" / "email_attachments"),
        )
        stored = _touch(app_root / "storage" / "email_attachments" / ORG / "a.pdf")
        relative = os.path.join("storage", "email_attachments", ORG, "a.pdf")
        assert (
            file_storage.resolve(relative, ORG, StorageArea.EMAIL_ATTACHMENTS) == stored
        )

    @pytest.mark.parametrize("bad", [None, "", 3, ["x"]])
    def test_malformed_values_are_refused_not_raised(self, root, bad):
        assert file_storage.resolve(bad, ORG, StorageArea.DOCUMENTS) is None


# ---------------------------------------------------------------------------
# Logos, which arrive as base64 inside JSON
# ---------------------------------------------------------------------------


class TestLogoScanning:
    async def test_the_decoded_bytes_are_scanned_before_validation(self, monkeypatch):
        scan = _scanner(monkeypatch, result=ScanResult(True, "Win.Test"))
        monkeypatch.setattr(upload_scanning, "log_audit_event", AsyncMock())
        db = SimpleNamespace(commit=AsyncMock())
        validate = MagicMock()
        monkeypatch.setattr(upload_scanning, "validate_logo_image", validate)
        with pytest.raises(HTTPException) as refused:
            await upload_scanning.scan_and_validate_logo(
                db, "data:image/png;base64,aGVsbG8=", user=None
            )
        assert refused.value.error_code == ErrorCode.UPLD_MALWARE_DETECTED
        assert scan.await_args.args[0] == b"hello"
        validate.assert_not_called()

    async def test_no_logo_is_nothing_to_do(self, monkeypatch):
        scan = _scanner(monkeypatch)
        assert (
            await upload_scanning.scan_and_validate_logo(None, None, user=None) is None
        )
        scan.assert_not_awaited()

    async def test_an_anonymous_upload_records_no_user(self, monkeypatch):
        _scanner(monkeypatch, result=ScanResult(True, "Win.Test"))
        audit = AsyncMock()
        monkeypatch.setattr(upload_scanning, "log_audit_event", audit)
        with pytest.raises(HTTPException):
            await upload_scanning.reject_if_malicious(
                SimpleNamespace(commit=AsyncMock()),
                b"x",
                upload_kind="suggestion_screenshot",
                detected_mime=None,
                user=None,
            )
        assert audit.await_args.kwargs["user_id"] is None
        assert audit.await_args.kwargs["username"] is None


# ---------------------------------------------------------------------------
# Download names
# ---------------------------------------------------------------------------


class TestDescriptiveFilename:
    def test_date_member_and_title(self):
        assert (
            descriptive_filename(
                date(2026, 10, 8),
                member_name_part("John", "Smith"),
                "EMT Recertification",
                extension=".pdf",
            )
            == "2026-10-08_Smith-John_EMT-Recertification.pdf"
        )

    def test_missing_parts_are_skipped_and_punctuation_collapsed(self):
        assert (
            descriptive_filename(None, "Pump Ops / Drill #2", "", extension="PDF")
            == "Pump-Ops-Drill-2.pdf"
        )

    def test_accented_letters_survive(self):
        assert descriptive_filename("Señor Núñez", extension=".pdf") == (
            "Señor-Núñez.pdf"
        )

    def test_a_datetime_contributes_its_date(self):
        moment = datetime(2026, 10, 8, 23, 0, tzinfo=timezone.utc)
        assert descriptive_filename(moment, "x", extension=".txt") == (
            "2026-10-08_x.txt"
        )

    def test_nothing_usable_falls_back(self):
        assert descriptive_filename(None, "///", extension=".pdf") == "download.pdf"
        assert (
            descriptive_filename(None, extension=".pdf", fallback="certificate")
            == "certificate.pdf"
        )

    def test_a_suspicious_extension_is_dropped(self):
        assert descriptive_filename("x", extension=".p\nhp") == "x"

    def test_long_titles_are_capped_per_part(self):
        name = descriptive_filename("a" * 300, "b" * 300, extension=".pdf")
        stem = name[: -len(".pdf")]
        first, second = stem.split("_")
        assert len(first) <= 60
        assert len(second) <= 60

    def test_a_document_named_after_its_file_loses_the_repeat(self):
        assert without_extension("scan.PDF", ".pdf") == "scan"
        assert without_extension("Minutes", ".pdf") == "Minutes"


# ---------------------------------------------------------------------------
# Telling administrators when scanning is off
# ---------------------------------------------------------------------------


class TestScanningDisabledNotices:
    def test_the_config_validator_warns(self, monkeypatch):
        from app.core.config import Settings

        settings = Settings(CLAMAV_ENABLED=False)
        warnings = settings.validate_security_config()
        assert any(w.startswith("WARNING: CLAMAV_ENABLED is false") for w in warnings)
        settings = Settings(CLAMAV_ENABLED=True)
        assert not any(
            "CLAMAV_ENABLED" in w for w in settings.validate_security_config()
        )

    async def test_the_admin_notice_follows_the_setting(self, monkeypatch):
        from app.api.v1.endpoints import system_notices as endpoint
        from app.services import system_notices

        monkeypatch.setattr(
            system_notices.upload_encryption, "plaintext_remains", lambda: False
        )
        monkeypatch.setattr(system_notices.settings, "CLAMAV_ENABLED", False)
        notices = await endpoint.list_system_notices(current_user=None)
        assert [n.key for n in notices] == [system_notices.MALWARE_SCANNING_DISABLED]
        assert notices[0].severity == "critical"

        monkeypatch.setattr(system_notices.settings, "CLAMAV_ENABLED", True)
        assert await endpoint.list_system_notices(current_user=None) == []

    def test_the_notice_needs_settings_manage(self):
        from fastapi.routing import APIRoute

        from app.api.v1.endpoints import system_notices as endpoint

        (route,) = [r for r in endpoint.router.routes if isinstance(r, APIRoute)]
        checker = route.dependant.dependencies[-1].call
        assert checker.required_permissions == ["settings.manage"]
