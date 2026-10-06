"""The Claude (MCP) OAuth 2.1 authorization server.

Security-critical, so the failure paths are the point: PKCE mismatch,
redirect-URI mismatch, code reuse, expired codes, refresh rotation and
replay detection, cross-organization access, scope escalation, revoked
tokens, and the rule that a token never reaches more than the consenting
member can reach right now.

Runs against the real database (``db_session``): every decision is a
locked read of a grant, a code or a client, and the org scoping is in the
queries themselves.
"""

import base64
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from starlette.requests import Request

from app.api.public import mcp_oauth as public_endpoints
from app.api.v1.endpoints.mcp_oauth import (
    ConsentDecision,
    decide_authorization_request,
    get_authorization_request,
    list_my_connections,
    revoke_my_connection,
)
from app.api.v1.endpoints.mcp_oauth_admin import (
    ClientCreateRequest,
    get_oauth_status,
    list_oauth_grants,
    register_oauth_client,
    revoke_oauth_client,
)
from app.core.config import settings
from app.core.database import get_db
from app.mcp import oauth
from app.mcp.constants import MCP_INTEGRATION_TYPE
from app.mcp.keys import McpAuthError
from app.mcp.registry import gate_allows
from app.models.audit import AuditLog
from app.models.integration import Integration
from app.models.mcp_oauth import McpOAuthAuthorization, McpOAuthGrant
from app.models.user import User

pytestmark = [pytest.mark.integration]

ORIGIN = "https://logbook.test"
REDIRECT = "https://claude.ai/api/mcp/auth_callback"
LOCAL_REDIRECT = "http://localhost:33418/callback"


@pytest.fixture(autouse=True)
def _oauth_on(monkeypatch):
    monkeypatch.setattr(settings, "MCP_OAUTH_ENABLED", True)
    monkeypatch.setattr(settings, "MCP_OAUTH_ISSUER_URL", ORIGIN)


def _verifier() -> str:
    return secrets.token_urlsafe(48)


async def _connect(db, org_id, **config) -> Integration:
    base = {"oauth_enabled": True}
    base.update(config)
    row = Integration(
        organization_id=org_id,
        integration_type=MCP_INTEGRATION_TYPE,
        name="Claude (MCP)",
        category="AI Assistants",
        status="connected",
        config=base,
        enabled=True,
    )
    db.add(row)
    await db.flush()
    return row


async def _set_config(db, org_id, **config) -> None:
    row = (
        await db.execute(
            select(Integration).where(
                Integration.organization_id == org_id,
                Integration.integration_type == MCP_INTEGRATION_TYPE,
            )
        )
    ).scalar_one()
    merged = dict(row.config or {})
    merged.update(config)
    row.config = merged
    await db.flush()


async def _org(db) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"other-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _member(db, org_id, permissions: list[str]) -> User:
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Mem', 'Ber', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@test.com",
        },
    )
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Pos', :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "slug": f"pos-{position_id[:8]}",
            "perms": json.dumps(permissions),
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await db.flush()
    return await _load_user(db, user_id)


async def _load_user(db, user_id: str) -> User:
    return (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


class Flow:
    """One department with a connected integration, a member and a client."""

    def __init__(self, db, org_id, admin_id, member, registered):
        self.db = db
        self.org_id = org_id
        self.admin_id = admin_id
        self.member = member
        self.registered = registered
        self.service = oauth.McpOAuthService(db)

    @property
    def client(self):
        return self.registered.client

    async def authorize(
        self,
        *,
        verifier: str,
        scope: str = "mcp:read",
        redirect_uri: str = REDIRECT,
        state: Optional[str] = "xyz",
    ) -> McpOAuthAuthorization:
        return await self.service.start_authorization(
            base=ORIGIN,
            client_id=self.client.client_id,
            redirect_uri=redirect_uri,
            response_type="code",
            scope=scope,
            state=state,
            code_challenge=oauth.pkce_challenge(verifier),
            code_challenge_method="S256",
            resource=f"{ORIGIN}/api/mcp",
        )

    async def code(
        self, *, verifier: str, scope: str = "mcp:read", user: Optional[User] = None
    ) -> str:
        row = await self.authorize(verifier=verifier, scope=scope)
        _, code = await self.service.decide(
            row.id, user or self.member, base=ORIGIN, approve=True
        )
        assert code is not None
        return code

    async def tokens(self, *, scope: str = "mcp:read") -> oauth.TokenSet:
        verifier = _verifier()
        code = await self.code(verifier=verifier, scope=scope)
        return await self.service.exchange_code(
            self.client,
            base=ORIGIN,
            code=code,
            redirect_uri=REDIRECT,
            code_verifier=verifier,
            resource=None,
        )

    async def principal(self, access_token: str):
        return await self.service.authenticate_access_token(access_token, base=ORIGIN)


@pytest.fixture
async def flow(db_session, setup_org_and_admin) -> Flow:
    org_id, admin_id = setup_org_and_admin
    await _connect(db_session, org_id)
    member = await _member(db_session, org_id, ["events.view", "members.view"])
    registered = await oauth.McpOAuthService(db_session).register_client(
        org_id,
        name="claude.ai",
        redirect_uris=[REDIRECT, LOCAL_REDIRECT],
        confidential=False,
        created_by=admin_id,
    )
    return Flow(db_session, org_id, admin_id, member, registered)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestMaterial:
    def test_pkce_s256_matches_rfc7636_appendix_b(self):
        verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        assert (
            oauth.pkce_challenge(verifier)
            == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )

    @pytest.mark.parametrize(
        "verifier", [None, "", "short", "a" * 129, "a" * 42 + " ", "é" * 50]
    )
    def test_malformed_verifiers_are_refused(self, verifier):
        assert not oauth.valid_verifier(verifier)

    def test_token_parsing_rejects_junk(self):
        grant = str(uuid.uuid4())
        good = f"{oauth.ACCESS_TOKEN_PREFIX}{grant}.{secrets.token_urlsafe(32)}"
        assert oauth.parse_token(good, oauth.ACCESS_TOKEN_PREFIX) == grant
        assert oauth.parse_token(good, oauth.REFRESH_TOKEN_PREFIX) is None
        assert oauth.parse_token("logbook_oat_notauuid.abc", "logbook_oat_") is None
        assert oauth.parse_token(f"logbook_oat_{grant}", "logbook_oat_") is None

    def test_redirect_uri_validation(self):
        assert oauth.normalize_redirect_uris([REDIRECT, REDIRECT, LOCAL_REDIRECT]) == [
            REDIRECT,
            LOCAL_REDIRECT,
        ]
        for bad in (
            "http://example.org/cb",
            "https://example.org/cb#frag",
            "https://user:pw@example.org/cb",
            "https://*.example.org/cb",
            "javascript:alert(1)",
            "myapp://callback",
        ):
            with pytest.raises(ValueError, match="redirect URI|not allowed"):
                oauth.normalize_redirect_uris([bad])
        with pytest.raises(ValueError, match="at least one"):
            oauth.normalize_redirect_uris([])

    def test_issuer_must_be_a_bare_https_origin(self, monkeypatch):
        for value, expected in (
            ("https://logbook.test", "https://logbook.test"),
            ("https://logbook.test/", "https://logbook.test"),
            ("http://localhost:3000", "http://localhost:3000"),
            ("http://logbook.test", None),
            ("https://logbook.test/app", None),
            ("https://user@logbook.test", None),
            ("", None),
        ):
            monkeypatch.setattr(settings, "MCP_OAUTH_ISSUER_URL", value)
            assert settings.mcp_oauth_origin() == expected, value
        monkeypatch.setattr(settings, "MCP_OAUTH_ISSUER_URL", ORIGIN)
        monkeypatch.setattr(settings, "MCP_OAUTH_ENABLED", False)
        assert settings.mcp_oauth_origin() is None

    def test_redirect_with_keeps_existing_query(self):
        url = oauth.redirect_with("https://x.test/cb?a=1", {"code": "c", "state": None})
        assert url == "https://x.test/cb?a=1&code=c"


# ---------------------------------------------------------------------------
# /authorize
# ---------------------------------------------------------------------------


class TestAuthorizationRequest:
    async def test_unknown_client_is_never_redirected(self, flow):
        with pytest.raises(oauth.OAuthError) as exc:
            await flow.service.start_authorization(
                base=ORIGIN,
                client_id="lbmcp_nope",
                redirect_uri=REDIRECT,
                response_type="code",
                scope=None,
                state=None,
                code_challenge=oauth.pkce_challenge(_verifier()),
                code_challenge_method="S256",
                resource=None,
            )
        assert exc.value.redirect is False

    @pytest.mark.parametrize(
        "uri",
        [
            REDIRECT + "/",
            REDIRECT + "?x=1",
            REDIRECT.upper(),
            "http://localhost:33419/callback",
            "https://evil.test/cb",
            None,
        ],
    )
    async def test_redirect_uri_must_match_exactly(self, flow, uri):
        with pytest.raises(oauth.OAuthError) as exc:
            await flow.authorize(verifier=_verifier(), redirect_uri=uri)
        assert exc.value.redirect is False

    async def test_revoked_client_is_unknown(self, flow):
        await flow.service.revoke_client(
            flow.org_id, flow.client.id, revoked_by=flow.admin_id
        )
        with pytest.raises(oauth.OAuthError) as exc:
            await flow.authorize(verifier=_verifier())
        assert exc.value.redirect is False

    @pytest.mark.parametrize(
        ("overrides", "error"),
        [
            ({"response_type": "token"}, "unsupported_response_type"),
            ({"code_challenge_method": "plain"}, "invalid_request"),
            ({"code_challenge_method": None}, "invalid_request"),
            ({"code_challenge": None}, "invalid_request"),
            ({"code_challenge": "too-short"}, "invalid_request"),
            ({"scope": "mcp:read admin"}, "invalid_scope"),
            ({"resource": "https://elsewhere.test/api/mcp"}, "invalid_target"),
            ({"state": "s" * 2000}, "invalid_request"),
        ],
    )
    async def test_invalid_requests_go_back_to_the_client(self, flow, overrides, error):
        params: dict[str, Any] = {
            "base": ORIGIN,
            "client_id": flow.client.client_id,
            "redirect_uri": REDIRECT,
            "response_type": "code",
            "scope": "mcp:read",
            "state": "s",
            "code_challenge": oauth.pkce_challenge(_verifier()),
            "code_challenge_method": "S256",
            "resource": None,
        }
        params.update(overrides)
        with pytest.raises(oauth.OAuthError) as exc:
            await flow.service.start_authorization(**params)
        assert exc.value.error == error
        assert exc.value.redirect is True

    async def test_department_switch_off_is_access_denied(self, flow):
        await _set_config(flow.db, flow.org_id, oauth_enabled=False)
        with pytest.raises(oauth.OAuthError) as exc:
            await flow.authorize(verifier=_verifier())
        assert exc.value.error == "access_denied"

    async def test_read_scope_is_always_included(self, flow):
        row = await flow.authorize(verifier=_verifier(), scope="mcp:finance")
        assert row.scope.split() == ["mcp:read", "mcp:finance"]
        assert row.status == "pending"
        assert row.organization_id == flow.org_id


# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------


class TestConsent:
    async def test_member_of_another_department_cannot_see_or_answer(self, flow):
        row = await flow.authorize(verifier=_verifier())
        other_org = await _org(flow.db)
        outsider = await _member(flow.db, other_org, ["*"])
        with pytest.raises(LookupError):
            await flow.service.get_pending(row.id, outsider)
        with pytest.raises(LookupError):
            await flow.service.decide(row.id, outsider, base=ORIGIN, approve=True)

    async def test_a_request_is_answered_once(self, flow):
        row = await flow.authorize(verifier=_verifier())
        await flow.service.decide(row.id, flow.member, base=ORIGIN, approve=True)
        with pytest.raises(ValueError, match="already been answered"):
            await flow.service.decide(row.id, flow.member, base=ORIGIN, approve=True)

    async def test_an_expired_request_cannot_be_approved(self, flow):
        row = await flow.authorize(verifier=_verifier())
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await flow.db.flush()
        with pytest.raises(ValueError, match="expired"):
            await flow.service.decide(row.id, flow.member, base=ORIGIN, approve=True)

    async def test_consent_cannot_add_scopes_the_client_did_not_ask_for(self, flow):
        row = await flow.authorize(verifier=_verifier(), scope="mcp:read")
        with pytest.raises(ValueError, match="only grant scopes"):
            await flow.service.decide(
                row.id,
                flow.member,
                base=ORIGIN,
                approve=True,
                scopes=["mcp:read", "mcp:write"],
            )

    async def test_consent_can_narrow_and_keeps_read(self, flow):
        row = await flow.authorize(
            verifier=_verifier(), scope="mcp:read mcp:write mcp:finance"
        )
        decision, _ = await flow.service.decide(
            row.id, flow.member, base=ORIGIN, approve=True, scopes=["mcp:finance"]
        )
        assert decision.authorization.scope == "mcp:read mcp:finance"

    async def test_decline_redirects_with_access_denied_state_and_iss(self, flow):
        row = await flow.authorize(verifier=_verifier(), state="abc")
        decision, code = await flow.service.decide(
            row.id, flow.member, base=ORIGIN, approve=False
        )
        assert code is None
        assert decision.redirect_to.startswith(REDIRECT + "?")
        assert "error=access_denied" in decision.redirect_to
        assert "state=abc" in decision.redirect_to
        assert "iss=https%3A%2F%2Flogbook.test%2Fapi%2Foauth" in decision.redirect_to

    async def test_approval_stores_only_the_code_digest(self, flow):
        row = await flow.authorize(verifier=_verifier())
        decision, code = await flow.service.decide(
            row.id, flow.member, base=ORIGIN, approve=True
        )
        assert code
        assert f"code={code}" in decision.redirect_to
        assert row.code_hash == oauth.digest(code)
        assert row.user_id == str(flow.member.id)


# ---------------------------------------------------------------------------
# Code exchange
# ---------------------------------------------------------------------------


class TestCodeExchange:
    async def test_happy_path_issues_bound_tokens_stored_as_digests(self, flow):
        tokens = await flow.tokens()
        grant = tokens.grant
        assert tokens.access_token.startswith(oauth.ACCESS_TOKEN_PREFIX)
        assert tokens.refresh_token.startswith(oauth.REFRESH_TOKEN_PREFIX)
        assert grant.access_token_hash == oauth.digest(tokens.access_token)
        assert grant.refresh_token_hash == oauth.digest(tokens.refresh_token)
        assert tokens.access_token not in (grant.access_token_hash or "")
        assert grant.user_id == str(flow.member.id)
        assert grant.organization_id == flow.org_id
        assert grant.resource == f"{ORIGIN}/api/mcp"
        assert 0 < tokens.expires_in <= int(oauth.ACCESS_TOKEN_TTL.total_seconds())

    async def test_pkce_mismatch_burns_the_code(self, flow):
        verifier = _verifier()
        code = await flow.code(verifier=verifier)
        with pytest.raises(oauth.CodeBurned, match="PKCE"):
            await flow.service.exchange_code(
                flow.client,
                base=ORIGIN,
                code=code,
                redirect_uri=REDIRECT,
                code_verifier=_verifier(),
                resource=None,
            )
        # The right verifier is now too late: one attempt per code.
        with pytest.raises(oauth.CodeReplayed):
            await flow.service.exchange_code(
                flow.client,
                base=ORIGIN,
                code=code,
                redirect_uri=REDIRECT,
                code_verifier=verifier,
                resource=None,
            )

    async def test_missing_verifier_is_refused(self, flow):
        code = await flow.code(verifier=_verifier())
        with pytest.raises(oauth.CodeBurned):
            await flow.service.exchange_code(
                flow.client,
                base=ORIGIN,
                code=code,
                redirect_uri=REDIRECT,
                code_verifier=None,
                resource=None,
            )

    async def test_redirect_uri_mismatch_at_the_token_endpoint(self, flow):
        verifier = _verifier()
        code = await flow.code(verifier=verifier)
        with pytest.raises(oauth.CodeBurned, match="redirect_uri"):
            await flow.service.exchange_code(
                flow.client,
                base=ORIGIN,
                code=code,
                redirect_uri=LOCAL_REDIRECT,
                code_verifier=verifier,
                resource=None,
            )

    async def test_code_reuse_revokes_the_grant_it_minted(self, flow):
        verifier = _verifier()
        code = await flow.code(verifier=verifier)
        tokens = await flow.service.exchange_code(
            flow.client,
            base=ORIGIN,
            code=code,
            redirect_uri=REDIRECT,
            code_verifier=verifier,
            resource=None,
        )
        await flow.principal(tokens.access_token)
        with pytest.raises(oauth.CodeReplayed):
            await flow.service.exchange_code(
                flow.client,
                base=ORIGIN,
                code=code,
                redirect_uri=REDIRECT,
                code_verifier=verifier,
                resource=None,
            )
        await flow.db.refresh(tokens.grant)
        assert tokens.grant.revoked_reason == "code_reuse"
        with pytest.raises(McpAuthError):
            await flow.principal(tokens.access_token)

    async def test_expired_code(self, flow):
        verifier = _verifier()
        code = await flow.code(verifier=verifier)
        row = (
            await flow.db.execute(
                select(McpOAuthAuthorization).where(
                    McpOAuthAuthorization.code_hash == oauth.digest(code)
                )
            )
        ).scalar_one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await flow.db.flush()
        with pytest.raises(oauth.CodeBurned, match="expired"):
            await flow.service.exchange_code(
                flow.client,
                base=ORIGIN,
                code=code,
                redirect_uri=REDIRECT,
                code_verifier=verifier,
                resource=None,
            )

    async def test_code_issued_to_another_client(self, flow):
        verifier = _verifier()
        code = await flow.code(verifier=verifier)
        other = await flow.service.register_client(
            flow.org_id,
            name="other",
            redirect_uris=[REDIRECT],
            confidential=False,
            created_by=flow.admin_id,
        )
        with pytest.raises(oauth.CodeBurned, match="different client"):
            await flow.service.exchange_code(
                other.client,
                base=ORIGIN,
                code=code,
                redirect_uri=REDIRECT,
                code_verifier=verifier,
                resource=None,
            )

    async def test_unknown_code(self, flow):
        with pytest.raises(oauth.OAuthError) as exc:
            await flow.service.exchange_code(
                flow.client,
                base=ORIGIN,
                code="nope",
                redirect_uri=REDIRECT,
                code_verifier=_verifier(),
                resource=None,
            )
        assert exc.value.error == "invalid_grant"

    async def test_wrong_resource_at_exchange(self, flow):
        verifier = _verifier()
        code = await flow.code(verifier=verifier)
        with pytest.raises(oauth.CodeBurned, match="resource"):
            await flow.service.exchange_code(
                flow.client,
                base=ORIGIN,
                code=code,
                redirect_uri=REDIRECT,
                code_verifier=verifier,
                resource="https://elsewhere.test/api/mcp",
            )

    async def test_member_deactivated_between_consent_and_exchange(self, flow):
        verifier = _verifier()
        code = await flow.code(verifier=verifier)
        flow.member.status = "inactive"
        await flow.db.flush()
        with pytest.raises(oauth.CodeBurned):
            await flow.service.exchange_code(
                flow.client,
                base=ORIGIN,
                code=code,
                redirect_uri=REDIRECT,
                code_verifier=verifier,
                resource=None,
            )


# ---------------------------------------------------------------------------
# Client authentication
# ---------------------------------------------------------------------------


class TestClientAuthentication:
    async def test_confidential_client_needs_its_secret(self, flow):
        registered = await flow.service.register_client(
            flow.org_id,
            name="conf",
            redirect_uris=[REDIRECT],
            confidential=True,
            created_by=flow.admin_id,
        )
        secret = registered.client_secret
        assert secret
        assert registered.client.client_secret_hash == oauth.digest(secret)
        cid = registered.client.client_id
        assert (await flow.service.authenticate_client(cid, secret)).id == (
            registered.client.id
        )
        for wrong in (None, "", secret + "x", "lbmcs_" + "a" * 43):
            with pytest.raises(oauth.OAuthError) as exc:
                await flow.service.authenticate_client(cid, wrong)
            assert exc.value.error == "invalid_client"
            assert exc.value.status == 401

    async def test_public_client_must_not_send_a_secret(self, flow):
        with pytest.raises(oauth.OAuthError) as exc:
            await flow.service.authenticate_client(flow.client.client_id, "anything")
        assert exc.value.error == "invalid_client"

    async def test_revoked_client_cannot_authenticate(self, flow):
        await flow.service.revoke_client(flow.org_id, flow.client.id, revoked_by=None)
        with pytest.raises(oauth.OAuthError):
            await flow.service.authenticate_client(flow.client.client_id, None)


# ---------------------------------------------------------------------------
# Refresh rotation
# ---------------------------------------------------------------------------


class TestRefresh:
    async def test_rotation_retires_the_previous_pair(self, flow):
        first = await flow.tokens()
        second = await flow.service.refresh(
            flow.client, base=ORIGIN, refresh_token=first.refresh_token, scope=None
        )
        assert second.access_token != first.access_token
        assert second.refresh_token != first.refresh_token
        await flow.principal(second.access_token)
        with pytest.raises(McpAuthError):
            await flow.principal(first.access_token)

    async def test_replayed_refresh_token_revokes_the_whole_grant(self, flow):
        first = await flow.tokens()
        second = await flow.service.refresh(
            flow.client, base=ORIGIN, refresh_token=first.refresh_token, scope=None
        )
        with pytest.raises(oauth.RefreshReplayed):
            await flow.service.refresh(
                flow.client,
                base=ORIGIN,
                refresh_token=first.refresh_token,
                scope=None,
            )
        await flow.db.refresh(second.grant)
        assert second.grant.revoked_reason == "refresh_reuse"
        # The legitimate holder of the rotated pair is cut off as well.
        with pytest.raises(McpAuthError):
            await flow.principal(second.access_token)
        with pytest.raises(oauth.OAuthError):
            await flow.service.refresh(
                flow.client,
                base=ORIGIN,
                refresh_token=second.refresh_token,
                scope=None,
            )

    async def test_refresh_cannot_widen_scope(self, flow):
        tokens = await flow.tokens(scope="mcp:read")
        with pytest.raises(oauth.OAuthError) as exc:
            await flow.service.refresh(
                flow.client,
                base=ORIGIN,
                refresh_token=tokens.refresh_token,
                scope="mcp:read mcp:write",
            )
        assert exc.value.error == "invalid_scope"

    async def test_refresh_can_narrow_scope_permanently(self, flow):
        tokens = await flow.tokens(scope="mcp:read mcp:finance")
        narrowed = await flow.service.refresh(
            flow.client,
            base=ORIGIN,
            refresh_token=tokens.refresh_token,
            scope="mcp:read",
        )
        assert narrowed.scope == "mcp:read"
        with pytest.raises(oauth.OAuthError):
            await flow.service.refresh(
                flow.client,
                base=ORIGIN,
                refresh_token=narrowed.refresh_token,
                scope="mcp:read mcp:finance",
            )

    async def test_another_client_cannot_refresh(self, flow):
        tokens = await flow.tokens()
        other = await flow.service.register_client(
            flow.org_id,
            name="other",
            redirect_uris=[REDIRECT],
            confidential=False,
            created_by=flow.admin_id,
        )
        with pytest.raises(oauth.OAuthError) as exc:
            await flow.service.refresh(
                other.client,
                base=ORIGIN,
                refresh_token=tokens.refresh_token,
                scope=None,
            )
        assert exc.value.error == "invalid_grant"
        # ...and its attempt is not mistaken for a replay by the owner.
        await flow.principal(tokens.access_token)

    async def test_access_token_is_not_a_refresh_token(self, flow):
        tokens = await flow.tokens()
        with pytest.raises(oauth.OAuthError):
            await flow.service.refresh(
                flow.client,
                base=ORIGIN,
                refresh_token=tokens.access_token,
                scope=None,
            )

    async def test_expired_refresh_token(self, flow):
        tokens = await flow.tokens()
        tokens.grant.refresh_expires_at = datetime.now(timezone.utc) - timedelta(
            seconds=1
        )
        await flow.db.flush()
        with pytest.raises(oauth.OAuthError, match="expired"):
            await flow.service.refresh(
                flow.client,
                base=ORIGIN,
                refresh_token=tokens.refresh_token,
                scope=None,
            )


# ---------------------------------------------------------------------------
# The resource server: what a token can do
# ---------------------------------------------------------------------------


class TestAccessToken:
    async def test_principal_carries_the_member_and_their_permissions(self, flow):
        tokens = await flow.tokens()
        principal = await flow.principal(tokens.access_token)
        assert principal.is_oauth
        assert principal.organization_id == flow.org_id
        assert principal.issued_by_user_id == str(flow.member.id)
        assert principal.member_permissions is not None
        assert "events.view" in principal.member_permissions
        assert principal.access_mode == "read_only"
        assert gate_allows(principal, None, None, ("events.view",))
        assert not gate_allows(principal, None, None, ("finance.view",))

    async def test_scopes_and_switches_intersect(self, flow):
        await _set_config(
            flow.db,
            flow.org_id,
            access_mode="read_write",
            expose_finance=True,
            expose_medical_screening=False,
        )
        tokens = await flow.tokens(
            scope="mcp:read mcp:write mcp:finance mcp:medical_screening"
        )
        principal = await flow.principal(tokens.access_token)
        assert principal.can_write
        assert principal.expose_finance
        # Department switch off beats the scope.
        assert not principal.expose_medical_screening
        # The scope is granted, the department allows it, and still the
        # member's own permissions decide: no finance.view, no finance tool.
        assert not gate_allows(principal, "finance", "finance", ("finance.view",))

        read_only = await flow.tokens(scope="mcp:read")
        p2 = await flow.principal(read_only.access_token)
        assert not p2.can_write
        assert not p2.expose_finance

    async def test_losing_a_permission_takes_effect_on_the_next_call(self, flow):
        tokens = await flow.tokens()
        await flow.db.execute(
            text(
                "UPDATE positions SET permissions = '[]' WHERE id IN "
                "(SELECT position_id FROM user_positions WHERE user_id = :u)"
            ),
            {"u": str(flow.member.id)},
        )
        flow.db.expire_all()
        principal = await flow.principal(tokens.access_token)
        assert not gate_allows(principal, None, None, ("events.view",))

    async def test_member_moved_to_another_department_is_refused(self, flow):
        tokens = await flow.tokens()
        other_org = await _org(flow.db)
        await flow.db.execute(
            text("UPDATE users SET organization_id = :o WHERE id = :u"),
            {"o": other_org, "u": str(flow.member.id)},
        )
        flow.db.expire_all()
        with pytest.raises(McpAuthError):
            await flow.principal(tokens.access_token)

    async def test_deactivated_member_is_refused(self, flow):
        tokens = await flow.tokens()
        flow.member.status = "inactive"
        await flow.db.flush()
        with pytest.raises(McpAuthError):
            await flow.principal(tokens.access_token)

    async def test_department_switch_off_refuses_existing_tokens(self, flow):
        tokens = await flow.tokens()
        await _set_config(flow.db, flow.org_id, oauth_enabled=False)
        with pytest.raises(McpAuthError) as exc:
            await flow.principal(tokens.access_token)
        assert exc.value.status == 403

    async def test_revoked_client_refuses_existing_tokens(self, flow):
        tokens = await flow.tokens()
        _, ended = await flow.service.revoke_client(
            flow.org_id, flow.client.id, revoked_by=flow.admin_id
        )
        assert ended == 1
        with pytest.raises(McpAuthError):
            await flow.principal(tokens.access_token)

    async def test_expired_access_token(self, flow):
        tokens = await flow.tokens()
        tokens.grant.access_expires_at = datetime.now(timezone.utc) - timedelta(
            seconds=1
        )
        await flow.db.flush()
        with pytest.raises(McpAuthError, match="expired"):
            await flow.principal(tokens.access_token)

    async def test_token_for_another_issuer_is_refused(self, flow):
        tokens = await flow.tokens()
        with pytest.raises(McpAuthError):
            await flow.service.authenticate_access_token(
                tokens.access_token, base="https://other.test"
            )

    async def test_tampered_token_is_refused(self, flow):
        tokens = await flow.tokens()
        tampered = tokens.access_token[:-2] + (
            "AA" if not tokens.access_token.endswith("AA") else "BB"
        )
        with pytest.raises(McpAuthError):
            await flow.principal(tampered)

    async def test_refresh_token_is_not_an_access_token(self, flow):
        tokens = await flow.tokens()
        with pytest.raises(McpAuthError):
            await flow.principal(tokens.refresh_token)


# ---------------------------------------------------------------------------
# Revocation
# ---------------------------------------------------------------------------


class TestRevocation:
    async def test_client_revocation_ends_the_connection(self, flow):
        tokens = await flow.tokens()
        grant = await flow.service.revoke_token(flow.client, tokens.refresh_token)
        assert grant is not None
        assert grant.revoked_reason == "client"
        with pytest.raises(McpAuthError):
            await flow.principal(tokens.access_token)

    async def test_another_client_cannot_revoke(self, flow):
        tokens = await flow.tokens()
        other = await flow.service.register_client(
            flow.org_id,
            name="other",
            redirect_uris=[REDIRECT],
            confidential=False,
            created_by=flow.admin_id,
        )
        assert await flow.service.revoke_token(other.client, tokens.access_token) is (
            None
        )
        await flow.principal(tokens.access_token)

    async def test_password_change_ends_every_connection(self, flow):
        tokens = await flow.tokens()
        ended = await flow.service.revoke_all_for_user(
            str(flow.member.id), reason="password_change"
        )
        assert ended == 1
        with pytest.raises(McpAuthError):
            await flow.principal(tokens.access_token)

    async def test_member_revokes_only_their_own(self, flow):
        tokens = await flow.tokens()
        other = await _member(flow.db, flow.org_id, ["events.view"])
        assert (
            await flow.service.revoke_grant(
                flow.org_id,
                tokens.grant.id,
                revoked_by=str(other.id),
                reason="member",
                user_id=str(other.id),
            )
            is None
        )
        other_org = await _org(flow.db)
        assert (
            await flow.service.revoke_grant(
                other_org, tokens.grant.id, revoked_by=None, reason="administrator"
            )
            is None
        )
        await flow.principal(tokens.access_token)

    async def test_disconnect_ends_every_connection(self, flow):
        tokens = await flow.tokens()
        ended = await flow.service.revoke_all_for_org(flow.org_id, revoked_by=None)
        assert ended == 1
        with pytest.raises(McpAuthError):
            await flow.principal(tokens.access_token)

    async def test_connections_per_member_and_client_are_capped(self, flow):
        grants = []
        for i in range(oauth.MAX_GRANTS_PER_MEMBER_CLIENT + 1):
            grant = (await flow.tokens()).grant
            # created_at has one-second resolution; space them out so
            # "oldest" is well defined.
            grant.created_at = datetime.now(timezone.utc) - timedelta(minutes=60 - i)
            await flow.db.flush()
            grants.append(grant.id)
        live = await flow.service.list_grants(flow.org_id, user_id=str(flow.member.id))
        assert len(live) == oauth.MAX_GRANTS_PER_MEMBER_CLIENT
        assert grants[0] not in {g.id for g, _ in live}


# ---------------------------------------------------------------------------
# HTTP: the public endpoints
# ---------------------------------------------------------------------------


def _app(db_session) -> FastAPI:
    app = FastAPI()
    app.include_router(public_endpoints.router)

    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    return app


def _client(db_session, ip: Optional[str] = None) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(
        app=_app(db_session),
        client=(ip or f"198.51.100.{secrets.randbelow(250) + 1}", 40000),
    )
    return httpx.AsyncClient(transport=transport, base_url=ORIGIN)


class TestHttp:
    async def test_everything_is_404_while_the_server_is_off(
        self, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "MCP_OAUTH_ENABLED", False)
        async with _client(db_session) as c:
            for path in (
                "/.well-known/oauth-authorization-server/api/oauth",
                "/api/oauth/.well-known/openid-configuration",
                "/api/mcp/.well-known/oauth-protected-resource",
                "/api/oauth/authorize",
            ):
                assert (await c.get(path)).status_code == 404, path
            assert (await c.post("/api/oauth/token")).status_code == 404
            assert (await c.post("/api/oauth/revoke")).status_code == 404

    async def test_metadata(self, db_session):
        async with _client(db_session) as c:
            asm = (
                await c.get("/.well-known/oauth-authorization-server/api/oauth")
            ).json()
            prm = (await c.get("/api/mcp/.well-known/oauth-protected-resource")).json()
        assert asm["issuer"] == f"{ORIGIN}/api/oauth"
        assert asm["code_challenge_methods_supported"] == ["S256"]
        assert asm["response_types_supported"] == ["code"]
        assert "registration_endpoint" not in asm
        assert "implicit" not in asm["grant_types_supported"]
        assert "password" not in asm["grant_types_supported"]
        assert prm["resource"] == f"{ORIGIN}/api/mcp"
        assert prm["authorization_servers"] == [f"{ORIGIN}/api/oauth"]

    async def test_authorize_bad_redirect_is_a_page_not_a_redirect(self, flow):
        async with _client(flow.db) as c:
            r = await c.get(
                "/api/oauth/authorize",
                params={
                    "client_id": flow.client.client_id,
                    "redirect_uri": "https://evil.test/cb",
                    "response_type": "code",
                    "code_challenge": oauth.pkce_challenge(_verifier()),
                    "code_challenge_method": "S256",
                },
            )
        assert r.status_code == 400
        assert "location" not in r.headers
        assert "evil.test" not in r.text

    async def test_authorize_reports_later_errors_to_the_client(self, flow):
        async with _client(flow.db) as c:
            r = await c.get(
                "/api/oauth/authorize",
                params={
                    "client_id": flow.client.client_id,
                    "redirect_uri": REDIRECT,
                    "response_type": "code",
                    "state": "s1",
                    "code_challenge": oauth.pkce_challenge(_verifier()),
                    "code_challenge_method": "plain",
                },
            )
        assert r.status_code == 302
        assert r.headers["location"].startswith(REDIRECT + "?")
        assert "error=invalid_request" in r.headers["location"]
        assert "state=s1" in r.headers["location"]

    async def test_authorize_rejects_a_repeated_parameter(self, flow):
        async with _client(flow.db) as c:
            r = await c.get(
                "/api/oauth/authorize?client_id="
                + flow.client.client_id
                + "&client_id=lbmcp_other&redirect_uri="
                + REDIRECT
            )
        assert r.status_code == 400

    async def test_full_flow_over_http(self, flow):
        verifier = _verifier()
        # Captured up front: an endpoint's rollback expires the ORM objects,
        # and the test must not lazy-load outside the session's greenlet.
        cid = flow.client.client_id
        org_id = flow.org_id
        async with _client(flow.db) as c:
            r = await c.get(
                "/api/oauth/authorize",
                params={
                    "client_id": cid,
                    "redirect_uri": REDIRECT,
                    "response_type": "code",
                    "scope": "mcp:read",
                    "state": "st",
                    "code_challenge": oauth.pkce_challenge(verifier),
                    "code_challenge_method": "S256",
                    "resource": f"{ORIGIN}/api/mcp",
                },
            )
            assert r.status_code == 302
            location = r.headers["location"]
            assert location.startswith(oauth.CONSENT_PATH + "?request=")
            request_id = location.split("request=", 1)[1]

            _, code = await flow.service.decide(
                request_id, flow.member, base=ORIGIN, approve=True
            )
            # JSON is not the token endpoint's media type.
            bad = await c.post("/api/oauth/token", json={"grant_type": "x"})
            assert bad.status_code == 400

            r = await c.post(
                "/api/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": REDIRECT,
                    "client_id": cid,
                    "code_verifier": verifier,
                },
            )
            assert r.status_code == 200, r.text
            assert r.headers["cache-control"] == "no-store"
            body = r.json()
            assert body["token_type"] == "Bearer"
            assert body["scope"] == "mcp:read"

            replay = await c.post(
                "/api/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": REDIRECT,
                    "client_id": cid,
                    "code_verifier": verifier,
                },
            )
            assert replay.status_code == 400
            assert replay.json()["error"] == "invalid_grant"

            unsupported = await c.post(
                "/api/oauth/token",
                data={"grant_type": "password", "client_id": cid},
            )
            assert unsupported.json()["error"] == "unsupported_grant_type"

            revoked = await c.post(
                "/api/oauth/revoke",
                data={"token": "whatever", "client_id": cid},
            )
            assert revoked.status_code == 200

        events = (
            (
                await flow.db.execute(
                    select(AuditLog.event_type).where(
                        AuditLog.organization_id == org_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert "mcp.oauth_token_issued" in events
        assert "mcp.oauth_token_replay" in events

    async def test_basic_client_authentication(self, flow):
        registered = await flow.service.register_client(
            flow.org_id,
            name="conf",
            redirect_uris=[REDIRECT],
            confidential=True,
            created_by=flow.admin_id,
        )
        cid = registered.client.client_id
        good = base64.b64encode(f"{cid}:{registered.client_secret}".encode()).decode()
        bad = base64.b64encode(f"{cid}:wrong".encode()).decode()
        async with _client(flow.db) as c:
            r = await c.post(
                "/api/oauth/revoke",
                data={"token": "x"},
                headers={"Authorization": f"Basic {bad}"},
            )
            assert r.status_code == 401
            assert r.json()["error"] == "invalid_client"
            r = await c.post(
                "/api/oauth/revoke",
                data={"token": "x"},
                headers={"Authorization": f"Basic {good}"},
            )
            assert r.status_code == 200

    async def test_token_endpoint_is_rate_limited(self, flow, monkeypatch):
        monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
        monkeypatch.setattr(public_endpoints, "_TOKEN_LIMIT", 2)
        statuses = []
        async with _client(flow.db, ip="198.51.100.251") as c:
            for _ in range(4):
                r = await c.post(
                    "/api/oauth/token",
                    data={"grant_type": "refresh_token", "client_id": "lbmcp_x"},
                )
                statuses.append(r.status_code)
        assert 429 in statuses


# ---------------------------------------------------------------------------
# The signed-in endpoints: consent, a member's connections, administration
# ---------------------------------------------------------------------------


def _request(path: str = "/api/v1/mcp-oauth") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "client": ("203.0.113.9", 40000),
            "query_string": b"",
        }
    )


class TestSignedInEndpoints:
    async def test_consent_screen_reports_what_each_scope_reaches(self, flow):
        await _set_config(flow.db, flow.org_id, access_mode="read_write")
        row = await flow.authorize(verifier=_verifier(), scope="mcp:read mcp:write")
        body = await get_authorization_request(
            row.id, db=flow.db, current_user=flow.member
        )
        by_scope = {s["scope"]: s for s in body["scopes"]}
        assert by_scope["mcp:read"]["tool_count"] > 0
        # events.view/members.view do not reach any write tool.
        assert by_scope["mcp:write"]["tool_count"] == 0
        assert body["client"]["redirect_host"] == "claude.ai"

    async def test_consent_screen_is_org_scoped(self, flow):
        row = await flow.authorize(verifier=_verifier())
        other_org = await _org(flow.db)
        outsider = await _member(flow.db, other_org, ["*"])
        with pytest.raises(HTTPException) as exc:
            await get_authorization_request(row.id, db=flow.db, current_user=outsider)
        assert exc.value.status_code == 404

    async def test_decision_endpoint_audits_and_returns_the_redirect(self, flow):
        row = await flow.authorize(verifier=_verifier(), state="q")
        body = await decide_authorization_request(
            row.id,
            ConsentDecision(approve=True),
            request=_request(),
            db=flow.db,
            current_user=flow.member,
        )
        assert body["redirect_to"].startswith(REDIRECT + "?code=")
        logged = (
            await flow.db.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "mcp.oauth_consent_granted",
                    AuditLog.organization_id == flow.org_id,
                )
            )
        ).scalar_one_or_none()
        assert logged is not None

    async def test_member_connections_list_and_revoke(self, flow):
        tokens = await flow.tokens()
        listed = await list_my_connections(db=flow.db, current_user=flow.member)
        assert [c["id"] for c in listed["connections"]] == [tokens.grant.id]
        other = await _member(flow.db, flow.org_id, ["events.view"])
        assert (await list_my_connections(db=flow.db, current_user=other))[
            "connections"
        ] == []
        with pytest.raises(HTTPException) as exc:
            await revoke_my_connection(
                tokens.grant.id, request=_request(), db=flow.db, current_user=other
            )
        assert exc.value.status_code == 404
        await revoke_my_connection(
            tokens.grant.id, request=_request(), db=flow.db, current_user=flow.member
        )
        with pytest.raises(McpAuthError):
            await flow.principal(tokens.access_token)

    async def test_admin_registers_lists_and_revokes(self, flow):
        admin = await _load_user(flow.db, flow.admin_id)
        created = await register_oauth_client(
            ClientCreateRequest(
                name="Claude Code", redirect_uris=[LOCAL_REDIRECT], confidential=True
            ),
            request=_request(),
            db=flow.db,
            current_user=admin,
        )
        assert created["client_secret"].startswith(oauth.CLIENT_SECRET_PREFIX)
        assert created["client"]["confidential"] is True
        with pytest.raises(HTTPException) as exc:
            await register_oauth_client(
                ClientCreateRequest(name="bad", redirect_uris=["http://evil.test/cb"]),
                request=_request(),
                db=flow.db,
                current_user=admin,
            )
        assert exc.value.status_code == 400

        tokens = await flow.tokens()
        grants = await list_oauth_grants(db=flow.db, current_user=admin)
        assert [g["id"] for g in grants["grants"]] == [tokens.grant.id]
        assert grants["grants"][0]["member_name"]

        revoked = await revoke_oauth_client(
            flow.client.id, request=_request(), db=flow.db, current_user=admin
        )
        assert revoked["connections_ended"] == 1

        status = await get_oauth_status(db=flow.db, current_user=admin)
        assert status["server_enabled"] is True
        assert status["department_enabled"] is True
        assert status["issuer"] == f"{ORIGIN}/api/oauth"

    async def test_admin_cannot_revoke_another_departments_client(self, flow):
        other_org = await _org(flow.db)
        outsider = await _member(flow.db, other_org, ["*"])
        with pytest.raises(HTTPException) as exc:
            await revoke_oauth_client(
                flow.client.id, request=_request(), db=flow.db, current_user=outsider
            )
        assert exc.value.status_code == 404


class TestGrantRowsHoldNoSecrets:
    async def test_no_plaintext_in_any_column(self, flow):
        tokens = await flow.tokens()
        row = (
            await flow.db.execute(
                select(McpOAuthGrant).where(McpOAuthGrant.id == tokens.grant.id)
            )
        ).scalar_one()
        values = [str(getattr(row, c.name)) for c in McpOAuthGrant.__table__.columns]
        for secret in (tokens.access_token, tokens.refresh_token):
            assert all(secret not in v for v in values)
