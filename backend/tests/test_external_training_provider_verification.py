"""
Saving a provider keeps its verified connection unless the connection changed.

The auto-sync task only picks up providers whose ``connection_verified`` is
true. The edit form sends ``api_base_url`` on every save, and the endpoint used
to un-verify on that key's presence alone, so changing the sync interval or the
daily review time quietly took the provider off the schedule while manual
"Sync Now" kept working.
"""

import uuid
from types import SimpleNamespace

import pytest

from app.api.v1.endpoints.external_training import update_provider
from app.models.training import ExternalProviderType, ExternalTrainingProvider
from app.models.user import Organization
from app.schemas.training import ExternalTrainingProviderUpdate

pytestmark = [pytest.mark.integration]

BASE_URL = "https://example.test/api/"


@pytest.fixture(autouse=True)
def _no_dns(monkeypatch):
    # The SSRF guard resolves the host; these tests are about what a save
    # does to verification, not about that lookup.
    monkeypatch.setattr(
        "app.api.v1.endpoints.external_training.validate_integration_url",
        lambda url: None,
    )


async def _verified_provider(db_session) -> ExternalTrainingProvider:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Verification Department",
        slug=f"pv-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Target Solutions",
        provider_type=ExternalProviderType.TARGET_SOLUTIONS,
        api_base_url=BASE_URL,
        client_id="client-1",
        auth_type="api_key",
        auto_sync_enabled=True,
        sync_interval_hours=24,
        connection_verified=True,
    )
    db_session.add(provider)
    await db_session.flush()
    return provider


async def _save(db_session, provider, **fields) -> ExternalTrainingProvider:
    return await update_provider(
        provider_id=uuid.UUID(provider.id),
        provider_update=ExternalTrainingProviderUpdate(**fields),
        db=db_session,
        current_user=SimpleNamespace(organization_id=provider.organization_id),
    )


class TestScheduleEditsKeepVerification:
    async def test_the_edit_forms_save_with_an_unchanged_url(self, db_session):
        provider = await _verified_provider(db_session)
        saved = await _save(
            db_session,
            provider,
            name="Target Solutions",
            api_base_url=BASE_URL,
            auth_type="api_key",
            auto_sync_enabled=True,
            sync_interval_hours=1,
        )
        assert saved.sync_interval_hours == 1
        assert saved.connection_verified is True

    async def test_an_unchanged_client_id(self, db_session):
        provider = await _verified_provider(db_session)
        saved = await _save(db_session, provider, client_id="client-1")
        assert saved.connection_verified is True


class TestConnectionEditsReverify:
    async def test_a_new_url(self, db_session):
        provider = await _verified_provider(db_session)
        saved = await _save(
            db_session, provider, api_base_url="https://other.example.test/api/"
        )
        assert saved.connection_verified is False

    async def test_a_new_auth_type(self, db_session):
        provider = await _verified_provider(db_session)
        saved = await _save(db_session, provider, auth_type="basic")
        assert saved.connection_verified is False

    async def test_a_new_client_id(self, db_session):
        provider = await _verified_provider(db_session)
        saved = await _save(db_session, provider, client_id="client-2")
        assert saved.connection_verified is False

    async def test_a_newly_typed_key(self, db_session):
        provider = await _verified_provider(db_session)
        saved = await _save(db_session, provider, api_key="new-token")
        assert saved.connection_verified is False

    async def test_a_cleared_key(self, db_session):
        provider = await _verified_provider(db_session)
        provider.api_key = "stored-ciphertext"
        await db_session.flush()
        saved = await _save(db_session, provider, api_key=None)
        assert saved.api_key is None
        assert saved.connection_verified is False

    async def test_clearing_a_key_that_was_never_set(self, db_session):
        provider = await _verified_provider(db_session)
        saved = await _save(db_session, provider, api_secret=None)
        assert saved.connection_verified is True
