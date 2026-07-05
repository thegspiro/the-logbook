"""
Salesforce OAuth Connect Service

Implements the OAuth 2.0 authorization-code flow so a department admin can
connect their Salesforce org by clicking "Connect" and granting consent,
rather than manually pasting a refresh token. The resulting refresh token is
stored encrypted on the organization's Salesforce Integration record.

The Connected App's client_id / client_secret may be supplied per organization
(stored encrypted on the integration) or fall back to a deployment-wide
Connected App configured via environment variables. Per-org credentials win.

CSRF for the redirect flow is carried in a signed, short-lived state token
(HS256 over SECRET_KEY) that also names the target organization/integration and
the exact redirect_uri, plus a random nonce that is double-submitted via an
httpOnly cookie set by the initiating endpoint.
"""

import time
from typing import Any
from urllib.parse import urlencode

import jwt
from loguru import logger

from app.core.config import settings
from app.models.integration import Integration
from app.services.integration_services.base import create_integration_client

_AUTHORIZE_URLS = {
    "production": "https://login.salesforce.com/services/oauth2/authorize",
    "sandbox": "https://test.salesforce.com/services/oauth2/authorize",
}
_TOKEN_URLS = {
    "production": "https://login.salesforce.com/services/oauth2/token",
    "sandbox": "https://test.salesforce.com/services/oauth2/token",
}

# api = REST access; refresh_token = offline access so we can mint new tokens.
_SCOPES = "api refresh_token"

# Signed-state lifetime — the window between clicking Connect and finishing
# consent. Ten minutes matches the login OAuth flow's state cookie.
_STATE_TTL_SECONDS = 600
_STATE_PURPOSE = "salesforce_oauth"


class SalesforceOAuthError(Exception):
    """Raised for recoverable Salesforce OAuth failures; message is a code."""


def _environment(integration: Integration) -> str:
    env = (integration.config or {}).get("environment", "production")
    return env if env in _AUTHORIZE_URLS else "production"


def get_client_credentials(integration: Integration) -> tuple[str, str]:
    """Resolve the Connected App client_id/secret for an integration.

    Per-org encrypted credentials take precedence; otherwise the
    deployment-wide Connected App from settings is used.
    """
    client_id = integration.get_secret("client_id") or (
        settings.SALESFORCE_CLIENT_ID or ""
    )
    client_secret = integration.get_secret("client_secret") or (
        settings.SALESFORCE_CLIENT_SECRET or ""
    )
    return client_id, client_secret


def encode_state(
    *,
    organization_id: str,
    integration_id: str,
    redirect_uri: str,
    nonce: str,
) -> str:
    """Create a signed, short-lived state token for the redirect flow."""
    payload = {
        "purpose": _STATE_PURPOSE,
        "org": organization_id,
        "int": integration_id,
        "redirect_uri": redirect_uri,
        "nonce": nonce,
        "exp": int(time.time()) + _STATE_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_state(token: str) -> dict[str, Any]:
    """Verify and decode a state token. Raises SalesforceOAuthError on failure."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise SalesforceOAuthError("invalid_state") from exc
    if payload.get("purpose") != _STATE_PURPOSE:
        raise SalesforceOAuthError("invalid_state")
    return payload


def build_authorization_url(
    integration: Integration, *, state: str, redirect_uri: str
) -> str:
    """Build the Salesforce consent URL to redirect the admin's browser to."""
    client_id, _ = get_client_credentials(integration)
    if not client_id:
        raise SalesforceOAuthError("missing_client_id")
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": _SCOPES,
        "state": state,
        # Force the account chooser + consent so a mis-connected org can be
        # re-pointed at the correct Salesforce login.
        "prompt": "login consent",
    }
    base = _AUTHORIZE_URLS[_environment(integration)]
    return f"{base}?{urlencode(params)}"


async def exchange_code_for_tokens(
    integration: Integration, *, code: str, redirect_uri: str
) -> dict[str, Any]:
    """Exchange an authorization code for access/refresh tokens.

    Returns the raw Salesforce token response (includes ``refresh_token``,
    ``access_token``, and ``instance_url``). Raises SalesforceOAuthError on
    any failure, including a response missing a refresh token (which means the
    Connected App was not granted the ``refresh_token`` scope).
    """
    client_id, client_secret = get_client_credentials(integration)
    if not client_id or not client_secret:
        raise SalesforceOAuthError("missing_client_credentials")

    token_url = _TOKEN_URLS[_environment(integration)]
    async with create_integration_client() as client:
        resp = await client.post(
            token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
            },
        )

    if resp.status_code != 200:
        logger.warning(
            "Salesforce token exchange failed (%d): %s",
            resp.status_code,
            resp.text[:300],
        )
        raise SalesforceOAuthError("token_exchange_failed")

    data: dict[str, Any] = resp.json()
    if not data.get("refresh_token"):
        raise SalesforceOAuthError("no_refresh_token")
    return data
