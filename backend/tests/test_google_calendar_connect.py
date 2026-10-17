"""Connecting Google Calendar: the OAuth sign-in, the calendar it creates, and
disconnecting.

The grant, the calendar and the signed-in account come only from Google's
sign-in, so the generic connect/update API refuses them; publishing is one
way, so only ``sync_direction: push`` is accepted. A connect attempt is bound
to its organization, integration and administrator, works once, and expires.
"""

import base64
import hashlib
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
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.endpoints import google_calendar_oauth as gcal_ep
from app.api.v1.endpoints import integrations as int_ep
from app.core.config import settings
from app.models.integration import CalendarSyncMapping, Integration
from app.schemas.integration import (
    IntegrationConnectRequest,
    IntegrationUpdateRequest,
)
from app.services.integration_services import google_calendar_oauth_service as oauth
from app.services.integration_services.calendar_common import CalendarError

CLIENT_ID = "deploy-client.apps.googleusercontent.com"
CLIENT_SECRET = "deploy-secret"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"


def _request(cookies: dict[str, str] | None = None) -> Request:
    headers = [(b"host", b"logbook.test")]
    if cookies:
        cookie = "; ".join(f"{k}={v}" for k, v in cookies.items())
        headers.append((b"cookie", cookie.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "https",
            "server": ("logbook.test", 443),
            "path": "/",
            "headers": headers,
            "client": ("203.0.113.9", 1234),
            "query_string": b"",
        }
    )


def _row(itype: str = "google-calendar", **kw) -> Integration:
    return Integration(
        id=kw.pop("id", str(uuid.uuid4())),
        organization_id=kw.pop("organization_id", "org-1"),
        integration_type=itype,
        name="Google Calendar" if itype == "google-calendar" else itype,
        category="Calendar",
        status=kw.pop("status", "available"),
        enabled=kw.pop("enabled", False),
        config=kw.pop("config", {}),
    )


def _id_token(aud: str = CLIENT_ID, email: str = "calendar@dept.org") -> str:
    return jwt.encode(
        {"iss": "https://accounts.google.com", "aud": aud, "email": email},
        "unverified-signing-key-" + "x" * 16,
        algorithm="HS256",
    )


def _token_handler(seen: list[httpx.Request], **overrides):
    body = {
        "access_token": "ya29.fresh-access",
        "refresh_token": "1//fresh-refresh",
        "expires_in": 3599,
        "scope": f"openid {CALENDAR_SCOPE} email",
        "id_token": _id_token(),
        **overrides,
    }
    status_code = body.pop("_status", 200)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/revoke":
            return httpx.Response(200)
        return httpx.Response(status_code, json=body)

    return handler


def _factory(handler):
    return lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture
def _deployment_client():
    with (
        patch.object(settings, "GOOGLE_CLIENT_ID", CLIENT_ID),
        patch.object(settings, "GOOGLE_CLIENT_SECRET", CLIENT_SECRET),
        patch.object(settings, "GOOGLE_CALENDAR_REDIRECT_URI", None),
        patch.object(settings, "FRONTEND_URL", "https://logbook.test"),
    ):
        yield


# ============================================
# The API refuses hand-typed grants, and publishing is push-only
# ============================================


@pytest.mark.unit
class TestConfigBoundaries:
    @pytest.mark.parametrize("itype", ["google-calendar", "outlook"])
    @pytest.mark.parametrize(
        "key",
        ["refresh_token", "access_token", "token", "calendar_id", "account_email"],
    )
    def test_oauth_managed_keys_are_refused(self, itype, key):
        with pytest.raises(HTTPException) as excinfo:
            int_ep._reject_oauth_managed_keys(_row(itype), {key: "typed-by-hand"})
        assert excinfo.value.status_code == 422
        assert key in excinfo.value.detail

    def test_other_integrations_keep_their_keys(self):
        int_ep._reject_oauth_managed_keys(_row("salesforce"), {"refresh_token": "x"})

    @pytest.mark.parametrize("itype", ["google-calendar", "outlook"])
    @pytest.mark.parametrize("direction", ["pull", "both", "PUSH", ""])
    def test_only_push_is_accepted(self, itype, direction):
        with pytest.raises(HTTPException) as excinfo:
            int_ep._validate_config(itype, {"sync_direction": direction})
        assert excinfo.value.status_code == 422

    @pytest.mark.parametrize("itype", ["google-calendar", "outlook"])
    def test_settings_an_administrator_may_change(self, itype):
        out = int_ep._validate_config(
            itype,
            {
                "sync_direction": "push",
                "sync_descriptions": True,
                "days_ahead": 90,
                "event_types_to_sync": ["training"],
                "client_id": "own-client",
                "client_secret": "own-secret",
            },
        )
        assert out["sync_descriptions"] is True
        assert out["days_ahead"] == 90

    def test_the_schema_has_no_token_or_calendar_fields(self):
        for key in ("refresh_token", "calendar_id"):
            with pytest.raises(HTTPException):
                int_ep._validate_config("google-calendar", {key: "x"})

    def test_a_stored_legacy_direction_does_not_block_a_later_change(self):
        row = _row(
            status="connected",
            config={
                "sync_direction": "both",
                "calendar_id": "cal-1",
                "account_email": "a@dept.org",
                "token_expires_at": "2026-10-16T00:00:00+00:00",
            },
        )
        stored = int_ep._stored_config_for_validation(row)
        assert stored == {}
        merged = {**stored, "sync_descriptions": True}
        assert int_ep._validate_config("google-calendar", merged) == {
            "sync_descriptions": True
        }
        # Reading the row is untouched by any of this.
        with patch.object(int_ep.settings, "CALENDAR_SYNC_ENABLED", True):
            assert int_ep._integration_to_dict(row)["config"]["sync_direction"] == (
                "both"
            )


@pytest.mark.unit
class TestEffectiveStatus:
    @pytest.fixture(autouse=True)
    def _flag_on(self):
        with patch.object(int_ep.settings, "CALENDAR_SYNC_ENABLED", True):
            yield

    def test_connected_without_a_grant_reads_available(self):
        row = _row(status="connected", enabled=True, config={"calendar_id": "c"})
        out = int_ep._integration_to_dict(row)
        assert out["status"] == "available"
        assert out["enabled"] is False

    def test_connected_with_grant_and_calendar_reads_connected(self):
        row = _row(status="connected", enabled=True, config={"calendar_id": "c"})
        row.set_secret("refresh_token", "r")
        out = int_ep._integration_to_dict(row)
        assert out["status"] == "connected"
        assert out["enabled"] is True

    def test_error_stays_error(self):
        assert int_ep._integration_to_dict(_row(status="error"))["status"] == "error"


# ============================================
# The OAuth service
# ============================================


@pytest.mark.unit
@pytest.mark.usefixtures("_deployment_client")
class TestClientCredentials:
    def test_deployment_client_by_default(self):
        assert oauth.get_client_credentials(_row()) == (CLIENT_ID, CLIENT_SECRET)

    def test_department_client_overrides(self):
        row = _row()
        row.set_secret("client_id", "dept-client")
        row.set_secret("client_secret", "dept-secret")
        assert oauth.get_client_credentials(row) == ("dept-client", "dept-secret")

    def test_no_client_refuses_to_begin(self):
        with (
            patch.object(settings, "GOOGLE_CLIENT_ID", None),
            patch.object(settings, "GOOGLE_CLIENT_SECRET", None),
        ):
            with pytest.raises(oauth.GoogleCalendarOAuthError):
                oauth.begin(_row(), user_id="u", redirect_uri="https://x/cb")


@pytest.mark.unit
@pytest.mark.usefixtures("_deployment_client")
class TestBegin:
    def test_authorization_url(self):
        row = _row()
        url, nonce = oauth.begin(row, user_id="user-1", redirect_uri="https://x/cb")
        parsed = urlparse(url)
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == (
            oauth.AUTHORIZE_URL
        )
        q = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        assert q["scope"] == f"{CALENDAR_SCOPE} openid email"
        assert q["access_type"] == "offline"
        assert q["prompt"] == "consent"
        assert q["client_id"] == CLIENT_ID
        assert q["redirect_uri"] == "https://x/cb"
        assert q["code_challenge_method"] == "S256"

        pending = json.loads(row.get_secret(oauth.PENDING_SECRET))
        assert pending["nonce"] == nonce
        assert pending["user_id"] == "user-1"
        digest = hashlib.sha256(pending["code_verifier"].encode()).digest()
        assert q["code_challenge"] == (
            base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        )

        state = oauth.decode_state(q["state"])
        assert state["org"] == "org-1"
        assert state["int"] == row.id
        assert state["usr"] == "user-1"
        assert state["nonce"] == nonce
        assert state["exp"] <= time.time() + oauth.STATE_TTL_SECONDS

    def test_a_newer_attempt_replaces_the_older(self):
        row = _row()
        _, first = oauth.begin(row, user_id="u", redirect_uri="https://x/cb")
        _, second = oauth.begin(row, user_id="u", redirect_uri="https://x/cb")
        with pytest.raises(oauth.GoogleCalendarOAuthError):
            oauth.consume_pending(row, nonce=first, user_id="u")
        _, third = oauth.begin(row, user_id="u", redirect_uri="https://x/cb")
        assert oauth.consume_pending(row, nonce=third, user_id="u")["nonce"] == third


@pytest.mark.unit
@pytest.mark.usefixtures("_deployment_client")
class TestStateAndPending:
    def _state(self, **claims):
        payload = {
            "purpose": "google_calendar_oauth",
            "org": "org-1",
            "int": "int-1",
            "usr": "u",
            "nonce": "n",
            "exp": int(time.time()) + 60,
            **claims,
        }
        return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")

    def test_expired_state(self):
        with pytest.raises(oauth.GoogleCalendarOAuthError, match="invalid_state"):
            oauth.decode_state(self._state(exp=int(time.time()) - 1))

    def test_other_purpose(self):
        with pytest.raises(oauth.GoogleCalendarOAuthError):
            oauth.decode_state(self._state(purpose="salesforce_oauth"))

    def test_forged_signature(self):
        forged = jwt.encode(
            {"purpose": "google_calendar_oauth", "exp": int(time.time()) + 60},
            "attacker-signing-key-" + "x" * 16,
            algorithm="HS256",
        )
        with pytest.raises(oauth.GoogleCalendarOAuthError):
            oauth.decode_state(forged)

    def test_wrong_user_consumes_and_fails(self):
        row = _row()
        _, nonce = oauth.begin(row, user_id="admin", redirect_uri="https://x/cb")
        with pytest.raises(oauth.GoogleCalendarOAuthError):
            oauth.consume_pending(row, nonce=nonce, user_id="someone-else")
        # The attempt is gone, so the right user cannot finish it either.
        with pytest.raises(oauth.GoogleCalendarOAuthError):
            oauth.consume_pending(row, nonce=nonce, user_id="admin")

    def test_replay(self):
        row = _row()
        _, nonce = oauth.begin(row, user_id="u", redirect_uri="https://x/cb")
        oauth.consume_pending(row, nonce=nonce, user_id="u")
        with pytest.raises(oauth.GoogleCalendarOAuthError):
            oauth.consume_pending(row, nonce=nonce, user_id="u")

    def test_expired_pending(self):
        row = _row()
        _, nonce = oauth.begin(row, user_id="u", redirect_uri="https://x/cb")
        pending = json.loads(row.get_secret(oauth.PENDING_SECRET))
        pending["exp"] = int(time.time()) - 1
        row.set_secret(oauth.PENDING_SECRET, json.dumps(pending))
        with pytest.raises(oauth.GoogleCalendarOAuthError, match="expired_state"):
            oauth.consume_pending(row, nonce=nonce, user_id="u")


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
        assert out["refresh_token"] == "1//fresh-refresh"
        assert out["access_token"] == "ya29.fresh-access"
        assert out["account_email"] == "calendar@dept.org"
        assert out["expires_at"] > datetime.now(timezone.utc)
        form = parse_qs(seen[0].content.decode())
        assert form["grant_type"] == ["authorization_code"]
        assert form["code_verifier"] == ["verifier"]
        assert form["client_id"] == [CLIENT_ID]

    async def test_department_client_is_used(self):
        row = _row()
        row.set_secret("client_id", "dept-client")
        row.set_secret("client_secret", "dept-secret")
        seen: list[httpx.Request] = []
        out = await self._exchange(
            row, _token_handler(seen, id_token=_id_token(aud="dept-client"))
        )
        form = parse_qs(seen[0].content.decode())
        assert form["client_id"] == ["dept-client"]
        assert form["client_secret"] == ["dept-secret"]
        assert out["account_email"] == "calendar@dept.org"

    async def test_id_token_for_another_client_is_not_read(self):
        out = await self._exchange(
            _row(), _token_handler([], id_token=_id_token(aud="someone-else"))
        )
        assert out["account_email"] is None

    async def test_no_refresh_token(self):
        with pytest.raises(oauth.GoogleCalendarOAuthError, match="no_refresh_token"):
            await self._exchange(_row(), _token_handler([], refresh_token=None))

    async def test_calendar_permission_unticked(self):
        with pytest.raises(
            oauth.GoogleCalendarOAuthError, match="calendar_scope_not_granted"
        ):
            await self._exchange(_row(), _token_handler([], scope="openid email"))

    async def test_google_refuses(self):
        with pytest.raises(oauth.GoogleCalendarOAuthError, match="token_exchange"):
            await self._exchange(
                _row(), _token_handler([], _status=400, error="invalid_grant")
            )

    async def test_revoke_is_best_effort(self):
        seen: list[httpx.Request] = []
        assert await oauth.revoke_token(
            "1//r", client_factory=_factory(_token_handler(seen))
        )
        assert parse_qs(seen[0].content.decode()) == {"token": ["1//r"]}

        def broken(request):
            raise httpx.ConnectError("down")

        assert not await oauth.revoke_token("1//r", client_factory=_factory(broken))
        assert not await oauth.revoke_token(None)


# ============================================
# Database-backed: the endpoints
# ============================================


async def _org(db, name: str = "Falls Station") -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": name, "slug": f"gcal-{org_id[:8]}"},
    )
    return org_id


async def _admin(db, org_id: str, permissions=("integrations.manage",)):
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Cal', 'Admin', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"gcal-{user_id[:8]}",
            "em": f"gcal-{user_id[:8]}@test.com",
        },
    )
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Integrations Admin', :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "slug": f"p-{position_id[:8]}",
            "perms": json.dumps(list(permissions)),
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    return SimpleNamespace(id=user_id, organization_id=org_id)


async def _gcal(db, org_id: str, **kw) -> Integration:
    row = Integration(
        organization_id=org_id,
        integration_type="google-calendar",
        name="Google Calendar",
        category="Calendar",
        status=kw.pop("status", "available"),
        enabled=kw.pop("enabled", False),
        config=kw.pop("config", {}),
    )
    db.add(row)
    await db.flush()
    return row


async def _mapping(db, row: Integration) -> None:
    db.add(
        CalendarSyncMapping(
            organization_id=row.organization_id,
            integration_id=row.id,
            event_id=str(uuid.uuid4()),
            external_event_id="evt",
            external_calendar_id=(row.config or {}).get("calendar_id"),
            content_hash="h",
        )
    )
    await db.flush()


async def _mapping_count(db, row: Integration) -> int:
    rows = await db.execute(
        select(CalendarSyncMapping).where(CalendarSyncMapping.integration_id == row.id)
    )
    return len(rows.scalars().all())


async def _start(db, admin) -> tuple[str, str]:
    resp = await gcal_ep.start_google_calendar_connect(
        _request(), db=db, current_user=admin
    )
    url = json.loads(bytes(resp.body))["authorization_url"]
    cookie = resp.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "Path=/api/v1/integrations/google-calendar/" in cookie
    nonce = cookie.split(";")[0].split("=", 1)[1]
    state = parse_qs(urlparse(url).query)["state"][0]
    return state, nonce


async def _callback(db, state, nonce, *, code="auth-code", error=None):
    resp = await gcal_ep.google_calendar_oauth_callback(
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
def google(_deployment_client):
    """Google's token endpoint and Calendar API, faked."""
    seen: list[httpx.Request] = []
    create = AsyncMock(return_value="new-cal@group.calendar.google.com")
    exists = AsyncMock(return_value=True)
    audit = AsyncMock()
    with (
        patch.object(settings, "CALENDAR_SYNC_ENABLED", True),
        patch.object(
            oauth, "create_integration_client", _factory(_token_handler(seen))
        ),
        patch.object(gcal_ep.GoogleCalendarService, "create_calendar", create),
        patch.object(gcal_ep.GoogleCalendarService, "calendar_exists", exists),
        patch.object(gcal_ep, "log_audit_event", audit),
        patch.object(int_ep, "log_audit_event", audit),
    ):
        yield SimpleNamespace(seen=seen, create=create, exists=exists, audit=audit)


@pytest.mark.integration
class TestStart:
    @pytest.mark.usefixtures("_deployment_client")
    async def test_refused_while_the_flag_is_off(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _gcal(db_session, org_id)
        with patch.object(settings, "CALENDAR_SYNC_ENABLED", False):
            with pytest.raises(HTTPException) as excinfo:
                await gcal_ep.start_google_calendar_connect(
                    _request(), db=db_session, current_user=admin
                )
        assert excinfo.value.status_code == 400

    async def test_refused_without_an_oauth_client(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _gcal(db_session, org_id)
        with (
            patch.object(settings, "CALENDAR_SYNC_ENABLED", True),
            patch.object(settings, "GOOGLE_CLIENT_ID", None),
            patch.object(settings, "GOOGLE_CLIENT_SECRET", None),
        ):
            with pytest.raises(HTTPException) as excinfo:
                await gcal_ep.start_google_calendar_connect(
                    _request(), db=db_session, current_user=admin
                )
        assert excinfo.value.status_code == 400

    async def test_derived_redirect_uri(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(db_session, org_id)
        await _start(db_session, admin)
        pending = json.loads(row.get_secret(oauth.PENDING_SECRET))
        assert pending["redirect_uri"] == (
            "https://logbook.test/api/v1/integrations/google-calendar/oauth/callback"
        )


@pytest.mark.integration
class TestCallback:
    async def test_connects_and_creates_the_department_calendar(
        self, db_session, google
    ):
        org_id = await _org(db_session, name="Falls Station")
        admin = await _admin(db_session, org_id)
        row = await _gcal(db_session, org_id, config={"sync_descriptions": True})
        state, nonce = await _start(db_session, admin)

        location = await _callback(db_session, state, nonce)

        assert location == "https://logbook.test/integrations?google_calendar=connected"
        google.create.assert_awaited_once_with("Falls Station Events")
        await db_session.refresh(row)
        assert row.status == "connected"
        assert row.enabled is True
        assert row.get_secret("refresh_token") == "1//fresh-refresh"
        assert row.get_secret("access_token") == "ya29.fresh-access"
        assert row.get_secret(oauth.PENDING_SECRET) is None
        assert row.config["calendar_id"] == "new-cal@group.calendar.google.com"
        assert row.config["calendar_name"] == "Falls Station Events"
        assert row.config["account_email"] == "calendar@dept.org"
        assert datetime.fromisoformat(row.config["token_expires_at"])
        assert row.config["sync_descriptions"] is True
        # Tokens are never in public config.
        assert "1//fresh-refresh" not in json.dumps(row.config)
        form = parse_qs(google.seen[0].content.decode())
        assert form["code"] == ["auth-code"]
        assert google.audit.await_args.args[1] == "integration.connected"
        assert google.audit.await_args.kwargs["user_id"] == admin.id
        assert google.audit.await_args.kwargs["organization_id"] == org_id

    async def test_a_state_works_once(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _gcal(db_session, org_id)
        state, nonce = await _start(db_session, admin)
        await _callback(db_session, state, nonce)
        replay = await _callback(db_session, state, nonce)
        assert replay.endswith("google_calendar_error=invalid_state")
        assert google.create.await_count == 1

    async def test_the_nonce_cookie_must_match(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(db_session, org_id)
        state, _ = await _start(db_session, admin)
        for cookie in (None, "other-browser"):
            location = await _callback(db_session, state, cookie)
            assert location.endswith("google_calendar_error=invalid_state")
        assert row.status == "available"
        google.create.assert_not_awaited()

    async def test_state_for_another_organization(self, db_session, google):
        org_a = await _org(db_session)
        org_b = await _org(db_session, name="Other Dept")
        admin_a = await _admin(db_session, org_a)
        await _gcal(db_session, org_a)
        row_b = await _gcal(db_session, org_b)
        state, nonce = await _start(db_session, admin_a)
        claims = jwt.decode(state, settings.SECRET_KEY, algorithms=["HS256"])
        # Even a correctly signed state naming org B's row with org A's org
        # finds nothing: the integration is looked up within the state's org.
        claims["int"] = row_b.id
        forged = jwt.encode(claims, settings.SECRET_KEY, algorithm="HS256")
        location = await _callback(db_session, forged, nonce)
        assert location.endswith("google_calendar_error=integration_not_found")
        assert row_b.status == "available"

    async def test_state_naming_another_user(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        other = await _admin(db_session, org_id)
        await _gcal(db_session, org_id)
        state, nonce = await _start(db_session, admin)
        claims = jwt.decode(state, settings.SECRET_KEY, algorithms=["HS256"])
        claims["usr"] = other.id
        forged = jwt.encode(claims, settings.SECRET_KEY, algorithm="HS256")
        location = await _callback(db_session, forged, nonce)
        assert location.endswith("google_calendar_error=invalid_state")
        google.create.assert_not_awaited()

    async def test_expired_state(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _gcal(db_session, org_id)
        state, nonce = await _start(db_session, admin)
        claims = jwt.decode(state, settings.SECRET_KEY, algorithms=["HS256"])
        claims["exp"] = int(time.time()) - 5
        expired = jwt.encode(claims, settings.SECRET_KEY, algorithm="HS256")
        location = await _callback(db_session, expired, nonce)
        assert location.endswith("google_calendar_error=invalid_state")

    async def test_administrator_who_lost_the_permission(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(db_session, org_id)
        state, nonce = await _start(db_session, admin)
        await db_session.execute(
            text("UPDATE positions SET permissions = '[]' WHERE organization_id = :o"),
            {"o": org_id},
        )
        location = await _callback(db_session, state, nonce)
        assert location.endswith("google_calendar_error=not_authorized")
        assert row.get_secret("refresh_token") is None
        assert not google.seen

    async def test_refused_when_the_flag_went_off(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _gcal(db_session, org_id)
        state, nonce = await _start(db_session, admin)
        with patch.object(settings, "CALENDAR_SYNC_ENABLED", False):
            location = await _callback(db_session, state, nonce)
        assert location.endswith("google_calendar_error=unavailable")
        assert not google.seen

    async def test_consent_declined(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(db_session, org_id)
        state, nonce = await _start(db_session, admin)
        location = await _callback(
            db_session, state, nonce, code=None, error="access_denied&evil=1"
        )
        assert location.endswith("google_calendar_error=access_denied%26evil%3D1")
        assert row.get_secret(oauth.PENDING_SECRET) is None

    async def test_calendar_creation_failure_leaves_nothing_half_connected(
        self, db_session, google
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(db_session, org_id)
        google.create.side_effect = CalendarError("Google Calendar refused (403)")
        state, nonce = await _start(db_session, admin)

        location = await _callback(db_session, state, nonce)

        assert location.endswith("google_calendar_error=calendar_create_failed")
        await db_session.refresh(row)
        assert row.status == "error"
        assert row.enabled is False
        assert row.get_secret("refresh_token") is None
        assert row.get_secret("access_token") is None
        assert "calendar_id" not in row.config
        assert "calendar could not be created" in row.last_error
        assert row.consecutive_error_count == 1
        # The grant Google just issued is handed back.
        assert google.seen[-1].url.path == "/revoke"

    async def test_reconnect_keeps_a_surviving_calendar(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(
            db_session,
            org_id,
            status="error",
            config={"calendar_id": "old-cal", "account_email": "calendar@dept.org"},
        )
        await _mapping(db_session, row)
        state, nonce = await _start(db_session, admin)
        await _callback(db_session, state, nonce)
        google.exists.assert_awaited_once_with("old-cal")
        google.create.assert_not_awaited()
        await db_session.refresh(row)
        assert row.status == "connected"
        assert row.config["calendar_id"] == "old-cal"
        assert await _mapping_count(db_session, row) == 1

    async def test_reconnect_with_a_different_account_starts_a_new_calendar(
        self, db_session, google
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(
            db_session,
            org_id,
            status="error",
            config={"calendar_id": "old-cal", "account_email": "someone@else.org"},
        )
        await _mapping(db_session, row)
        state, nonce = await _start(db_session, admin)
        await _callback(db_session, state, nonce)
        google.exists.assert_not_awaited()
        await db_session.refresh(row)
        assert row.config["calendar_id"] == "new-cal@group.calendar.google.com"
        assert await _mapping_count(db_session, row) == 0


@pytest.mark.integration
class TestGenericEndpoints:
    async def test_generic_connect_is_refused_for_google_calendar(
        self, db_session, google
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(db_session, org_id)
        with pytest.raises(HTTPException) as excinfo:
            await int_ep.connect_integration(
                row.id,
                _request(),
                body=IntegrationConnectRequest(),
                db=db_session,
                current_user=admin,
            )
        assert excinfo.value.status_code == 400
        assert row.status == "available"

    async def test_typed_tokens_are_refused_on_update(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(db_session, org_id)
        for key in ("refresh_token", "calendar_id", "account_email"):
            with pytest.raises(HTTPException) as excinfo:
                await int_ep.update_integration(
                    row.id,
                    _request(),
                    body=IntegrationUpdateRequest(config={key: "typed"}),
                    db=db_session,
                    current_user=admin,
                )
            assert excinfo.value.status_code == 422
        assert row.get_secret("refresh_token") is None

    async def test_sync_descriptions_toggle_on_a_connected_row(
        self, db_session, google
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(
            db_session,
            org_id,
            status="connected",
            enabled=True,
            config={
                "calendar_id": "cal",
                "account_email": "calendar@dept.org",
                "token_expires_at": "2026-10-16T00:00:00+00:00",
                "sync_direction": "both",
            },
        )
        row.set_secret("refresh_token", "r")
        out = await int_ep.update_integration(
            row.id,
            _request(),
            body=IntegrationUpdateRequest(config={"sync_descriptions": True}),
            db=db_session,
            current_user=admin,
        )
        assert out["config"]["sync_descriptions"] is True
        assert out["config"]["calendar_id"] == "cal"
        assert out["status"] == "connected"

    async def test_disconnect_revokes_clears_and_forgets_mappings(
        self, db_session, google
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(db_session, org_id)
        row.set_secret("client_id", "dept-client")
        row.set_secret("client_secret", "dept-secret")
        state, nonce = await _start(db_session, admin)
        google.seen.clear()
        with patch.object(
            oauth,
            "create_integration_client",
            _factory(
                _token_handler(google.seen, id_token=_id_token(aud="dept-client"))
            ),
        ):
            await _callback(db_session, state, nonce)
        await _mapping(db_session, row)

        result = await int_ep.disconnect_integration(
            row.id, _request(), db=db_session, current_user=admin
        )

        assert result == {"status": "disconnected"}
        await db_session.refresh(row)
        assert row.status == "available"
        assert row.enabled is False
        for key in ("refresh_token", "access_token", oauth.PENDING_SECRET):
            assert row.get_secret(key) is None
        # The department's own OAuth client is configuration, not the grant.
        assert row.get_secret("client_id") == "dept-client"
        for key in ("calendar_id", "account_email", "token_expires_at"):
            assert key not in row.config
        assert await _mapping_count(db_session, row) == 0
        revoke = google.seen[-1]
        assert revoke.url.path == "/revoke"
        assert parse_qs(revoke.content.decode()) == {"token": ["1//fresh-refresh"]}
        details = google.audit.await_args.args[4]
        assert details["grant_revoked"] is True
        assert details["calendar_mappings_removed"] == 1

    async def test_disconnect_survives_google_being_down(self, db_session, google):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _gcal(
            db_session,
            org_id,
            status="connected",
            enabled=True,
            config={"calendar_id": "cal"},
        )
        row.set_secret("refresh_token", "r")

        def down(request):
            raise httpx.ConnectError("down")

        with patch.object(oauth, "create_integration_client", _factory(down)):
            await int_ep.disconnect_integration(
                row.id, _request(), db=db_session, current_user=admin
            )
        await db_session.refresh(row)
        assert row.status == "available"
        assert row.get_secret("refresh_token") is None
        assert google.audit.await_args.args[4]["grant_revoked"] is False
