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

How one attempt is bound to the organization, the integration and the
administrator who started it is described in ``calendar_oauth_common``.
"""

from typing import Any
from urllib.parse import urlencode

from loguru import logger

from app.core.config import settings
from app.models.integration import Integration
from app.services.integration_services import calendar_oauth_common as common
from app.services.integration_services.base import create_integration_client
from app.services.integration_services.calendar_common import ClientFactory

GOOGLE_CALENDAR_INTEGRATION_TYPE = "google-calendar"

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"

# calendar.app.created reaches only calendars this app creates — never the
# department's other calendars. openid + email give the account label.
SCOPES = "https://www.googleapis.com/auth/calendar.app.created openid email"

STATE_PURPOSE = "google_calendar_oauth"

STATE_TTL_SECONDS = common.STATE_TTL_SECONDS
PENDING_SECRET = common.PENDING_SECRET
TOKEN_SECRETS = common.TOKEN_SECRETS
CONNECTION_CONFIG_KEYS = common.CONNECTION_CONFIG_KEYS
calendar_name_for = common.calendar_name_for
consume_pending = common.consume_pending
GoogleCalendarOAuthError = common.CalendarOAuthError

_ID_TOKEN_ISSUERS = frozenset({"https://accounts.google.com", "accounts.google.com"})


def get_client_credentials(integration: Integration) -> tuple[str, str]:
    """The OAuth client for this integration: the department's, else the deployment's."""
    client_id = integration.get_secret("client_id") or (settings.GOOGLE_CLIENT_ID or "")
    client_secret = integration.get_secret("client_secret") or (
        settings.GOOGLE_CLIENT_SECRET or ""
    )
    return client_id, client_secret


def begin(
    integration: Integration, *, user_id: str, redirect_uri: str
) -> tuple[str, str]:
    """Start an attempt: store it as pending and return (authorize URL, nonce).

    The caller commits the integration and sets the nonce cookie.
    """
    client_id, client_secret = get_client_credentials(integration)
    if not client_id or not client_secret:
        raise GoogleCalendarOAuthError("missing_client_credentials")

    state, nonce, challenge = common.start_attempt(
        integration,
        purpose=STATE_PURPOSE,
        user_id=user_id,
        redirect_uri=redirect_uri,
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
    return common.decode_state(token, STATE_PURPOSE)


def _account_email(id_token: Any, client_id: str) -> str | None:
    """The signed-in account's address, from the ID token.

    Used only as a label, but the audience is still required to be this
    client so a token minted for another app is never read.
    """
    claims = common.unverified_id_token_claims(id_token)
    if claims is None:
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

    return {
        "access_token": access,
        "refresh_token": refresh,
        "expires_at": common.expires_at_from(data.get("expires_in")),
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
