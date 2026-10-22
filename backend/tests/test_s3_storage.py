"""A department's own S3 bucket (decision 31, step 2).

moto stands in for S3. What is pinned here:

* a stored ``s3://`` reference is confined to its organization and area the
  way a local path is, and nothing on the key can widen that;
* objects are encrypted before they leave the server;
* new files go to the bucket only after a passed connection test with exactly
  the settings now saved, and an unreachable bucket refuses the upload rather
  than writing somewhere else;
* the endpoint a department types is checked before any request is made.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import boto3
import pytest
from botocore.exceptions import EndpointConnectionError
from moto import mock_aws

from app.core import file_encryption
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.schemas.organization import encrypt_settings_secrets
from app.services import file_storage_service as file_storage
from app.services import s3_storage, upload_scanning
from app.services.file_storage_service import (
    ACTIVATION_KEY,
    FileRules,
    FileStorageService,
    StorageArea,
)
from app.services.s3_storage import S3Backend, S3Config, S3Location, S3StorageError

pytestmark = pytest.mark.unit

ORG = str(uuid4())
OTHER_ORG = str(uuid4())
BUCKET = "dept-files"
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
PDF_RULES = FileRules(
    allowed_types={"application/pdf": ".pdf"}, max_bytes=1024, description="PDF"
)


def _file_storage_settings(**overrides):
    values = {
        "platform": "s3",
        "s3_bucket_name": BUCKET,
        "s3_access_key_id": "AKIATESTKEY",
        "s3_secret_access_key": "test-secret",
        "s3_region": "us-east-1",
    }
    values.update(overrides)
    return values


def _config(**overrides) -> S3Config:
    config = s3_storage.config_from_settings(_file_storage_settings(**overrides))
    assert config is not None
    return config


def _org_settings(*, activated: bool, **overrides):
    """What ``organizations.settings`` holds, secrets encrypted as stored."""
    settings_dict = {"file_storage": _file_storage_settings(**overrides)}
    if activated:
        settings_dict[ACTIVATION_KEY] = {
            "platform": "s3",
            "fingerprint": _config().fingerprint(),
            "bucket": BUCKET,
            "endpoint_url": None,
            "region": "us-east-1",
            "activated_at": "2026-10-22T12:00:00+00:00",
            "activated_by": "admin",
        }
    return encrypt_settings_secrets(settings_dict)


@pytest.fixture
def bucket(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        yield client


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


def _saved(monkeypatch, settings_dict):
    loader = AsyncMock(return_value=settings_dict)
    monkeypatch.setattr(file_storage, "_load_settings", loader)
    return loader


def _no_scan(monkeypatch):
    monkeypatch.setattr(upload_scanning, "is_malware_scan_enabled", lambda: False)


def _ref(key: str) -> str:
    return s3_storage.make_ref(BUCKET, key)


# ---------------------------------------------------------------------------
# References and containment
# ---------------------------------------------------------------------------


class TestReferences:
    def test_round_trip(self):
        ref = _ref(f"{ORG}/documents/rec/a.pdf")
        assert ref == f"s3://{BUCKET}/{ORG}/documents/rec/a.pdf"
        assert s3_storage.parse_ref(ref) == S3Location(
            BUCKET, f"{ORG}/documents/rec/a.pdf"
        )

    @pytest.mark.parametrize(
        "value",
        [None, "", "/app/uploads/x.pdf", "s3://", "s3://Bad_Bucket/key", "s3://ok"],
    )
    def test_not_a_reference(self, value):
        assert s3_storage.parse_ref(value) is None

    def test_resolves_inside_the_org_and_area(self):
        ref = _ref(f"{ORG}/documents/rec/a.pdf")
        assert file_storage.resolve(ref, ORG, StorageArea.DOCUMENTS) == ref

    @pytest.mark.parametrize(
        "key",
        [
            f"{OTHER_ORG}/documents/rec/a.pdf",
            f"{ORG}/applicants/rec/a.pdf",
            f"{ORG}/documents/../applicants/a.pdf",
            f"{ORG}/documents/./a.pdf",
            f"{ORG}//documents/a.pdf",
            f"{ORG}/documents",
            f"../{ORG}/documents/a.pdf",
        ],
    )
    def test_refuses_anything_else(self, key):
        assert file_storage.resolve(_ref(key), ORG, StorageArea.DOCUMENTS) is None

    def test_refuses_without_an_organization(self):
        ref = _ref(f"{ORG}/documents/rec/a.pdf")
        assert file_storage.resolve(ref, None, StorageArea.DOCUMENTS) is None


# ---------------------------------------------------------------------------
# Settings and the endpoint check
# ---------------------------------------------------------------------------


class TestConfig:
    @pytest.mark.parametrize(
        "missing", ["s3_bucket_name", "s3_access_key_id", "s3_secret_access_key"]
    )
    def test_incomplete_settings_name_no_bucket(self, missing):
        assert (
            s3_storage.config_from_settings(_file_storage_settings(**{missing: " "}))
            is None
        )

    def test_fingerprint_follows_every_setting_that_decides_where_files_go(self):
        base = _config().fingerprint()
        assert _config().fingerprint() == base
        for change in (
            {"s3_bucket_name": "other-bucket"},
            {"s3_region": "eu-west-1"},
            {"s3_endpoint_url": "https://s3.example.com"},
            {"s3_access_key_id": "AKIAOTHER"},
            {"s3_secret_access_key": "rotated"},
        ):
            assert _config(**change).fingerprint() != base, change

    def test_fingerprint_does_not_contain_the_secret(self):
        assert "test-secret" not in _config().fingerprint()

    def test_bad_bucket_name_refused(self):
        with pytest.raises(ValueError, match="bucket name"):
            s3_storage.check_config(_config(s3_bucket_name="Not_A_Bucket"))


class TestEndpointCheck:
    def test_plain_http_needs_the_operator(self, monkeypatch):
        monkeypatch.setattr(s3_storage.settings, "S3_ALLOW_PRIVATE_ENDPOINT", False)
        with pytest.raises(ValueError, match="S3_ALLOW_PRIVATE_ENDPOINT"):
            s3_storage.check_endpoint("http://minio:9000")

    def test_private_https_needs_the_operator(self, monkeypatch):
        monkeypatch.setattr(s3_storage.settings, "S3_ALLOW_PRIVATE_ENDPOINT", False)
        with pytest.raises(ValueError, match="S3_ALLOW_PRIVATE_ENDPOINT"):
            s3_storage.check_endpoint("https://10.0.0.5:9000")

    def test_bundled_minio_allowed_with_the_operator(self, monkeypatch):
        monkeypatch.setattr(s3_storage.settings, "S3_ALLOW_PRIVATE_ENDPOINT", True)
        s3_storage.check_endpoint("http://minio:9000")

    @pytest.mark.parametrize(
        "url", ["http://169.254.169.254", "https://metadata.google.internal"]
    )
    def test_metadata_hosts_refused_regardless(self, monkeypatch, url):
        monkeypatch.setattr(s3_storage.settings, "S3_ALLOW_PRIVATE_ENDPOINT", True)
        with pytest.raises(ValueError, match="not allowed"):
            s3_storage.check_endpoint(url)

    def test_other_schemes_refused(self, monkeypatch):
        monkeypatch.setattr(s3_storage.settings, "S3_ALLOW_PRIVATE_ENDPOINT", True)
        with pytest.raises(ValueError, match="must use HTTPS"):
            s3_storage.check_endpoint("ftp://minio:9000")

    def test_custom_endpoint_uses_path_addressing(self):
        backend = S3Backend(_config(s3_endpoint_url="https://s3.example.com"))
        assert backend._client.meta.config.s3["addressing_style"] == "path"


# ---------------------------------------------------------------------------
# The bucket backend
# ---------------------------------------------------------------------------


class TestBackend:
    def test_round_trip_is_encrypted_in_the_bucket(self, bucket):
        backend = S3Backend(_config())
        location = S3Location(BUCKET, f"{ORG}/documents/rec/a.pdf")
        backend.put(location, PDF)

        raw = bucket.get_object(Bucket=BUCKET, Key=location.key)["Body"].read()
        assert file_encryption.is_encrypted_bytes(raw)
        assert b"%PDF" not in raw

        assert backend.exists(location)
        assert backend.read_bytes(location) == PDF
        assert backend.plaintext_size(location) == len(PDF)
        size, chunks = backend.open_plaintext(location)
        assert size == len(PDF)
        assert b"".join(chunks) == PDF

    def test_large_object_streams_in_chunks(self, bucket):
        backend = S3Backend(_config())
        location = S3Location(BUCKET, f"{ORG}/documents/rec/big.bin")
        data = bytes(range(256)) * 1000
        backend.put(location, data)
        size, chunks = backend.open_plaintext(location)
        pieces = list(chunks)
        assert size == len(data)
        assert len(pieces) > 1
        assert b"".join(pieces) == data

    def test_plain_object_is_served_as_it_is(self, bucket):
        backend = S3Backend(_config())
        key = f"{ORG}/documents/rec/plain.pdf"
        bucket.put_object(Bucket=BUCKET, Key=key, Body=PDF)
        location = S3Location(BUCKET, key)
        assert backend.read_bytes(location) == PDF
        assert backend.plaintext_size(location) == len(PDF)

    def test_missing_object(self, bucket):
        backend = S3Backend(_config())
        location = S3Location(BUCKET, f"{ORG}/documents/rec/none.pdf")
        assert backend.exists(location) is False
        with pytest.raises(FileNotFoundError):
            backend.read_bytes(location)

    def test_delete_reports_gone_including_already_missing(self, bucket):
        backend = S3Backend(_config())
        location = S3Location(BUCKET, f"{ORG}/documents/rec/a.pdf")
        backend.put(location, PDF)
        assert backend.delete(location) is True
        assert backend.exists(location) is False
        assert backend.delete(location) is True

    def test_unreachable_bucket_is_a_storage_error(self):
        client = MagicMock()
        failure = EndpointConnectionError(endpoint_url="https://s3.example.com")
        for name in ("put_object", "head_object", "get_object"):
            getattr(client, name).side_effect = failure
        client.delete_object.side_effect = failure
        backend = S3Backend(_config(), client=client)
        location = S3Location(BUCKET, f"{ORG}/documents/rec/a.pdf")
        with pytest.raises(S3StorageError):
            backend.put(location, PDF)
        with pytest.raises(S3StorageError):
            backend.exists(location)
        with pytest.raises(S3StorageError):
            backend.read_bytes(location)
        assert backend.delete(location) is False


# ---------------------------------------------------------------------------
# Where new files go
# ---------------------------------------------------------------------------


class TestWhereNewFilesGo:
    async def test_saved_but_untested_settings_keep_files_on_disk(
        self, bucket, root, monkeypatch
    ):
        _saved(monkeypatch, _org_settings(activated=False))
        ref = await file_storage.write_file(
            ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
        )
        assert ref.startswith(str(root))
        assert bucket.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0
        view = await file_storage.org_storage(ORG)
        assert view.writes_to_s3 is False
        assert view.changed_since_test is False

    async def test_tested_settings_send_files_to_the_bucket(
        self, bucket, root, monkeypatch
    ):
        _no_scan(monkeypatch)
        _saved(monkeypatch, _org_settings(activated=True))
        stored = await FileStorageService(None).store_bytes(
            PDF,
            original_name="minutes.pdf",
            organization_id=ORG,
            area=StorageArea.DOCUMENTS,
            rules=PDF_RULES,
            user=SimpleNamespace(id="u", username="chief"),
            record_id="rec",
        )
        assert stored.path.startswith(f"s3://{BUCKET}/{ORG}/documents/rec/")
        assert not any(root.rglob("*.pdf"))
        ref = file_storage.resolve(stored.path, ORG, StorageArea.DOCUMENTS)
        assert ref == stored.path

        assert await file_storage.exists(ref)
        assert await file_storage.read_bytes(ref) == PDF
        assert await file_storage.plaintext_size(ref) == len(PDF)
        response = await file_storage.file_response(
            ref, filename="Minutes.pdf", media_type="application/pdf"
        )
        assert response.headers["content-length"] == str(len(PDF))
        assert 'filename="Minutes.pdf"' in response.headers["content-disposition"]
        body = b"".join([chunk async for chunk in response.body_iterator])
        assert body == PDF

        assert await file_storage.delete(ref) is True
        assert not await file_storage.exists(ref)

    @pytest.mark.parametrize(
        "change",
        [
            {"s3_secret_access_key": "rotated"},
            {"s3_bucket_name": "another-bucket"},
            {"s3_endpoint_url": "https://s3.example.com"},
        ],
    )
    async def test_settings_edited_after_the_test_go_back_to_disk(
        self, bucket, root, monkeypatch, change
    ):
        stored = _org_settings(activated=True, **change)
        _saved(monkeypatch, stored)
        ref = await file_storage.write_file(
            ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
        )
        assert ref.startswith(str(root))
        view = await file_storage.org_storage(ORG)
        assert view.writes_to_s3 is False
        assert view.changed_since_test is True

    async def test_platform_switched_back_to_local_writes_locally(
        self, bucket, root, monkeypatch
    ):
        _saved(monkeypatch, _org_settings(activated=True, platform="local"))
        ref = await file_storage.write_file(
            ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
        )
        assert ref.startswith(str(root))

    async def test_a_forged_activation_record_does_not_match(
        self, bucket, root, monkeypatch
    ):
        settings_dict = _org_settings(activated=True)
        settings_dict[ACTIVATION_KEY]["fingerprint"] = "0" * 64
        _saved(monkeypatch, settings_dict)
        ref = await file_storage.write_file(
            ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
        )
        assert ref.startswith(str(root))

    async def test_unreachable_bucket_refuses_the_upload(self, root, monkeypatch):
        _saved(monkeypatch, _org_settings(activated=True))
        monkeypatch.setattr(
            S3Backend,
            "put",
            MagicMock(side_effect=S3StorageError("S3 upload failed")),
        )
        with pytest.raises(CodedHTTPException) as caught:
            await file_storage.write_file(
                ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
            )
        assert caught.value.status_code == 503
        assert caught.value.error_code == ErrorCode.UPLD_STORAGE_UNAVAILABLE
        assert not any(root.rglob("*.pdf"))

    async def test_endpoint_refused_after_activation_refuses_the_upload(
        self, root, monkeypatch
    ):
        monkeypatch.setattr(s3_storage.settings, "S3_ALLOW_PRIVATE_ENDPOINT", False)
        settings_dict = _org_settings(
            activated=True, s3_endpoint_url="http://minio:9000"
        )
        settings_dict[ACTIVATION_KEY]["fingerprint"] = _config(
            s3_endpoint_url="http://minio:9000"
        ).fingerprint()
        _saved(monkeypatch, settings_dict)
        view = await file_storage.org_storage(ORG)
        assert view.writes_to_s3 is True
        assert view.s3 is None
        assert "S3_ALLOW_PRIVATE_ENDPOINT" in (view.s3_problem or "")
        with pytest.raises(CodedHTTPException) as caught:
            await file_storage.write_file(
                ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
            )
        assert caught.value.status_code == 503

    async def test_local_file_still_served_from_disk_on_s3(
        self, bucket, root, monkeypatch
    ):
        _saved(monkeypatch, _org_settings(activated=False))
        local = await file_storage.write_file(
            ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", PDF
        )
        file_storage.forget_org_storage()
        _saved(monkeypatch, _org_settings(activated=True))
        assert await file_storage.read_bytes(local) == PDF

    async def test_reading_from_the_bucket_when_it_is_down_is_a_503(
        self, root, monkeypatch
    ):
        _saved(monkeypatch, _org_settings(activated=True))
        monkeypatch.setattr(
            S3Backend,
            "read_bytes",
            MagicMock(side_effect=S3StorageError("S3 read failed")),
        )
        with pytest.raises(CodedHTTPException) as caught:
            await file_storage.read_bytes(_ref(f"{ORG}/documents/rec/a.pdf"))
        assert caught.value.status_code == 503

    async def test_delete_without_credentials_reports_failure(self, monkeypatch):
        _saved(monkeypatch, {})
        assert await file_storage.delete(_ref(f"{ORG}/documents/rec/a.pdf")) is False

    async def test_view_is_cached_and_bounded(self, monkeypatch):
        loader = _saved(monkeypatch, {})
        await file_storage.org_storage(ORG)
        await file_storage.org_storage(ORG)
        assert loader.await_count == 1
        monkeypatch.setattr(file_storage, "_ORG_STORAGE_MAX_ENTRIES", 3)
        for _ in range(5):
            await file_storage.org_storage(str(uuid4()))
        assert len(file_storage._org_storage_cache) == 3


# ---------------------------------------------------------------------------
# The connection test
# ---------------------------------------------------------------------------


class _Db:
    def __init__(self):
        self.commit = AsyncMock()
        self.rollback = AsyncMock()


def _locked_org(monkeypatch, settings_dict):
    organization = SimpleNamespace(settings=settings_dict)
    monkeypatch.setattr(
        file_storage, "_lock_organization", AsyncMock(return_value=organization)
    )
    return organization


class TestActivate:
    async def test_passes_records_and_leaves_no_test_object(self, bucket, monkeypatch):
        saved = _org_settings(activated=False)
        _saved(monkeypatch, saved)
        organization = _locked_org(monkeypatch, saved)
        db = _Db()

        await file_storage.activate_s3(db, ORG, "admin-id")

        record = organization.settings[ACTIVATION_KEY]
        assert record["fingerprint"] == _config().fingerprint()
        assert record["bucket"] == BUCKET
        assert record["activated_by"] == "admin-id"
        db.commit.assert_awaited_once()
        assert bucket.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0

    async def test_fails_without_changing_anything(self, bucket, monkeypatch):
        saved = _org_settings(activated=False, s3_bucket_name="no-such-bucket")
        _saved(monkeypatch, saved)
        lock = AsyncMock()
        monkeypatch.setattr(file_storage, "_lock_organization", lock)
        db = _Db()
        with pytest.raises(ValueError, match="connection test failed"):
            await file_storage.activate_s3(db, ORG, "admin-id")
        lock.assert_not_awaited()
        db.commit.assert_not_awaited()

    async def test_needs_s3_chosen_and_saved(self, monkeypatch):
        _saved(monkeypatch, _org_settings(activated=False, platform="local"))
        with pytest.raises(ValueError, match="Choose Amazon S3"):
            await file_storage.activate_s3(_Db(), ORG, "admin-id")

    async def test_needs_credentials(self, monkeypatch):
        _saved(monkeypatch, {"file_storage": {"platform": "s3"}})
        with pytest.raises(ValueError, match="Save the bucket name"):
            await file_storage.activate_s3(_Db(), ORG, "admin-id")

    async def test_settings_changed_during_the_test_are_not_vouched_for(
        self, bucket, monkeypatch
    ):
        _saved(monkeypatch, _org_settings(activated=False))
        organization = _locked_org(
            monkeypatch,
            _org_settings(activated=False, s3_secret_access_key="changed"),
        )
        db = _Db()
        with pytest.raises(ValueError, match="changed while"):
            await file_storage.activate_s3(db, ORG, "admin-id")
        assert ACTIVATION_KEY not in organization.settings
        db.commit.assert_not_awaited()

    async def test_deactivate_removes_the_record(self, monkeypatch):
        saved = _org_settings(activated=True)
        organization = _locked_org(monkeypatch, saved)
        _saved(monkeypatch, {})
        db = _Db()
        view = await file_storage.deactivate_s3(db, ORG)
        assert ACTIVATION_KEY not in organization.settings
        assert view.writes_to_s3 is False
        db.commit.assert_awaited_once()


class TestSettingsUpdateCannotVouch:
    async def test_a_client_cannot_write_the_activation_record(self, monkeypatch):
        from app.services.organization_service import OrganizationService

        existing = {"file_storage": {"platform": "local"}}
        organization = SimpleNamespace(settings=existing)
        db = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        service = OrganizationService(db)
        monkeypatch.setattr(
            service, "get_organization", AsyncMock(return_value=organization)
        )
        monkeypatch.setattr(
            service, "get_organization_settings", AsyncMock(return_value=None)
        )
        forged = {"platform": "s3", "fingerprint": _config().fingerprint()}

        await service.update_organization_settings(
            ORG,
            {"file_storage": _file_storage_settings(), ACTIVATION_KEY: forged},
        )

        assert ACTIVATION_KEY not in organization.settings
        assert organization.settings["file_storage"]["platform"] == "s3"


class TestEndpoints:
    @pytest.fixture
    def wired(self, monkeypatch):
        from app.api.v1.endpoints import organizations

        saved = SimpleNamespace(file_storage=SimpleNamespace(platform="s3"))
        monkeypatch.setattr(
            organizations.OrganizationService,
            "get_organization_settings",
            AsyncMock(return_value=saved),
        )
        audit = AsyncMock()
        monkeypatch.setattr(organizations, "log_audit_event", audit)
        user = SimpleNamespace(id="admin-id", username="chief", organization_id=ORG)
        return organizations, audit, user

    async def test_status_reports_disk_until_tested(self, wired, monkeypatch):
        organizations, _audit, user = wired
        _saved(monkeypatch, _org_settings(activated=False))
        status_view = await organizations.get_file_storage_status(
            db=MagicMock(), current_user=user
        )
        assert status_view.platform == "s3"
        assert status_view.new_files_go_to == "local"
        assert status_view.changed_since_test is False

    async def test_status_reports_settings_changed_since_the_test(
        self, wired, monkeypatch
    ):
        organizations, _audit, user = wired
        _saved(monkeypatch, _org_settings(activated=True, s3_secret_access_key="new"))
        status_view = await organizations.get_file_storage_status(
            db=MagicMock(), current_user=user
        )
        assert status_view.new_files_go_to == "local"
        assert status_view.changed_since_test is True
        assert status_view.bucket == BUCKET

    async def test_activate_failure_is_a_400_and_not_audited(self, wired, monkeypatch):
        from fastapi import HTTPException

        organizations, audit, user = wired
        monkeypatch.setattr(
            file_storage,
            "activate_s3",
            AsyncMock(side_effect=ValueError("The connection test failed: x")),
        )
        with pytest.raises(HTTPException) as caught:
            await organizations.activate_s3_file_storage(
                db=MagicMock(), current_user=user, _rate_limited=None
            )
        assert caught.value.status_code == 400
        assert "connection test failed" in caught.value.detail
        audit.assert_not_awaited()

    async def test_activate_success_is_audited(self, wired, monkeypatch):
        organizations, audit, user = wired
        monkeypatch.setattr(file_storage, "activate_s3", AsyncMock())
        _saved(monkeypatch, _org_settings(activated=True))
        status_view = await organizations.activate_s3_file_storage(
            db=MagicMock(), current_user=user, _rate_limited=None
        )
        assert status_view.new_files_go_to == "s3"
        assert audit.await_args.kwargs["event_type"] == "file_storage_s3_activated"
        assert audit.await_args.kwargs["event_data"]["bucket"] == BUCKET

    async def test_deactivate_is_audited(self, wired, monkeypatch):
        organizations, audit, user = wired
        monkeypatch.setattr(file_storage, "deactivate_s3", AsyncMock())
        _saved(monkeypatch, {"file_storage": {"platform": "s3"}})
        status_view = await organizations.deactivate_s3_file_storage(
            db=MagicMock(), current_user=user
        )
        assert status_view.new_files_go_to == "local"
        assert audit.await_args.kwargs["event_type"] == "file_storage_s3_deactivated"
