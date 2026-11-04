"""A self-hosted S3/MinIO endpoint is the installation operator's choice.

Owner decision 2026-11-01 (clarified 2026-11-03; KNOWN_LIMITATIONS SCH-10):
botocore resolves a custom endpoint's hostname itself, so the up-front SSRF
check cannot pin the connection. A custom endpoint is therefore accepted only
when the operator listed it in ``S3_ALLOWED_ENDPOINTS``. Pinned here:

* the comparison is an exact match on a normalised form, never a prefix;
* saving a custom endpoint that is not listed is a 400 (file-storage PATCH,
  full-settings save through the same service, onboarding);
* an endpoint stored before the allowlist existed is refused wherever a
  client is built, so uploads stop rather than reaching it;
* Amazon S3 without a custom endpoint is unaffected by an empty allowlist.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.config import Settings, normalize_endpoint_url
from app.core.error_codes import CodedHTTPException
from app.schemas.organization import FileStorageSettings, encrypt_settings_secrets
from app.services import file_storage_service as file_storage
from app.services import s3_storage
from app.services.file_storage_service import ACTIVATION_KEY, StorageArea
from app.services.s3_storage import ENDPOINT_NOT_ALLOWED, S3Backend

pytestmark = pytest.mark.unit

ORG = str(uuid4())
BUCKET = "dept-files"
MINIO = "http://minio:9000"


def _file_storage(**overrides):
    values = {
        "platform": "s3",
        "s3_bucket_name": BUCKET,
        "s3_access_key_id": "AKIATESTKEY",
        "s3_secret_access_key": "test-secret",
        "s3_region": "us-east-1",
    }
    values.update(overrides)
    return values


def _config(**overrides):
    config = s3_storage.config_from_settings(_file_storage(**overrides))
    assert config is not None
    return config


def _allow(monkeypatch, value: str, *, private: bool = True) -> None:
    monkeypatch.setattr(s3_storage.settings, "S3_ALLOWED_ENDPOINTS", value)
    monkeypatch.setattr(s3_storage.settings, "S3_ALLOW_PRIVATE_ENDPOINT", private)


# ---------------------------------------------------------------------------
# Normalisation and matching
# ---------------------------------------------------------------------------


class TestNormalisation:
    @pytest.mark.parametrize(
        ("a", "b"),
        [
            ("https://S3.Example.org", "https://s3.example.org"),
            ("https://s3.example.org/", "https://s3.example.org"),
            ("https://s3.example.org:443", "https://s3.example.org"),
            ("HTTP://minio:9000/", "http://minio:9000"),
            ("  http://minio:9000  ", "http://minio:9000"),
        ],
    )
    def test_same_endpoint_written_differently(self, a, b):
        assert normalize_endpoint_url(a) == normalize_endpoint_url(b)

    @pytest.mark.parametrize(
        ("a", "b"),
        [
            ("http://minio:9000", "https://minio:9000"),
            ("http://minio:9000", "http://minio:9001"),
            ("http://minio:9000", "http://minio:9000/other"),
            ("https://s3.example.org", "https://s3.example.org.evil.net"),
        ],
    )
    def test_different_endpoints_stay_different(self, a, b):
        assert normalize_endpoint_url(a) != normalize_endpoint_url(b)

    @pytest.mark.parametrize(
        "url",
        [
            "ftp://minio:9000",
            "minio:9000",
            "https://",
            "https://user:pass@minio:9000",
            "https://minio:9000/?x=1",
            "https://minio:9000/#frag",
            "https://minio:notaport",
        ],
    )
    def test_not_an_endpoint(self, url):
        with pytest.raises(ValueError, match="URL|must"):
            normalize_endpoint_url(url)

    def test_exact_match_only(self, monkeypatch):
        _allow(monkeypatch, "https://s3.example.org, http://minio:9000/")
        assert s3_storage.endpoint_allowed("https://S3.example.org:443/")
        assert s3_storage.endpoint_allowed("http://minio:9000")
        for url in (
            "https://s3.example.org.evil.net",
            "https://evil.net/https://s3.example.org",
            "https://s3.example.org/bucket",
            "https://minio:9000",
            "http://minio",
            "",
            None,
        ):
            assert not s3_storage.endpoint_allowed(url), url

    def test_empty_allowlist_allows_nothing(self, monkeypatch):
        _allow(monkeypatch, "")
        assert not s3_storage.endpoint_allowed(MINIO)

    def test_listed_as_written_for_the_screen(self, monkeypatch):
        _allow(monkeypatch, " http://minio:9000/ ,,https://s3.example.org")
        assert s3_storage.settings.get_s3_allowed_endpoints() == [
            "http://minio:9000",
            "https://s3.example.org",
        ]


class TestStartupValidation:
    def test_malformed_entry_stops_startup_naming_its_position(self):
        with pytest.raises(ValueError, match="S3_ALLOWED_ENDPOINTS") as caught:
            Settings(S3_ALLOWED_ENDPOINTS="http://minio:9000,https://u:secret@x")
        assert (
            "S3_ALLOWED_ENDPOINTS entry 2 must not contain a user name or password"
            in str(caught.value)
        )

    def test_valid_list_accepted(self):
        settings = Settings(S3_ALLOWED_ENDPOINTS="http://minio:9000")
        assert settings.get_s3_allowed_endpoints() == ["http://minio:9000"]


# ---------------------------------------------------------------------------
# The client builder and the use-time check
# ---------------------------------------------------------------------------


class TestClientBuilder:
    def test_unlisted_endpoint_refused_by_check_config(self, monkeypatch):
        _allow(monkeypatch, "")
        with pytest.raises(ValueError, match="S3_ALLOWED_ENDPOINTS") as caught:
            s3_storage.check_config(_config(s3_endpoint_url=MINIO))
        assert str(caught.value) == ENDPOINT_NOT_ALLOWED
        assert "minio" not in str(caught.value)

    def test_unlisted_endpoint_refused_by_the_backend_itself(self, monkeypatch):
        _allow(monkeypatch, "https://s3.example.org")
        with pytest.raises(ValueError, match="S3_ALLOWED_ENDPOINTS"):
            S3Backend(_config(s3_endpoint_url="https://other.example.org"))

    def test_listed_endpoint_builds_a_client(self, monkeypatch):
        _allow(monkeypatch, MINIO)
        s3_storage.check_config(_config(s3_endpoint_url=f"{MINIO}/"))
        backend = S3Backend(_config(s3_endpoint_url=MINIO))
        assert backend._client.meta.endpoint_url == MINIO

    def test_listed_endpoint_still_gets_the_private_address_check(self, monkeypatch):
        _allow(monkeypatch, MINIO, private=False)
        with pytest.raises(ValueError, match="S3_ALLOW_PRIVATE_ENDPOINT"):
            s3_storage.check_config(_config(s3_endpoint_url=MINIO))

    def test_listed_metadata_host_still_refused(self, monkeypatch):
        _allow(monkeypatch, "http://169.254.169.254")
        with pytest.raises(ValueError, match="not allowed"):
            s3_storage.check_config(_config(s3_endpoint_url="http://169.254.169.254"))

    def test_aws_without_an_endpoint_needs_no_allowlist(self, monkeypatch):
        _allow(monkeypatch, "", private=False)
        config = _config()
        s3_storage.check_config(config)
        backend = S3Backend(config)
        assert "amazonaws.com" in backend._client.meta.endpoint_url


class TestStoredBeforeTheAllowlist:
    """A department that saved and tested a MinIO endpoint before upgrading."""

    def _stored(self, monkeypatch):
        settings_dict = {"file_storage": _file_storage(s3_endpoint_url=MINIO)}
        settings_dict[ACTIVATION_KEY] = {
            "platform": "s3",
            "fingerprint": _config(s3_endpoint_url=MINIO).fingerprint(),
            "bucket": BUCKET,
            "endpoint_url": MINIO,
            "region": "us-east-1",
            "activated_at": "2026-10-22T12:00:00+00:00",
            "activated_by": "admin",
        }
        monkeypatch.setattr(
            file_storage,
            "_load_settings",
            AsyncMock(return_value=encrypt_settings_secrets(settings_dict)),
        )

    async def test_is_not_used_and_says_why(self, tmp_path, monkeypatch):
        monkeypatch.setattr(file_storage, "UPLOADS_ROOT", str(tmp_path))
        _allow(monkeypatch, "")
        self._stored(monkeypatch)
        view = await file_storage.org_storage(ORG)
        assert view.writes_to == "s3"
        assert view.writer is None
        assert view.problems["s3"] == ENDPOINT_NOT_ALLOWED
        with pytest.raises(CodedHTTPException) as caught:
            await file_storage.write_file(
                ORG, StorageArea.DOCUMENTS, "rec", "a.pdf", b"x"
            )
        assert caught.value.status_code == 503
        assert not any(tmp_path.rglob("*.pdf"))

    async def test_files_already_in_the_bucket_are_not_read_from_it(self, monkeypatch):
        _allow(monkeypatch, "")
        self._stored(monkeypatch)
        ref = s3_storage.make_ref(BUCKET, f"{ORG}/documents/rec/a.pdf")
        with pytest.raises(CodedHTTPException) as caught:
            await file_storage.read_bytes(ref)
        assert caught.value.status_code == 503

    async def test_is_used_again_once_the_operator_lists_it(self, monkeypatch):
        _allow(monkeypatch, MINIO)
        self._stored(monkeypatch)
        view = await file_storage.org_storage(ORG)
        assert view.writer is not None
        assert "s3" not in view.problems

    async def test_status_reports_the_problem_and_the_allowlist(self, monkeypatch):
        from app.api.v1.endpoints import organizations

        _allow(monkeypatch, "https://s3.example.org")
        self._stored(monkeypatch)
        user = SimpleNamespace(id="admin-id", username="chief", organization_id=ORG)
        status_view = await organizations.get_file_storage_status(
            db=MagicMock(), current_user=user
        )
        assert status_view.problem == ENDPOINT_NOT_ALLOWED
        assert status_view.allowed_s3_endpoints == ["https://s3.example.org"]


# ---------------------------------------------------------------------------
# Saving
# ---------------------------------------------------------------------------


def _service(monkeypatch, existing):
    from app.services.organization_service import OrganizationService

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
    return service, organization, db


class TestSaving:
    async def test_unlisted_endpoint_refused(self, monkeypatch):
        _allow(monkeypatch, "https://s3.example.org")
        service, organization, db = _service(
            monkeypatch, {"file_storage": {"platform": "local"}}
        )
        with pytest.raises(ValueError, match="S3_ALLOWED_ENDPOINTS"):
            await service.update_organization_settings(
                ORG, {"file_storage": _file_storage(s3_endpoint_url=MINIO)}
            )
        db.commit.assert_not_awaited()
        assert organization.settings["file_storage"]["platform"] == "local"

    async def test_listed_endpoint_saved(self, monkeypatch):
        _allow(monkeypatch, MINIO)
        service, organization, _db = _service(monkeypatch, {})
        await service.update_organization_settings(
            ORG, {"file_storage": _file_storage(s3_endpoint_url=f"{MINIO}/")}
        )
        assert organization.settings["file_storage"]["s3_endpoint_url"] == (f"{MINIO}/")

    async def test_aws_saved_with_an_empty_allowlist(self, monkeypatch):
        _allow(monkeypatch, "")
        service, organization, _db = _service(monkeypatch, {})
        await service.update_organization_settings(
            ORG, {"file_storage": _file_storage(s3_endpoint_url=None)}
        )
        assert organization.settings["file_storage"]["platform"] == "s3"

    async def test_a_stored_endpoint_does_not_block_other_changes(self, monkeypatch):
        """Switching to local disk must still be possible for a department
        whose stored endpoint the operator has not listed; the endpoint stays
        refused at use."""
        _allow(monkeypatch, "")
        service, organization, _db = _service(
            monkeypatch, {"file_storage": _file_storage(s3_endpoint_url=MINIO)}
        )
        await service.update_organization_settings(
            ORG,
            {"file_storage": _file_storage(platform="local", s3_endpoint_url=MINIO)},
        )
        assert organization.settings["file_storage"]["platform"] == "local"

    async def test_changing_a_stored_endpoint_to_another_unlisted_one_refused(
        self, monkeypatch
    ):
        _allow(monkeypatch, "")
        service, _organization, _db = _service(
            monkeypatch, {"file_storage": _file_storage(s3_endpoint_url=MINIO)}
        )
        with pytest.raises(ValueError, match="S3_ALLOWED_ENDPOINTS"):
            await service.update_organization_settings(
                ORG,
                {"file_storage": _file_storage(s3_endpoint_url="http://10.0.0.9")},
            )

    async def test_full_settings_patch_cannot_slip_one_in(self, monkeypatch):
        """A partial file_storage section through the full-settings route is
        judged on the merged section."""
        _allow(monkeypatch, "")
        service, _organization, _db = _service(
            monkeypatch, {"file_storage": _file_storage()}
        )
        with pytest.raises(ValueError, match="S3_ALLOWED_ENDPOINTS"):
            await service.update_organization_settings(
                ORG, {"file_storage": {"s3_endpoint_url": MINIO}}
            )

    async def test_file_storage_patch_is_a_400(self, monkeypatch):
        from app.api.v1.endpoints import organizations

        _allow(monkeypatch, "")
        organization = SimpleNamespace(settings={})
        monkeypatch.setattr(
            organizations.OrganizationService,
            "get_organization",
            AsyncMock(return_value=organization),
        )
        audit = AsyncMock()
        monkeypatch.setattr(organizations, "log_audit_event", audit)
        user = SimpleNamespace(id="admin-id", username="chief", organization_id=ORG)
        with pytest.raises(HTTPException) as caught:
            await organizations.update_file_storage_settings(
                storage_settings=FileStorageSettings(
                    **_file_storage(s3_endpoint_url=MINIO)
                ),
                db=MagicMock(),
                current_user=user,
                _stepup=user,
            )
        assert caught.value.status_code == 400
        assert caught.value.detail == ENDPOINT_NOT_ALLOWED
        audit.assert_not_awaited()


class TestOnboarding:
    @pytest.fixture
    def wired(self, monkeypatch):
        from app.api.v1 import onboarding

        session = SimpleNamespace(data={})
        monkeypatch.setattr(
            onboarding, "validate_session", AsyncMock(return_value=session)
        )
        monkeypatch.setattr(
            onboarding.OnboardingService,
            "needs_onboarding",
            AsyncMock(return_value=True),
        )
        db = MagicMock()
        db.commit = AsyncMock()
        return onboarding, session, db

    async def test_unlisted_endpoint_refused(self, wired, monkeypatch):
        onboarding, session, db = wired
        _allow(monkeypatch, "")
        with pytest.raises(HTTPException) as caught:
            await onboarding.save_file_storage_config(
                request=MagicMock(),
                data=onboarding.FileStorageConfigRequest(
                    platform="s3", config={"s3EndpointUrl": MINIO}
                ),
                db=db,
            )
        assert caught.value.status_code == 400
        assert caught.value.detail == ENDPOINT_NOT_ALLOWED
        assert "file_storage" not in session.data
        db.commit.assert_not_awaited()

    @pytest.mark.parametrize("config", [{"s3EndpointUrl": MINIO}, {}])
    async def test_listed_or_absent_endpoint_saved(self, wired, monkeypatch, config):
        onboarding, session, _db = wired
        _allow(monkeypatch, MINIO)
        await onboarding.save_file_storage_config(
            request=MagicMock(),
            data=onboarding.FileStorageConfigRequest(platform="s3", config=config),
            db=_db,
        )
        assert session.data["file_storage"]["platform"] == "s3"
