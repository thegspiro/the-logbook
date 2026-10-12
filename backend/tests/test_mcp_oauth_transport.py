"""How the MCP endpoint presents and routes OAuth credentials.

No database: the challenge header is pure, and the dispatcher's refusal of an
OAuth token while the server is off happens before any session is opened.
"""

import secrets
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.mcp import oauth
from app.mcp.keys import McpAuthError
from app.mcp.transport import _www_authenticate, authenticate_with_database

pytestmark = [pytest.mark.unit]


def _access_token() -> str:
    return f"{oauth.ACCESS_TOKEN_PREFIX}{uuid.uuid4()}.{secrets.token_urlsafe(32)}"


class TestChallenge:
    def test_plain_bearer_while_off(self, monkeypatch):
        monkeypatch.setattr(settings, "MCP_OAUTH_ENABLED", False)
        assert _www_authenticate(False) == "Bearer"
        assert _www_authenticate(True) == "Bearer"

    def test_points_at_resource_metadata_when_on(self, monkeypatch):
        monkeypatch.setattr(settings, "MCP_OAUTH_ENABLED", True)
        monkeypatch.setattr(settings, "MCP_OAUTH_ISSUER_URL", "https://logbook.test")
        header = _www_authenticate(False)
        assert header.startswith("Bearer ")
        assert (
            'resource_metadata="https://logbook.test/api/mcp/.well-known/'
            'oauth-protected-resource"'
        ) in header
        assert 'scope="mcp:read"' in header
        assert "error=" not in header
        assert _www_authenticate(True).startswith('Bearer error="invalid_token"')

    def test_misconfigured_issuer_keeps_the_server_off(self, monkeypatch):
        monkeypatch.setattr(settings, "MCP_OAUTH_ENABLED", True)
        monkeypatch.setattr(settings, "MCP_OAUTH_ISSUER_URL", "http://logbook.test")
        assert _www_authenticate(False) == "Bearer"
        warnings = settings.validate_security_config()
        assert any("MCP_OAUTH_ISSUER_URL" in w for w in warnings)
        assert not any("MCP_OAUTH" in w and "CRITICAL" in w for w in warnings)


class _Session:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *exc):
        return False


class TestDispatch:
    async def test_oauth_token_refused_while_the_server_is_off(self, monkeypatch):
        monkeypatch.setattr(settings, "MCP_OAUTH_ENABLED", False)
        verify = AsyncMock()
        with patch("app.mcp.transport.open_session", return_value=_Session()):
            with patch.object(
                oauth.McpOAuthService, "authenticate_access_token", verify
            ):
                with pytest.raises(McpAuthError):
                    await authenticate_with_database(_access_token(), None)
        verify.assert_not_called()

    async def test_service_keys_still_go_to_the_key_service(self, monkeypatch):
        monkeypatch.setattr(settings, "MCP_OAUTH_ENABLED", True)
        monkeypatch.setattr(settings, "MCP_OAUTH_ISSUER_URL", "https://logbook.test")
        key_auth = AsyncMock(return_value="principal")
        oauth_auth = AsyncMock()
        with patch("app.mcp.transport.open_session", return_value=_Session()):
            with patch("app.mcp.transport.McpKeyService.authenticate", key_auth):
                with patch.object(
                    oauth.McpOAuthService, "authenticate_access_token", oauth_auth
                ):
                    result = await authenticate_with_database(
                        "logbook_mcp_" + "a" * 43, "203.0.113.1"
                    )
        assert result == "principal"
        oauth_auth.assert_not_called()

    async def test_access_tokens_go_to_the_oauth_service(self, monkeypatch):
        monkeypatch.setattr(settings, "MCP_OAUTH_ENABLED", True)
        monkeypatch.setattr(settings, "MCP_OAUTH_ISSUER_URL", "https://logbook.test")
        oauth_auth = AsyncMock(return_value="member")
        with patch("app.mcp.transport.open_session", return_value=_Session()):
            with patch.object(
                oauth.McpOAuthService, "authenticate_access_token", oauth_auth
            ):
                assert await authenticate_with_database(_access_token(), None) == (
                    "member"
                )
        assert oauth_auth.await_args is not None
        assert oauth_auth.await_args.kwargs["base"] == "https://logbook.test"
