"""Connect and disconnect keep an integration's status honest.

Two ways the status could be made to say something untrue, both driven over
HTTP against the real schema because the status code and the stored row are what
is under test:

* ``disconnect`` writes ``status="available"``. On a ``coming_soon`` row that
  turned an unreleased integration into one ``connect`` accepts, bypassing the
  gate ``connect`` applies.
* A chat or webhook integration connected with a blank destination was stored as
  connected and enabled although every send fails with "No webhook URL
  configured". A blank secret means "keep the stored one" on an update, so the
  schemas accept it; on a first connect there is nothing stored to keep.

Each refusal is paired with the accepted control, so a guard that refused every
request would not pass this file.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import integrations as endpoints
from app.core.database import get_db
from app.models.integration import Integration
from app.models.user import User
from app.schemas.integration import SECRET_CONFIG_KEYS

pytestmark = [pytest.mark.integration]

_DESTINATIONS = [
    ("slack", "webhook_url", "https://hooks.slack.com/services/T0/B0/x"),
    ("discord", "webhook_url", "https://discord.com/api/webhooks/1/x"),
    ("microsoft-teams", "webhook_url", "https://example.webhook.office.com/x"),
    ("generic-webhook", "url", "https://example.org/hook"),
]


@pytest.fixture
async def user(db_session: AsyncSession) -> User:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Integration Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"integration-bench-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Bench', 'Admin', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"bench-{user_id[:8]}",
            "em": f"bench-{user_id[:8]}@test.example",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'IT Manager', 'it_manager', "
            "'[\"integrations.manage\"]')"
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await endpoints.ensure_catalog(db_session, org_id)
    member = await db_session.get(User, user_id)
    assert member is not None
    await db_session.refresh(member, ["positions"])
    return member


@pytest.fixture(autouse=True)
def _skip_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    # The SSRF check resolves the host; the sandbox has no resolver and these
    # tests are about status handling, not about which hosts are public.
    monkeypatch.setattr(endpoints, "validate_integration_url", lambda url: url)


def _client(db_session: AsyncSession, member: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(endpoints.router, prefix="/integrations")
    app.dependency_overrides[get_current_user] = lambda: member
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def _row(db_session: AsyncSession, member: User, itype: str) -> Integration:
    row = (
        await db_session.execute(
            select(Integration).where(
                Integration.organization_id == member.organization_id,
                Integration.integration_type == itype,
            )
        )
    ).scalar_one()
    return row


class TestComingSoonStaysComingSoon:
    async def test_disconnect_refuses_and_leaves_the_status(
        self, db_session: AsyncSession, user: User
    ) -> None:
        zapier = await _row(db_session, user, "zapier")
        assert zapier.status == "coming_soon"
        async with _client(db_session, user) as client:
            response = await client.post(f"/integrations/{zapier.id}/disconnect")
        assert response.status_code == 400
        await db_session.refresh(zapier)
        assert zapier.status == "coming_soon"

    async def test_connect_is_still_refused_after_a_disconnect_attempt(
        self, db_session: AsyncSession, user: User
    ) -> None:
        zapier = await _row(db_session, user, "zapier")
        async with _client(db_session, user) as client:
            await client.post(f"/integrations/{zapier.id}/disconnect")
            response = await client.post(
                f"/integrations/{zapier.id}/connect", json={"config": {}}
            )
        assert response.status_code == 400
        await db_session.refresh(zapier)
        assert zapier.status == "coming_soon"
        assert zapier.enabled is False

    async def test_a_released_integration_still_disconnects(
        self, db_session: AsyncSession, user: User
    ) -> None:
        ical = await _row(db_session, user, "ical")
        async with _client(db_session, user) as client:
            connected = await client.post(
                f"/integrations/{ical.id}/connect", json={"config": {}}
            )
            response = await client.post(f"/integrations/{ical.id}/disconnect")
        assert connected.status_code == 200
        assert response.status_code == 200
        await db_session.refresh(ical)
        assert ical.status == "available"
        assert ical.enabled is False


class TestConnectNeedsADestination:
    @pytest.mark.parametrize(("itype", "key", "url"), _DESTINATIONS)
    @pytest.mark.parametrize("blank", ["", "   "])
    async def test_a_blank_destination_is_refused_on_first_connect(
        self,
        db_session: AsyncSession,
        user: User,
        itype: str,
        key: str,
        url: str,
        blank: str,
    ) -> None:
        row = await _row(db_session, user, itype)
        async with _client(db_session, user) as client:
            response = await client.post(
                f"/integrations/{row.id}/connect", json={"config": {key: blank}}
            )
        assert response.status_code == 422
        await db_session.refresh(row)
        assert row.status == "available"
        assert row.enabled is False

    @pytest.mark.parametrize(("itype", "key", "url"), _DESTINATIONS)
    async def test_a_destination_connects(
        self, db_session: AsyncSession, user: User, itype: str, key: str, url: str
    ) -> None:
        row = await _row(db_session, user, itype)
        async with _client(db_session, user) as client:
            response = await client.post(
                f"/integrations/{row.id}/connect", json={"config": {key: url}}
            )
        assert response.status_code == 200
        await db_session.refresh(row)
        assert row.status == "connected"
        assert row.enabled is True

    @pytest.mark.parametrize(("itype", "key", "url"), _DESTINATIONS)
    async def test_a_reconnect_keeps_the_stored_destination(
        self, db_session: AsyncSession, user: User, itype: str, key: str, url: str
    ) -> None:
        row = await _row(db_session, user, itype)
        async with _client(db_session, user) as client:
            first = await client.post(
                f"/integrations/{row.id}/connect", json={"config": {key: url}}
            )
            gone = await client.post(f"/integrations/{row.id}/disconnect")
            # A secret is kept by sending it blank; the generic webhook's URL is
            # public config, where a blank is the value, so it is left out.
            keep = {key: ""} if key in SECRET_CONFIG_KEYS else {}
            again = await client.post(
                f"/integrations/{row.id}/connect", json={"config": keep}
            )
        assert (first.status_code, gone.status_code, again.status_code) == (
            200,
            200,
            200,
        )
        await db_session.refresh(row)
        assert row.status == "connected"
        stored = row.get_secret(key) or (row.config or {}).get(key)
        assert stored == url

    async def test_a_blank_on_a_connected_integration_still_means_keep(
        self, db_session: AsyncSession, user: User
    ) -> None:
        row = await _row(db_session, user, "slack")
        url = "https://hooks.slack.com/services/T0/B0/x"
        async with _client(db_session, user) as client:
            await client.post(
                f"/integrations/{row.id}/connect", json={"config": {"webhook_url": url}}
            )
            response = await client.patch(
                f"/integrations/{row.id}",
                json={"config": {"webhook_url": "", "channel": "#ops"}},
            )
        assert response.status_code == 200
        await db_session.refresh(row)
        assert row.get_secret("webhook_url") == url
        assert (row.config or {}).get("channel") == "#ops"

    async def test_an_integration_without_a_destination_still_connects(
        self, db_session: AsyncSession, user: User
    ) -> None:
        row = await _row(db_session, user, "ical")
        async with _client(db_session, user) as client:
            response = await client.post(
                f"/integrations/{row.id}/connect", json={"config": {}}
            )
        assert response.status_code == 200

    async def test_clearing_the_generic_webhook_url_on_a_connected_one_is_refused(
        self, db_session: AsyncSession, user: User
    ) -> None:
        row = await _row(db_session, user, "generic-webhook")
        async with _client(db_session, user) as client:
            await client.post(
                f"/integrations/{row.id}/connect",
                json={"config": {"url": "https://example.org/hook"}},
            )
            blank = await client.patch(
                f"/integrations/{row.id}", json={"config": {"url": ""}}
            )
            other = await client.patch(
                f"/integrations/{row.id}",
                json={"config": {"event_types": ["shift.created"]}},
            )
        assert blank.status_code == 422
        assert other.status_code == 200
        await db_session.refresh(row)
        assert (row.config or {}).get("url") == "https://example.org/hook"
