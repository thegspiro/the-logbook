"""Connecting Outlook (Microsoft 365): the OAuth sign-in, the calendar it
creates, the Test button and disconnecting.

Mirrors ``test_google_calendar_connect.py``: an attempt is bound to its
organization, integration and administrator, works once and expires; the
department's own client and tenant override the deployment's Azure AD app.
Microsoft has no per-grant revocation, so nothing is revoked.
"""

import json
import time
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.api.v1.endpoints import integrations as int_ep
from app.api.v1.endpoints import outlook_calendar_oauth as outlook_ep
from app.core.config import settings
from app.models.integration import Integration
from app.schemas.integration import IntegrationConnectRequest
from app.services import calendar_sync_service as sync_svc
from app.services.integration_services import calendar_oauth_common as common
from app.services.integration_services import outlook_calendar_oauth_service as oauth
from app.services.integration_services import (
    test_integration_connection as run_connection_test,
)
from app.services.integration_services.calendar_common import CalendarError
from app.services.integration_services.outlook_calendar_service import (
    OutlookCalendarService,
)
from tests.test_google_calendar_connect import (
    _admin,
    _factory,
    _mapping,
    _mapping_count,
    _org,
    _request,
)

CLIENT_ID = "00000000-0000-0000-0000-00000000c1d0"
CLIENT_SECRET = "deploy-secret"
TENANT = "11111111-2222-3333-4444-555555555555"


def _row(**kw) -> Integration:
    return Integration(
        id=kw.pop("id", str(uuid.uuid4())),
        organization_id=kw.pop("organization_id", "org-1"),
        integration_type="outlook",
        name="Microsoft Outlook",
        category="Calendar",
        status=kw.pop("status", "available"),
        enabled=kw.pop("enabled", False),
        config=kw.pop("config", {}),
    )


def _id_token(
    aud: str = CLIENT_ID,
    *,
    iss: str = f"https://login.microsoftonline.com/{TENANT}/v2.0",
    **claims,
) -> str:
    payload = {"iss": iss, "aud": aud, **claims}
    if "email" not in claims and "preferred_username" not in claims:
        payload["email"] = "calendar@dept.org"
    return jwt.encode(payload, "unverified-signing-key-" + "x" * 16, "HS256")


def _token_handler(seen: list[httpx.Request], **overrides):
    body = {
        "token_type": "Bearer",
        "access_token": "eyJ.fresh-access",
        "refresh_token": "M.fresh-refresh",
        "expires_in": 3599,
        "scope": "https://graph.microsoft.com/Calendars.ReadWrite openid email",
        "id_token": _id_token(),
        **overrides,
    }
    status_code = body.pop("_status", 200)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status_code, json=body)

    return handler


@pytest.fixture
def _deployment_client():
    with (
        patch.object(settings, "AZURE_AD_CLIENT_ID", CLIENT_ID),
        patch.object(settings, "AZURE_AD_CLIENT_SECRET", CLIENT_SECRET),
        patch.object(settings, "AZURE_AD_TENANT_ID", TENANT),
        patch.object(settings, "MICROSOFT_CALENDAR_REDIRECT_URI", None),
        patch.object(settings, "FRONTEND_URL", "https://logbook.test"),
    ):
        yield


# ============================================
# The OAuth service
# ============================================


@pytest.mark.unit
@pytest.mark.usefixtures("_deployment_client")
class TestClientCredentials:
    def test_deployment_app_and_tenant_by_default(self):
        assert oauth.get_client_credentials(_row()) == (
            CLIENT_ID,
            CLIENT_SECRET,
            TENANT,
        )

    def test_without_a_tenant_the_organizations_endpoint(self):
        with patch.object(settings, "AZURE_AD_TENANT_ID", None):
            assert oauth.get_client_credentials(_row())[2] == "organizations"

    def test_department_app_and_tenant_override(self):
        row = _row(config={"tenant_id": "dept-tenant"})
        row.set_secret("client_id", "dept-client")
        row.set_secret("client_secret", "dept-secret")
        assert oauth.get_client_credentials(row) == (
            "dept-client",
            "dept-secret",
            "dept-tenant",
        )

    def test_department_app_never_borrows_the_deployment_tenant(self):
        # A department's app is registered in its own tenant; the
        # deployment's single-tenant authority would refuse it.
        row = _row()
        row.set_secret("client_id", "dept-client")
        row.set_secret("client_secret", "dept-secret")
        assert oauth.get_client_credentials(row)[2] == "organizations"

    def test_a_tenant_stored_as_a_secret_is_still_read(self):
        row = _row()
        row.set_secret("tenant_id", "legacy-tenant")
        assert oauth.get_client_credentials(row)[2] == "legacy-tenant"

    def test_no_app_refuses_to_begin(self):
        with (
            patch.object(settings, "AZURE_AD_CLIENT_ID", None),
            patch.object(settings, "AZURE_AD_CLIENT_SECRET", None),
        ):
            with pytest.raises(common.CalendarOAuthError):
                oauth.begin(_row(), user_id="u", redirect_uri="https://x/cb")

    def test_the_reconciler_uses_the_same_client_and_tenant(self):
        row = _row(config={"tenant_id": "dept-tenant", "calendar_id": "cal"})
        row.set_secret("refresh_token", "r")
        service = sync_svc.default_service_factory(row)
        assert isinstance(service, OutlookCalendarService)
        creds = service._credentials
        assert creds["client_id"] == CLIENT_ID
        assert creds["client_secret"] == CLIENT_SECRET
        assert creds["tenant_id"] == "dept-tenant"


@pytest.mark.unit
@pytest.mark.usefixtures("_deployment_client")
class TestBegin:
    def test_authorization_url(self):
        row = _row()
        url, nonce = oauth.begin(row, user_id="user-1", redirect_uri="https://x/cb")
        parsed = urlparse(url)
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == (
            f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/authorize"
        )
        q = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        scopes = q["scope"].split()
        assert set(scopes) == {
            "offline_access",
            "openid",
            "email",
            "https://graph.microsoft.com/Calendars.ReadWrite",
        }
        assert q["client_id"] == CLIENT_ID
        assert q["redirect_uri"] == "https://x/cb"
        assert q["code_challenge_method"] == "S256"
        assert q["prompt"] == "select_account"

        pending = json.loads(row.get_secret(common.PENDING_SECRET))
        assert pending["nonce"] == nonce
        state = oauth.decode_state(q["state"])
        assert state["int"] == row.id
        assert state["usr"] == "user-1"
        assert state["purpose"] == "outlook_calendar_oauth"

    def test_department_tenant_in_the_authority(self):
        row = _row(config={"tenant_id": "dept.onmicrosoft.com"})
        url, _ = oauth.begin(row, user_id="u", redirect_uri="https://x/cb")
        assert url.startswith(
            "https://login.microsoftonline.com/dept.onmicrosoft.com/oauth2/v2.0/"
        )

    def test_a_google_state_cannot_finish_an_outlook_attempt(self):
        google_state = jwt.encode(
            {
                "purpose": "google_calendar_oauth",
                "exp": int(time.time()) + 60,
            },
            settings.SECRET_KEY,
            algorithm="HS256",
        )
        with pytest.raises(common.CalendarOAuthError, match="invalid_state"):
            oauth.decode_state(google_state)


@pytest.mark.unit
@pytest.mark.usefixtures("_deployment_client")
class TestExchange:
    async def _exchange(self, row, handler):
        return await oauth.exchange_code(
            row,
            code="auth-code",
            redirect_uri="https://x/cb",
            code_verifier="verifier",
            client_factory=_factory(handler),
        )

    async def test_success(self):
        seen: list[httpx.Request] = []
        out = await self._exchange(_row(), _token_handler(seen))
        assert out["refresh_token"] == "M.fresh-refresh"
        assert out["access_token"] == "eyJ.fresh-access"
        assert out["account_email"] == "calendar@dept.org"
        assert out["expires_at"] > datetime.now(timezone.utc)
        assert str(seen[0].url) == (
            f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
        )
        form = parse_qs(seen[0].content.decode())
        assert form["grant_type"] == ["authorization_code"]
        assert form["code_verifier"] == ["verifier"]
        assert form["client_id"] == [CLIENT_ID]

    async def test_department_app_and_tenant_are_used(self):
        row = _row(config={"tenant_id": "dept-tenant"})
        row.set_secret("client_id", "dept-client")
        row.set_secret("client_secret", "dept-secret")
        seen: list[httpx.Request] = []
        out = await self._exchange(
            row, _token_handler(seen, id_token=_id_token(aud="dept-client"))
        )
        assert seen[0].url.path == "/dept-tenant/oauth2/v2.0/token"
        form = parse_qs(seen[0].content.decode())
        assert form["client_id"] == ["dept-client"]
        assert form["client_secret"] == ["dept-secret"]
        assert out["account_email"] == "calendar@dept.org"

    async def test_preferred_username_when_no_email_claim(self):
        token = _id_token(preferred_username="chief@dept.org")
        out = await self._exchange(_row(), _token_handler([], id_token=token))
        assert out["account_email"] == "chief@dept.org"

    @pytest.mark.parametrize(
        "token",
        [
            _id_token(aud="someone-else"),
            _id_token(iss="https://accounts.google.com"),
            "not-a-jwt",
        ],
    )
    async def test_an_id_token_not_for_this_app_is_not_read(self, token):
        out = await self._exchange(_row(), _token_handler([], id_token=token))
        assert out["account_email"] is None

    async def test_short_scope_names_are_accepted(self):
        out = await self._exchange(
            _row(), _token_handler([], scope="Calendars.ReadWrite openid")
        )
        assert out["refresh_token"]

    async def test_no_refresh_token(self):
        with pytest.raises(common.CalendarOAuthError, match="no_refresh_token"):
            await self._exchange(_row(), _token_handler([], refresh_token=None))

    async def test_calendar_permission_not_granted(self):
        with pytest.raises(
            common.CalendarOAuthError, match="calendar_scope_not_granted"
        ):
            await self._exchange(_row(), _token_handler([], scope="openid email"))

    async def test_microsoft_refuses(self):
        with pytest.raises(common.CalendarOAuthError, match="token_exchange"):
            await self._exchange(
                _row(), _token_handler([], _status=400, error="invalid_grant")
            )

    async def test_microsoft_unreachable(self):
        def down(request):
            raise httpx.ConnectError("down")

        with pytest.raises(common.CalendarOAuthError, match="token_exchange"):
            await self._exchange(_row(), down)


# ============================================
# The connector: calendar_exists and the Test button
# ============================================


def _graph(responses):
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        return responses.pop(0)

    return _factory(handler), seen


@pytest.mark.unit
class TestConnector:
    async def test_calendar_exists(self):
        factory, seen = _graph([httpx.Response(200, json={"id": "c/1"})])
        service = OutlookCalendarService({"token": "t"}, client_factory=factory)
        assert await service.calendar_exists("c/1") is True
        assert seen[0].method == "GET"
        assert seen[0].url.raw_path == b"/v1.0/me/calendars/c%2F1"

    async def test_a_deleted_calendar_does_not_exist(self):
        factory, _ = _graph([httpx.Response(404)])
        service = OutlookCalendarService({"token": "t"}, client_factory=factory)
        assert await service.calendar_exists("gone") is False

    async def test_test_reads_the_department_calendar(self):
        factory, seen = _graph(
            [httpx.Response(200, json={"id": "cal", "name": "Falls Station Events"})]
        )
        service = OutlookCalendarService(
            {"token": "t", "calendar_id": "cal"}, client_factory=factory
        )
        assert await service.test_connection() == (
            "Connected to Outlook (publishing to Falls Station Events)"
        )
        assert seen[0].url.path == "/v1.0/me/calendars/cal"

    async def test_test_button_refreshes_with_the_deployment_app(self):
        """A lapsed access token is refreshed with the deployment's app.

        The stored row carries no client of its own, so before the Test path
        shared the reconciler's credentials it could not refresh at all.
        """
        row = _row(
            status="connected",
            enabled=True,
            config={
                "calendar_id": "cal",
                "token_expires_at": "2020-01-01T00:00:00+00:00",
            },
        )
        row.set_secret("refresh_token", "M.r")
        row.set_secret("access_token", "stale")
        seen: list[httpx.Request] = []

        def handler(request):
            seen.append(request)
            if request.url.host == "login.microsoftonline.com":
                return httpx.Response(
                    200, json={"access_token": "fresh", "expires_in": 3600}
                )
            return httpx.Response(200, json={"name": "Dept Events"})

        real_factory = sync_svc.default_service_factory

        def with_fake_transport(integration):
            # The connector binds its HTTP client factory at import, so the
            # fake transport is swapped in on the service the real factory
            # built — credentials, client and tenant untouched.
            service = real_factory(integration)
            service._client_factory = _factory(handler)
            return service

        with (
            patch.object(settings, "AZURE_AD_CLIENT_ID", CLIENT_ID),
            patch.object(settings, "AZURE_AD_CLIENT_SECRET", CLIENT_SECRET),
            patch.object(settings, "AZURE_AD_TENANT_ID", TENANT),
            patch.object(sync_svc, "default_service_factory", with_fake_transport),
        ):
            result = await run_connection_test(row)
        assert result == "Connected to Outlook (publishing to Dept Events)"
        assert seen[0].url.path == f"/{TENANT}/oauth2/v2.0/token"
        form = parse_qs(seen[0].content.decode())
        assert form["client_id"] == [CLIENT_ID]
        assert seen[1].headers["authorization"] == "Bearer fresh"


# ============================================
# Database-backed: the endpoints
# ============================================


async def _outlook(db, org_id: str, **kw) -> Integration:
    row = Integration(
        organization_id=org_id,
        integration_type="outlook",
        name="Microsoft Outlook",
        category="Calendar",
        status=kw.pop("status", "available"),
        enabled=kw.pop("enabled", False),
        config=kw.pop("config", {}),
    )
    db.add(row)
    await db.flush()
    return row


async def _start(db, admin) -> tuple[str, str, str]:
    resp = await outlook_ep.start_outlook_calendar_connect(
        _request(), db=db, current_user=admin
    )
    url = json.loads(bytes(resp.body))["authorization_url"]
    cookie = resp.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "Path=/api/v1/integrations/outlook/" in cookie
    nonce = cookie.split(";")[0].split("=", 1)[1]
    state = parse_qs(urlparse(url).query)["state"][0]
    return state, nonce, url


async def _callback(db, state, nonce, *, code="auth-code", error=None):
    resp = await outlook_ep.outlook_calendar_oauth_callback(
        _request(),
        code=code,
        state=state,
        error=error,
        nonce_cookie=nonce,
        db=db,
    )
    assert resp.status_code == 302
    return resp.headers["location"]


@pytest.fixture
def microsoft(_deployment_client):
    """Microsoft's token endpoint and Graph, faked."""
    seen: list[httpx.Request] = []
    create = AsyncMock(return_value="AAMkNewCalendar=")
    exists = AsyncMock(return_value=True)
    audit = AsyncMock()
    with (
        patch.object(settings, "CALENDAR_SYNC_ENABLED", True),
        patch.object(
            oauth, "create_integration_client", _factory(_token_handler(seen))
        ),
        patch.object(OutlookCalendarService, "create_calendar", create),
        patch.object(OutlookCalendarService, "calendar_exists", exists),
        patch.object(outlook_ep, "log_audit_event", audit),
        patch.object(int_ep, "log_audit_event", audit),
    ):
        yield SimpleNamespace(seen=seen, create=create, exists=exists, audit=audit)


@pytest.mark.integration
class TestStart:
    @pytest.mark.usefixtures("_deployment_client")
    async def test_refused_while_the_flag_is_off(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _outlook(db_session, org_id)
        with patch.object(settings, "CALENDAR_SYNC_ENABLED", False):
            with pytest.raises(HTTPException) as excinfo:
                await outlook_ep.start_outlook_calendar_connect(
                    _request(), db=db_session, current_user=admin
                )
        assert excinfo.value.status_code == 400

    async def test_refused_without_an_app(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _outlook(db_session, org_id)
        with (
            patch.object(settings, "CALENDAR_SYNC_ENABLED", True),
            patch.object(settings, "AZURE_AD_CLIENT_ID", None),
            patch.object(settings, "AZURE_AD_CLIENT_SECRET", None),
        ):
            with pytest.raises(HTTPException) as excinfo:
                await outlook_ep.start_outlook_calendar_connect(
                    _request(), db=db_session, current_user=admin
                )
        assert excinfo.value.status_code == 400
        assert "AZURE_AD_CLIENT_ID" in excinfo.value.detail

    async def test_derived_and_configured_redirect_uri(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(db_session, org_id)
        await _start(db_session, admin)
        pending = json.loads(row.get_secret(common.PENDING_SECRET))
        assert pending["redirect_uri"] == (
            "https://logbook.test/api/v1/integrations/outlook/oauth/callback"
        )
        configured = (
            "https://app.example.org/api/v1/integrations/outlook/oauth/callback"
        )
        with patch.object(settings, "MICROSOFT_CALENDAR_REDIRECT_URI", configured):
            _, _, url = await _start(db_session, admin)
        assert parse_qs(urlparse(url).query)["redirect_uri"] == [configured]

    async def test_department_override_including_tenant(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(db_session, org_id, config={"tenant_id": "dept-tenant"})
        row.set_secret("client_id", "dept-client")
        row.set_secret("client_secret", "dept-secret")
        _, _, url = await _start(db_session, admin)
        parsed = urlparse(url)
        assert parsed.path == "/dept-tenant/oauth2/v2.0/authorize"
        assert parse_qs(parsed.query)["client_id"] == ["dept-client"]


@pytest.mark.integration
class TestCallback:
    async def test_connects_and_creates_the_department_calendar(
        self, db_session, microsoft
    ):
        org_id = await _org(db_session, name="Falls Station")
        admin = await _admin(db_session, org_id)
        row = await _outlook(db_session, org_id, config={"sync_descriptions": True})
        state, nonce, _ = await _start(db_session, admin)

        location = await _callback(db_session, state, nonce)

        assert location == (
            "https://logbook.test/integrations?outlook_calendar=connected"
        )
        microsoft.create.assert_awaited_once_with("Falls Station Events")
        await db_session.refresh(row)
        assert row.status == "connected"
        assert row.enabled is True
        assert row.get_secret("refresh_token") == "M.fresh-refresh"
        assert row.get_secret("access_token") == "eyJ.fresh-access"
        assert row.get_secret(common.PENDING_SECRET) is None
        assert row.config["calendar_id"] == "AAMkNewCalendar="
        assert row.config["calendar_name"] == "Falls Station Events"
        assert row.config["account_email"] == "calendar@dept.org"
        assert datetime.fromisoformat(row.config["token_expires_at"])
        assert row.config["sync_descriptions"] is True
        assert "M.fresh-refresh" not in json.dumps(row.config)
        form = parse_qs(microsoft.seen[0].content.decode())
        assert form["code"] == ["auth-code"]
        assert microsoft.audit.await_args.args[1] == "integration.connected"
        assert microsoft.audit.await_args.args[4]["integration_type"] == "outlook"
        assert microsoft.audit.await_args.kwargs["user_id"] == admin.id

        # What the reconciler reads is what the connect flow wrote.
        assert sync_svc.has_credentials(row)
        service = sync_svc.default_service_factory(row)
        assert service._credentials["refresh_token"] == "M.fresh-refresh"
        assert service._credentials["tenant_id"] == TENANT
        listed = int_ep._integration_to_dict(row)
        assert listed["status"] == "connected"

    async def test_a_state_works_once(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _outlook(db_session, org_id)
        state, nonce, _ = await _start(db_session, admin)
        await _callback(db_session, state, nonce)
        replay = await _callback(db_session, state, nonce)
        assert replay.endswith("outlook_calendar_error=invalid_state")
        assert microsoft.create.await_count == 1

    async def test_the_nonce_cookie_must_match(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(db_session, org_id)
        state, _, _ = await _start(db_session, admin)
        for cookie in (None, "other-browser"):
            location = await _callback(db_session, state, cookie)
            assert location.endswith("outlook_calendar_error=invalid_state")
        assert row.status == "available"
        microsoft.create.assert_not_awaited()

    async def test_state_for_another_organization(self, db_session, microsoft):
        org_a = await _org(db_session)
        org_b = await _org(db_session, name="Other Dept")
        admin_a = await _admin(db_session, org_a)
        await _outlook(db_session, org_a)
        row_b = await _outlook(db_session, org_b)
        state, nonce, _ = await _start(db_session, admin_a)
        claims = jwt.decode(state, settings.SECRET_KEY, algorithms=["HS256"])
        claims["int"] = row_b.id
        forged = jwt.encode(claims, settings.SECRET_KEY, algorithm="HS256")
        location = await _callback(db_session, forged, nonce)
        assert location.endswith("outlook_calendar_error=integration_not_found")
        assert row_b.status == "available"

    async def test_state_naming_another_user(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        other = await _admin(db_session, org_id)
        await _outlook(db_session, org_id)
        state, nonce, _ = await _start(db_session, admin)
        claims = jwt.decode(state, settings.SECRET_KEY, algorithms=["HS256"])
        claims["usr"] = other.id
        forged = jwt.encode(claims, settings.SECRET_KEY, algorithm="HS256")
        location = await _callback(db_session, forged, nonce)
        assert location.endswith("outlook_calendar_error=invalid_state")
        microsoft.create.assert_not_awaited()

    async def test_expired_state(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _outlook(db_session, org_id)
        state, nonce, _ = await _start(db_session, admin)
        claims = jwt.decode(state, settings.SECRET_KEY, algorithms=["HS256"])
        claims["exp"] = int(time.time()) - 5
        expired = jwt.encode(claims, settings.SECRET_KEY, algorithm="HS256")
        location = await _callback(db_session, expired, nonce)
        assert location.endswith("outlook_calendar_error=invalid_state")

    async def test_administrator_who_lost_the_permission(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(db_session, org_id)
        state, nonce, _ = await _start(db_session, admin)
        await db_session.execute(
            text("UPDATE positions SET permissions = '[]' WHERE organization_id = :o"),
            {"o": org_id},
        )
        location = await _callback(db_session, state, nonce)
        assert location.endswith("outlook_calendar_error=not_authorized")
        assert row.get_secret("refresh_token") is None
        assert not microsoft.seen

    async def test_refused_when_the_flag_went_off(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _outlook(db_session, org_id)
        state, nonce, _ = await _start(db_session, admin)
        with patch.object(settings, "CALENDAR_SYNC_ENABLED", False):
            location = await _callback(db_session, state, nonce)
        assert location.endswith("outlook_calendar_error=unavailable")
        assert not microsoft.seen

    async def test_consent_declined(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(db_session, org_id)
        state, nonce, _ = await _start(db_session, admin)
        location = await _callback(
            db_session, state, nonce, code=None, error="consent_required&x=1"
        )
        assert location.endswith("outlook_calendar_error=consent_required%26x%3D1")
        assert row.get_secret(common.PENDING_SECRET) is None

    async def test_calendar_creation_failure_leaves_nothing_half_connected(
        self, db_session, microsoft
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(db_session, org_id)
        microsoft.create.side_effect = CalendarError("Outlook Calendar refused (403)")
        state, nonce, _ = await _start(db_session, admin)

        location = await _callback(db_session, state, nonce)

        assert location.endswith("outlook_calendar_error=calendar_create_failed")
        await db_session.refresh(row)
        assert row.status == "error"
        assert row.enabled is False
        assert row.get_secret("refresh_token") is None
        assert row.get_secret("access_token") is None
        assert "calendar_id" not in row.config
        assert "calendar could not be created" in row.last_error
        assert row.consecutive_error_count == 1
        # Only the token exchange went out: there is nothing to revoke with.
        assert len(microsoft.seen) == 1

    async def test_reconnect_keeps_a_surviving_calendar(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(
            db_session,
            org_id,
            status="error",
            config={"calendar_id": "old-cal", "account_email": "calendar@dept.org"},
        )
        await _mapping(db_session, row)
        state, nonce, _ = await _start(db_session, admin)
        await _callback(db_session, state, nonce)
        microsoft.exists.assert_awaited_once_with("old-cal")
        microsoft.create.assert_not_awaited()
        await db_session.refresh(row)
        assert row.status == "connected"
        assert row.config["calendar_id"] == "old-cal"
        assert await _mapping_count(db_session, row) == 1

    async def test_reconnect_after_the_calendar_was_deleted(
        self, db_session, microsoft
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(
            db_session,
            org_id,
            status="error",
            config={"calendar_id": "old-cal", "account_email": "calendar@dept.org"},
        )
        await _mapping(db_session, row)
        microsoft.exists.return_value = False
        state, nonce, _ = await _start(db_session, admin)
        await _callback(db_session, state, nonce)
        await db_session.refresh(row)
        assert row.config["calendar_id"] == "AAMkNewCalendar="
        assert await _mapping_count(db_session, row) == 0

    async def test_reconnect_with_a_different_account_starts_a_new_calendar(
        self, db_session, microsoft
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(
            db_session,
            org_id,
            status="error",
            config={"calendar_id": "old-cal", "account_email": "someone@else.org"},
        )
        state, nonce, _ = await _start(db_session, admin)
        await _callback(db_session, state, nonce)
        microsoft.exists.assert_not_awaited()
        await db_session.refresh(row)
        assert row.config["calendar_id"] == "AAMkNewCalendar="


@pytest.mark.integration
class TestGenericEndpoints:
    async def test_generic_connect_is_refused_for_outlook(self, db_session, microsoft):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(db_session, org_id)
        with pytest.raises(HTTPException) as excinfo:
            await int_ep.connect_integration(
                row.id,
                _request(),
                body=IntegrationConnectRequest(),
                db=db_session,
                current_user=admin,
            )
        assert excinfo.value.status_code == 400
        assert "Connect with Microsoft" in excinfo.value.detail
        assert row.status == "available"

    async def test_disconnect_clears_and_forgets_without_revoking(
        self, db_session, microsoft
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _outlook(db_session, org_id, config={"tenant_id": "dept-tenant"})
        row.set_secret("client_id", "dept-client")
        row.set_secret("client_secret", "dept-secret")
        state, nonce, _ = await _start(db_session, admin)
        with patch.object(
            oauth,
            "create_integration_client",
            _factory(
                _token_handler(microsoft.seen, id_token=_id_token(aud="dept-client"))
            ),
        ):
            await _callback(db_session, state, nonce)
        await _mapping(db_session, row)
        microsoft.seen.clear()

        result = await int_ep.disconnect_integration(
            row.id, _request(), db=db_session, current_user=admin
        )

        assert result == {"status": "disconnected"}
        await db_session.refresh(row)
        assert row.status == "available"
        assert row.enabled is False
        for key in ("refresh_token", "access_token", common.PENDING_SECRET):
            assert row.get_secret(key) is None
        # The department's own app is configuration, not the grant.
        assert row.get_secret("client_id") == "dept-client"
        assert row.config["tenant_id"] == "dept-tenant"
        for key in ("calendar_id", "account_email", "token_expires_at"):
            assert key not in row.config
        assert await _mapping_count(db_session, row) == 0
        # No call to Microsoft at all.
        assert not microsoft.seen
        details = microsoft.audit.await_args.args[4]
        assert details["grant_revoked"] is False
        assert details["calendar_mappings_removed"] == 1
