"""
Sign in with Authentik (W01-11).

Authentik was offered as a sign-in method with nothing behind it, and choosing
it turned password reset off for every member. It is now an OpenID Connect
provider configured like Google and Microsoft, from the server's environment,
and a provider the server cannot sign anyone in through no longer takes reset
away.

The ID-token checks run against a real RS256 token signed by a key generated
here; only the network is faked.
"""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import BackgroundTasks

from app.api.v1.endpoints import auth as auth_ep
from app.core.config import settings
from app.schemas.auth import PasswordResetRequest
from app.services import oauth_service
from app.services.oauth_service import AuthentikOAuthError, AuthentikOAuthService

pytestmark = pytest.mark.unit

ISSUER = "https://auth.example.org/application/o/the-logbook/"
CLIENT_ID = "logbook-client"
DISCOVERY = {
    "issuer": ISSUER,
    "authorization_endpoint": "https://auth.example.org/application/o/authorize/",
    "token_endpoint": "https://auth.example.org/application/o/token/",
    "jwks_uri": "https://auth.example.org/application/o/the-logbook/jwks/",
}


@pytest.fixture(autouse=True)
def _authentik_settings(monkeypatch):
    monkeypatch.setattr(settings, "AUTHENTIK_ENABLED", True)
    monkeypatch.setattr(settings, "AUTHENTIK_ISSUER_URL", ISSUER)
    monkeypatch.setattr(settings, "AUTHENTIK_CLIENT_ID", CLIENT_ID)
    monkeypatch.setattr(settings, "AUTHENTIK_CLIENT_SECRET", "secret")
    monkeypatch.setattr(
        settings,
        "AUTHENTIK_REDIRECT_URI",
        "https://app.example.org/api/v1/auth/oauth/authentik/callback",
    )
    monkeypatch.setattr(settings, "AUTHENTIK_ALLOWED_DOMAINS", "")
    oauth_service._authentik_discovery.clear()
    yield
    oauth_service._authentik_discovery.clear()


class _FakeClient:
    """Stands in for httpx.AsyncClient; answers from a url -> Response map."""

    responses: dict = {}
    calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):
        _FakeClient.calls.append(("GET", url))
        return _FakeClient.responses[url]

    async def post(self, url, data=None):
        _FakeClient.calls.append(("POST", url))
        return _FakeClient.responses[url]


@pytest.fixture
def network(monkeypatch):
    _FakeClient.responses = {
        f"{ISSUER}.well-known/openid-configuration": httpx.Response(200, json=DISCOVERY)
    }
    _FakeClient.calls = []
    monkeypatch.setattr(oauth_service.httpx, "AsyncClient", _FakeClient)
    return _FakeClient


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _token(key, **overrides):
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "sub": "authentik-sub-1",
        "email": "alice@dept.org",
        "email_verified": True,
        "iat": now,
        "exp": now + 300,
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


def _verify(token, public_key):
    jwk_client = MagicMock()
    jwk_client.get_signing_key_from_jwt.return_value = SimpleNamespace(key=public_key)
    with patch("jwt.PyJWKClient", return_value=jwk_client):
        return AuthentikOAuthService._verify_id_token(token, DISCOVERY["jwks_uri"])


class TestConfiguration:
    def test_configured_when_complete(self):
        assert AuthentikOAuthService.is_configured()

    @pytest.mark.parametrize(
        "name", ["AUTHENTIK_ISSUER_URL", "AUTHENTIK_CLIENT_SECRET"]
    )
    def test_not_configured_without_a_required_setting(self, monkeypatch, name):
        monkeypatch.setattr(settings, name, None)
        assert not AuthentikOAuthService.is_configured()

    def test_not_configured_when_disabled(self, monkeypatch):
        monkeypatch.setattr(settings, "AUTHENTIK_ENABLED", False)
        assert not AuthentikOAuthService.is_configured()


class TestDiscovery:
    async def test_reads_and_caches_the_issuers_document(self, network):
        first = await AuthentikOAuthService.discovery()
        second = await AuthentikOAuthService.discovery()

        assert first == DISCOVERY
        assert second == DISCOVERY
        assert len(network.calls) == 1

    async def test_an_issuer_url_without_its_trailing_slash_still_matches(
        self, monkeypatch, network
    ):
        monkeypatch.setattr(settings, "AUTHENTIK_ISSUER_URL", ISSUER.rstrip("/"))
        assert await AuthentikOAuthService.discovery() == DISCOVERY

    async def test_a_document_for_another_issuer_is_refused(self, network):
        network.responses[f"{ISSUER}.well-known/openid-configuration"] = httpx.Response(
            200, json={**DISCOVERY, "issuer": "https://evil.test/"}
        )
        with pytest.raises(AuthentikOAuthError, match="provider_misconfigured"):
            await AuthentikOAuthService.discovery()

    async def test_an_endpoint_off_the_issuer_origin_is_refused(self, network):
        # A tampered document must not send the client secret elsewhere.
        network.responses[f"{ISSUER}.well-known/openid-configuration"] = httpx.Response(
            200,
            json={**DISCOVERY, "token_endpoint": "https://evil.test/token/"},
        )
        with pytest.raises(AuthentikOAuthError, match="provider_misconfigured"):
            await AuthentikOAuthService.discovery()

    async def test_an_unreachable_provider_is_reported(self, network):
        network.responses[f"{ISSUER}.well-known/openid-configuration"] = httpx.Response(
            502
        )
        with pytest.raises(AuthentikOAuthError, match="provider_unavailable"):
            await AuthentikOAuthService.discovery()


class TestAuthorizationUrl:
    def test_points_at_the_discovered_endpoint_with_the_state(self):
        url = AuthentikOAuthService.build_authorization_url(DISCOVERY, "s-123")
        parsed = urlparse(url)
        params = parse_qs(parsed.query)

        assert url.startswith(DISCOVERY["authorization_endpoint"])
        assert params["client_id"] == [CLIENT_ID]
        assert params["state"] == ["s-123"]
        assert params["response_type"] == ["code"]
        assert "openid" in params["scope"][0]


class TestIdToken:
    def test_a_token_from_the_provider_verifies(self, signing_key):
        claims = _verify(_token(signing_key), signing_key.public_key())
        assert claims["sub"] == "authentik-sub-1"

    def test_a_token_for_another_client_is_refused(self, signing_key):
        with pytest.raises(AuthentikOAuthError, match="invalid_id_token"):
            _verify(_token(signing_key, aud="someone-else"), signing_key.public_key())

    def test_a_token_from_another_issuer_is_refused(self, signing_key):
        with pytest.raises(AuthentikOAuthError, match="invalid_id_token"):
            _verify(
                _token(signing_key, iss="https://evil.test/"),
                signing_key.public_key(),
            )

    def test_an_expired_token_is_refused(self, signing_key):
        with pytest.raises(AuthentikOAuthError, match="invalid_id_token"):
            _verify(
                _token(signing_key, exp=int(time.time()) - 60), signing_key.public_key()
            )

    def test_a_client_secret_signed_token_is_refused(self):
        # A provider with no signing key signs with the client secret; anyone
        # holding the secret could then mint tokens.
        now = int(time.time())
        token = jwt.encode(
            {"iss": ISSUER, "aud": CLIENT_ID, "sub": "x", "iat": now, "exp": now + 60},
            "secret-that-is-long-enough-for-hs256-0123456789",
            algorithm="HS256",
        )
        with pytest.raises(AuthentikOAuthError, match="invalid_id_token"):
            _verify(token, "secret-that-is-long-enough-for-hs256-0123456789")


class TestResolveUser:
    async def test_a_verified_email_links_the_existing_account(self):
        with patch.object(
            oauth_service,
            "_link_existing_user",
            AsyncMock(return_value=("user", None)),
        ) as link:
            result = await AuthentikOAuthService(MagicMock()).resolve_user(
                {"email": "Alice@Dept.org", "email_verified": True, "sub": "s1"}
            )
        assert result == ("user", None)
        link.assert_awaited_once()
        assert link.await_args.args[1:] == ("alice@dept.org", "s1", "authentik")

    @pytest.mark.parametrize("verified", [False, None, "true"])
    async def test_an_unverified_email_claims_nothing(self, verified):
        claims = {"email": "alice@dept.org", "sub": "s1"}
        if verified is not None:
            claims["email_verified"] = verified
        user, reason = await AuthentikOAuthService(MagicMock()).resolve_user(claims)
        assert user is None
        assert reason == "unverified_email"

    async def test_the_domain_allowlist_applies(self, monkeypatch):
        monkeypatch.setattr(settings, "AUTHENTIK_ALLOWED_DOMAINS", "dept.org")
        user, reason = await AuthentikOAuthService(MagicMock()).resolve_user(
            {"email": "alice@elsewhere.org", "email_verified": True, "sub": "s1"}
        )
        assert user is None
        assert reason == "domain_not_allowed"


class TestRoutes:
    async def test_initiate_is_not_found_when_unconfigured(self, monkeypatch):
        from fastapi import HTTPException

        monkeypatch.setattr(settings, "AUTHENTIK_ENABLED", False)
        with pytest.raises(HTTPException) as exc:
            await auth_ep.oauth_authentik_initiate(db=MagicMock())
        assert exc.value.status_code == 404

    async def test_initiate_redirects_to_authentik_with_a_state_cookie(self, network):
        response = await auth_ep.oauth_authentik_initiate(db=MagicMock())

        location = response.headers["location"]
        state = parse_qs(urlparse(location).query)["state"][0]
        assert location.startswith(DISCOVERY["authorization_endpoint"])
        assert f"oauth_state={state}" in response.headers["set-cookie"]

    async def test_callback_with_a_mismatched_state_is_refused(self):
        response = await auth_ep.oauth_authentik_callback(
            request=MagicMock(),
            code="c",
            state="one",
            error=None,
            oauth_state_cookie="two",
            db=MagicMock(),
        )
        assert response.headers["location"].endswith("error=invalid_state")


def _org_settings_db(provider):
    result = MagicMock()
    result.first.return_value = SimpleNamespace(
        settings={"auth": {"provider": provider}}
    )
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


class TestLoginPageConfig:
    async def test_the_button_is_offered_when_chosen_and_configured(self):
        config = await auth_ep.get_oauth_config(db=_org_settings_db("authentik"))
        assert config["authentikEnabled"] is True
        assert config["googleEnabled"] is False

    async def test_no_button_when_the_server_is_not_configured(self, monkeypatch):
        monkeypatch.setattr(settings, "AUTHENTIK_CLIENT_ID", None)
        config = await auth_ep.get_oauth_config(db=_org_settings_db("authentik"))
        assert config["authentikEnabled"] is False


async def _forgot(provider):
    org = SimpleNamespace(
        id="org-a", name="Review FD", settings={"auth": {"provider": provider}}
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = org
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    with patch.object(auth_ep, "log_audit_event", new=AsyncMock()), patch.object(
        auth_ep.AuthService,
        "create_password_reset_token",
        new=AsyncMock(return_value=(None, None)),
    ) as create_token, patch(
        "app.services.email_service.EmailService.can_send",
        new_callable=property,
        fget=lambda _self: True,
    ):
        body = await auth_ep.forgot_password(
            reset_request=PasswordResetRequest(email="alice@dept.org"),
            request=MagicMock(),
            background_tasks=BackgroundTasks(),
            db=db,
        )
    return body, create_token


class TestPasswordResetFallback:
    async def test_a_live_provider_sends_members_to_it(self):
        body, create_token = await _forgot("authentik")
        assert body["auth_provider"] == "authentik"
        create_token.assert_not_awaited()

    async def test_a_provider_the_server_cannot_use_keeps_reset(self, monkeypatch):
        # W01-11: choosing Authentik during setup turned reset off for every
        # member, with no single sign-on behind it to reset through.
        monkeypatch.setattr(settings, "AUTHENTIK_ENABLED", False)
        body, create_token = await _forgot("authentik")
        assert "auth_provider" not in body
        create_token.assert_awaited_once()
