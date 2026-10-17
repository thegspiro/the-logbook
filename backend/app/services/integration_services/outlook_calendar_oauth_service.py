"""
Outlook (Microsoft 365) Calendar OAuth connect

The authorization-code flow (with PKCE) behind the Outlook card's "Connect
with Microsoft" button, against the Microsoft identity platform v2
endpoints. An administrator grants delegated ``Calendars.ReadWrite`` plus
``offline_access`` (for a refresh token) and ``openid email`` (for the
account label, read from the ID token so no Graph profile call — and no
``User.Read`` permission — is needed). The callback then creates the
department's own calendar (``POST /me/calendars``) and stores the tokens the
``calendar_sync`` reconciler reads.

The OAuth client is the deployment's Azure AD app (AZURE_AD_CLIENT_ID /
AZURE_AD_CLIENT_SECRET, tenant AZURE_AD_TENANT_ID) unless the department
saved its own ``client_id`` / ``client_secret`` (and ``tenant_id``) on the
integration; per-department values win, as for Google Calendar.

How one attempt is bound to the organization, the integration and the
administrator who started it is described in ``calendar_oauth_common``.

There is no revoke call on disconnect or on a failed connect: the Microsoft
identity platform has no OAuth token-revocation endpoint (RFC 7009) for an
app to hand back one grant. Its alternatives are Graph's
``revokeSignInSessions``, which signs the administrator out of every app on
every device, and deleting the app's delegated permission grant, which needs
directory-wide privileges this app does not ask for. Disconnecting therefore
forgets the tokens here; the grant itself ends when it expires, or when an
administrator removes the app under "My Apps" or in Entra ID.
"""

from typing import Any
from urllib.parse import quote, urlencode

from loguru import logger

from app.core.config import settings
from app.models.integration import Integration
from app.services.integration_services import calendar_oauth_common as common
from app.services.integration_services.base import create_integration_client
from app.services.integration_services.calendar_common import ClientFactory

OUTLOOK_INTEGRATION_TYPE = "outlook"

# Personal Microsoft accounts are not the target — a department calendar
# lives in its Microsoft 365 (work or school) tenant — so without a
# configured tenant the multi-tenant endpoint is "organizations", not
# "common", which would also offer outlook.com sign-in.
DEFAULT_TENANT = "organizations"

SCOPES = "offline_access openid email https://graph.microsoft.com/Calendars.ReadWrite"

STATE_PURPOSE = "outlook_calendar_oauth"
STATE_TTL_SECONDS = common.STATE_TTL_SECONDS


def _authority(tenant: str) -> str:
    return f"https://login.microsoftonline.com/{quote(tenant, safe='')}/oauth2/v2.0"


def authorize_url(tenant: str) -> str:
    return f"{_authority(tenant)}/authorize"


def token_url(tenant: str) -> str:
    return f"{_authority(tenant)}/token"


def get_client_credentials(integration: Integration) -> tuple[str, str, str]:
    """The OAuth client and tenant: the department's, else the deployment's.

    A department's own ``tenant_id`` is ordinary configuration (it is not a
    secret, so it is saved in the public config); an older row may hold it
    as a secret. Without one, the deployment's AZURE_AD_TENANT_ID applies
    only to the deployment's own app — a department's app is registered in
    its own tenant, so it falls back to the multi-tenant endpoint instead.
    """
    own_client_id = integration.get_secret("client_id")
    client_id = own_client_id or (settings.AZURE_AD_CLIENT_ID or "")
    client_secret = integration.get_secret("client_secret") or (
        settings.AZURE_AD_CLIENT_SECRET or ""
    )
    own_tenant = str(
        (integration.config or {}).get("tenant_id")
        or integration.get_secret("tenant_id")
        or ""
    ).strip()
    if own_tenant:
        tenant = own_tenant
    elif not own_client_id and settings.AZURE_AD_TENANT_ID:
        tenant = settings.AZURE_AD_TENANT_ID
    else:
        tenant = DEFAULT_TENANT
    return client_id, client_secret, tenant


def begin(
    integration: Integration, *, user_id: str, redirect_uri: str
) -> tuple[str, str]:
    """Start an attempt: store it as pending and return (authorize URL, nonce).

    The caller commits the integration and sets the nonce cookie.
    """
    client_id, client_secret, tenant = get_client_credentials(integration)
    if not client_id or not client_secret:
        raise common.CalendarOAuthError("missing_client_credentials")

    state, nonce, challenge = common.start_attempt(
        integration, purpose=STATE_PURPOSE, user_id=user_id, redirect_uri=redirect_uri
    )
    params = {
        "response_type": "code",
        "response_mode": "query",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": SCOPES,
        "state": state,
        # offline_access always yields a refresh token; the account picker
        # stops a browser already signed in to a personal mailbox from
        # connecting that one without the administrator noticing.
        "prompt": "select_account",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return f"{authorize_url(tenant)}?{urlencode(params)}", nonce


def decode_state(token: str) -> dict[str, Any]:
    """Verify the state's signature, purpose and expiry."""
    return common.decode_state(token, STATE_PURPOSE)


def _account_email(id_token: Any, client_id: str) -> str | None:
    """The signed-in account's address, from the ID token.

    ``email`` is an optional claim Microsoft includes when the account has a
    mailbox address; ``preferred_username`` (normally the sign-in address)
    is the fallback. Used only as a label, but the audience must be this
    client and the issuer the Microsoft identity platform v2.
    """
    claims = common.unverified_id_token_claims(id_token)
    if claims is None or claims.get("aud") != client_id:
        return None
    issuer = str(claims.get("iss") or "")
    if not (
        issuer.startswith("https://login.microsoftonline.com/")
        and issuer.endswith("/v2.0")
    ):
        return None
    for key in ("email", "preferred_username"):
        value = claims.get(key)
        if isinstance(value, str) and "@" in value:
            return value
    return None


def _calendar_scope_granted(scope: Any) -> bool:
    # Microsoft reports the Graph permission either bare or as a full URI.
    return any(
        item.rsplit("/", 1)[-1].lower() == "calendars.readwrite"
        for item in str(scope or "").split()
    )


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
    client_id, client_secret, tenant = get_client_credentials(integration)
    if not client_id or not client_secret:
        raise common.CalendarOAuthError("missing_client_credentials")
    try:
        async with (client_factory or create_integration_client)() as client:
            resp = await client.post(
                token_url(tenant),
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                    "scope": SCOPES,
                },
            )
    except Exception as exc:
        logger.warning(
            "Outlook Calendar token exchange could not reach Microsoft: {}",
            type(exc).__name__,
        )
        raise common.CalendarOAuthError("token_exchange_failed") from exc

    if resp.status_code != 200:
        # Microsoft's error body names the error code and a trace id; it
        # never echoes the code or the secret back.
        logger.warning(
            "Outlook Calendar token exchange failed ({}): {}",
            resp.status_code,
            resp.text[:200],
        )
        raise common.CalendarOAuthError("token_exchange_failed")
    try:
        data = resp.json()
    except ValueError as exc:
        raise common.CalendarOAuthError("token_exchange_failed") from exc
    if not isinstance(data, dict):
        raise common.CalendarOAuthError("token_exchange_failed")

    access = data.get("access_token")
    refresh = data.get("refresh_token")
    if not isinstance(access, str) or not access:
        raise common.CalendarOAuthError("token_exchange_failed")
    if not isinstance(refresh, str) or not refresh:
        raise common.CalendarOAuthError("no_refresh_token")
    if data.get("scope") and not _calendar_scope_granted(data.get("scope")):
        # A tenant's consent policy can grant less than was asked for;
        # without the calendar permission nothing can be published.
        raise common.CalendarOAuthError("calendar_scope_not_granted")

    return {
        "access_token": access,
        "refresh_token": refresh,
        "expires_at": common.expires_at_from(data.get("expires_in")),
        "account_email": _account_email(data.get("id_token"), client_id),
    }
