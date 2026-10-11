"""The Integrations page's "Switch to Client Credentials" request does what it says.

INT-11: the page now sends exactly ``{"refresh_token": ""}`` in a PATCH to a
connected Salesforce integration. That must clear the stored refresh and access
tokens (so the next sync uses the Connected App's client-credentials grant) and
touch nothing else — the Connected App's own id and secret and every public
setting stay as they were. An omitted refresh token still means "leave it".
"""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from starlette.requests import Request

from app.api.v1.endpoints import integrations as int_ep
from app.models.integration import Integration
from app.schemas.integration import IntegrationUpdateRequest

pytestmark = [pytest.mark.integration]


@pytest.fixture(autouse=True)
def _no_dns(monkeypatch):
    """The SSRF check resolves the stored instance URL; there is no network."""
    monkeypatch.setattr(int_ep, "_validate_urls_in_config", lambda config: None)


_PUBLIC = {
    "instance_url": "https://acme.my.salesforce.com",
    "sync_direction": "both",
    "match_strategy": "email_lastname",
}


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "PATCH",
            "path": "/",
            "headers": [],
            "client": ("203.0.113.41", 1234),
            "query_string": b"",
        }
    )


async def _setup(db):
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'SF Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"sf-switch-{org_id[:8]}"},
    )
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Int', 'Admin', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"sf-{user_id[:8]}",
            "em": f"sf-{user_id[:8]}@test.com",
        },
    )
    integration = Integration(
        organization_id=org_id,
        integration_type="salesforce",
        name="Salesforce",
        category="CRM",
        status="connected",
        enabled=True,
        config=dict(_PUBLIC),
    )
    integration.set_secret("client_id", "3MVG9-department-app")
    integration.set_secret("client_secret", "department-secret")
    integration.set_secret("refresh_token", "colleagues-personal-token")
    integration.set_secret("access_token", "cached-access-token")
    db.add(integration)
    await db.flush()
    admin = SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"sf-{user_id[:8]}"
    )
    return integration, admin


async def _patch(db, integration, admin, config):
    await int_ep.update_integration(
        integration.id,
        _request(),
        body=IntegrationUpdateRequest(config=config),
        db=db,
        current_user=admin,
    )
    await db.refresh(integration)


async def test_the_switch_clears_only_the_personal_tokens(db_session):
    integration, admin = await _setup(db_session)

    await _patch(db_session, integration, admin, {"refresh_token": ""})

    assert integration.get_secret("refresh_token") is None
    assert integration.get_secret("access_token") is None
    assert integration.get_secret("client_id") == "3MVG9-department-app"
    assert integration.get_secret("client_secret") == "department-secret"
    for key, value in _PUBLIC.items():
        assert integration.config[key] == value
    assert "refresh_token" not in integration.config
    assert integration.status == "connected"


async def test_an_omitted_refresh_token_is_left_alone(db_session):
    integration, admin = await _setup(db_session)

    await _patch(db_session, integration, admin, {"sync_direction": "push"})

    assert integration.get_secret("refresh_token") == "colleagues-personal-token"
    assert integration.get_secret("access_token") == "cached-access-token"
    assert integration.config["sync_direction"] == "push"
