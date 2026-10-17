"""
Google Calendar OAuth connect

The authorization-code flow (with PKCE) behind the Google Calendar card's
"Connect with Google" button. An administrator grants The Logbook the
``calendar.app.created`` scope, which reaches only the calendars this app
creates; the callback then creates the department's own calendar and stores
the tokens the ``calendar_sync`` reconciler reads.

The OAuth client is the deployment's Google sign-in app (GOOGLE_CLIENT_ID /
GOOGLE_CLIENT_SECRET) unless the department stored its own ``client_id`` /
``client_secret`` on the integration; per-department credentials win, as for
Salesforce.

A connect attempt is bound three ways, and the callback checks all of them:

- the ``state`` parameter is a signed, ten-minute token naming the
  organization, the integration, the administrator and a random nonce;
- the nonce is double-submitted through an httpOnly cookie, so a state token
  lifted from a log cannot be completed from another browser;
- the same nonce, the administrator's id and the PKCE verifier are stored
  encrypted on the integration as the one pending attempt. The callback
  removes it before doing anything else, so a state token works once, and a
  newer attempt replaces an older one.
"""

import base64
import hashlib
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import jwt
from loguru import logger

from app.core.config import settings
from app.models.integration import Integration
from app.services.integration_services.base import create_integration_client
from app.services.integration_services.calendar_common import ClientFactory

GOOGLE_CALENDAR_INTEGRATION_TYPE = "google-calendar"

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"

# calendar.app.created reaches only calendars this app creates — never the
# department's other calendars. openid + email give the account label.
SCOPES = "https://www.googleapis.com/auth/calendar.app.created openid email"

STATE_TTL_SECONDS = 600
_STATE_PURPOSE = "google_calendar_oauth"
PENDING_SECRET = "oauth_pending"

# Secrets the connect flow writes; disconnect clears all of them. The
# department's own client_id / client_secret are configuration and stay.
TOKEN_SECRETS = ("refresh_token", "access_token", "token", PENDING_SECRET)

# Public config keys only the connect flow and the reconciler write.
CONNECTION_CONFIG_KEYS = (
    "calendar_id",
    "calendar_name",
    "account_email",
    "token_expires_at",
    "sync_paused_until",
)

_ID_TOKEN_ISSUERS = frozenset({"https://accounts.google.com", "accounts.google.com"})


class GoogleCalendarOAuthError(Exception):
    """A connect step failed; the message is a short code for the redirect."""


def get_client_credentials(integration: Integration) -> tuple[str, str]:
    """The OAuth client for this integration: the department's, else the deployment's."""
    client_id = integration.get_secret("client_id") or (settings.GOOGLE_CLIENT_ID or "")
    client_secret = integration.get_secret("client_secret") or (
        settings.GOOGLE_CLIENT_SECRET or ""
    )
    return client_id, client_secret


def calendar_name_for(organization_name: str | None) -> str:
    name = (organization_name or "").strip() or "Department"
    # Google caps a calendar summary well above this; the cap keeps a long
    # legal name from producing an unreadable calendar list entry.
    return f"{name[:200]} Events"


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def begin(
    integration: Integration, *, user_id: str, redirect_uri: str
) -> tuple[str, str]:
    """Start an attempt: store it as pending and return (authorize URL, nonce).

    The caller commits the integration and sets the nonce cookie.
    """
    client_id, client_secret = get_client_credentials(integration)
    if not client_id or not client_secret:
        raise GoogleCalendarOAuthError("missing_client_credentials")

    nonce = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()
    expires = int(time.time()) + STATE_TTL_SECONDS
    integration.set_secret(
        PENDING_SECRET,
        json.dumps(
            {
                "nonce": nonce,
                "user_id": user_id,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
                "exp": expires,
            }
        ),
    )
    state = str(
        jwt.encode(
            {
                "purpose": _STATE_PURPOSE,
                "org": str(integration.organization_id),
                "int": str(integration.id),
                "usr": user_id,
                "nonce": nonce,
                "exp": expires,
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )
    )
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": SCOPES,
        "state": state,
        "access_type": "offline",
        # Google issues a refresh token only on consent; forcing the prompt
        # is what guarantees one on a reconnect too.
        "prompt": "consent",
        "include_granted_scopes": "false",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}", nonce


def decode_state(token: str) -> dict[str, Any]:
    """Verify the state's signature, purpose and expiry."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise GoogleCalendarOAuthError("invalid_state") from exc
    if not isinstance(payload, dict) or payload.get("purpose") != _STATE_PURPOSE:
        raise GoogleCalendarOAuthError("invalid_state")
    return payload


def consume_pending(
    integration: Integration, *, nonce: str, user_id: str
) -> dict[str, Any]:
    """Remove the pending attempt and return it if it matches; else raise.

    The pending record is removed whether or not it matches, so a guessed or
    replayed state cannot be retried against the same attempt.
    """
    raw = integration.get_secret(PENDING_SECRET)
    integration.clear_secret(PENDING_SECRET)
    try:
        pending = json.loads(raw) if raw else None
    except ValueError:
        pending = None
    if not isinstance(pending, dict):
        raise GoogleCalendarOAuthError("invalid_state")
    stored_nonce = str(pending.get("nonce") or "")
    if (
        not stored_nonce
        or not secrets.compare_digest(stored_nonce, nonce)
        or str(pending.get("user_id") or "") != user_id
    ):
        raise GoogleCalendarOAuthError("invalid_state")
    exp = pending.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        raise GoogleCalendarOAuthError("expired_state")
    return pending


def _account_email(id_token: Any, client_id: str) -> str | None:
    """The signed-in account's address, from the ID token.

    The token came straight from Google's token endpoint over TLS, which
    OpenID Connect Core 3.1.3.7 accepts in place of a signature check. It is
    used only as a label, but the audience is still required to be this
    client so a token minted for another app is never read.
    """
    if not isinstance(id_token, str) or not id_token:
        return None
    try:
        claims = jwt.decode(id_token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return None
    if claims.get("aud") != client_id or claims.get("iss") not in _ID_TOKEN_ISSUERS:
        return None
    email = claims.get("email")
    return email if isinstance(email, str) and "@" in email else None


async def exchange_code(
    integration: Integration,
    *,
    code: str,
    redirect_uri: str,
    code_verifier: str,
    client_factory: ClientFactory | None = None,
) -> dict[str, Any]:
    """Trade the authorization code for tokens.

    Returns ``refresh_token``, ``access_token``, ``expires_at`` (aware
    datetime or None) and ``account_email`` (or None).
    """
    client_id, client_secret = get_client_credentials(integration)
    if not client_id or not client_secret:
        raise GoogleCalendarOAuthError("missing_client_credentials")
    try:
        async with (client_factory or create_integration_client)() as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                },
            )
    except Exception as exc:
        logger.warning(
            "Google Calendar token exchange could not reach Google: {}",
            type(exc).__name__,
        )
        raise GoogleCalendarOAuthError("token_exchange_failed") from exc

    if resp.status_code != 200:
        # Google's error body names the OAuth error code only; it never
        # echoes the code or the secret back.
        logger.warning(
            "Google Calendar token exchange failed ({}): {}",
            resp.status_code,
            resp.text[:200],
        )
        raise GoogleCalendarOAuthError("token_exchange_failed")
    try:
        data = resp.json()
    except ValueError as exc:
        raise GoogleCalendarOAuthError("token_exchange_failed") from exc
    if not isinstance(data, dict):
        raise GoogleCalendarOAuthError("token_exchange_failed")

    access = data.get("access_token")
    refresh = data.get("refresh_token")
    if not isinstance(access, str) or not access:
        raise GoogleCalendarOAuthError("token_exchange_failed")
    if not isinstance(refresh, str) or not refresh:
        raise GoogleCalendarOAuthError("no_refresh_token")
    granted = str(data.get("scope") or "").split()
    if (
        granted
        and "https://www.googleapis.com/auth/calendar.app.created" not in granted
    ):
        # The consent screen lets the administrator untick the calendar
        # permission; without it nothing can be published.
        raise GoogleCalendarOAuthError("calendar_scope_not_granted")

    expires_in = data.get("expires_in")
    expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        if isinstance(expires_in, (int, str)) and str(expires_in).isdigit()
        else None
    )
    return {
        "access_token": access,
        "refresh_token": refresh,
        "expires_at": expires_at,
        "account_email": _account_email(data.get("id_token"), client_id),
    }


async def revoke_token(
    token: str | None, *, client_factory: ClientFactory | None = None
) -> bool:
    """Ask Google to revoke a grant. Best effort: never raises.

    Revoking the refresh token ends the whole grant, access tokens included.
    """
    if not token:
        return False
    try:
        async with (client_factory or create_integration_client)() as client:
            resp = await client.post(REVOKE_URL, data={"token": token})
    except Exception as exc:
        logger.warning(
            "Google Calendar token revocation could not reach Google: {}",
            type(exc).__name__,
        )
        return False
    # 400 invalid_token means the grant is already gone, which is the goal.
    return resp.status_code in (200, 400)
