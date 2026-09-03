"""App-only OAuth for Microsoft 365 SMTP submission.

Exchange Online is retiring Basic authentication for Client Submission
(SMTP AUTH): behaviour is unchanged through December 2026, after which it
is disabled by default for existing tenants and unavailable to new ones,
with final removal announced for the second half of 2027. An App Password
is Basic auth, so a department on that path has a deadline; this module is
the other path — the OAuth 2.0 client credentials flow, which authenticates
the *application* rather than a person and so needs no interactive sign-in
from a background sender.

The department registers an Entra ID application, grants it the
``SMTP.SendAsApp`` application permission for Office 365 Exchange Online,
and their Exchange administrator registers that application's service
principal and grants it ``SendAs`` on the sending mailbox. The three values
they then paste into the settings screen — tenant ID, client ID and client
secret — are what this module exchanges for an access token, which is
presented to ``smtp.office365.com`` over the SASL XOAUTH2 mechanism.

``msal`` performs the token request and holds an in-memory token cache per
application instance, so the instances are reused across sends rather than
rebuilt: a fresh instance would re-authenticate on every message.
"""

import hashlib
import re
import threading
from collections import OrderedDict
from typing import Any, Optional

from loguru import logger

# Exchange Online resource. ``.default`` requests the application
# permissions already consented to for the app registration — with the
# client credentials flow there is no user to consent to anything narrower.
MICROSOFT_OAUTH_SCOPE = "https://outlook.office365.com/.default"

_AUTHORITY_TEMPLATE = "https://login.microsoftonline.com/{tenant}"

# A tenant is a GUID or a verified domain (contoso.onmicrosoft.com). It is
# interpolated into the authority URL, so anything else is rejected rather
# than sent: a value carrying a slash or an @ would redirect the token
# request to a host the department never named.
_GUID = re.compile(r"\A[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z")
_DOMAIN = re.compile(
    r"\A(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}\Z"
)

# Application instances are cached to keep msal's token cache alive across
# sends. Bounded, because one entry is held per distinct app registration
# and this dict lives for the life of the process (see CLAUDE.md pitfall 9).
_MAX_CACHED_APPS = 16
_app_cache: "OrderedDict[tuple[str, str, str], Any]" = OrderedDict()
_app_cache_lock = threading.Lock()


class MicrosoftOAuthError(ValueError):
    """A Microsoft 365 access token could not be obtained.

    A ``ValueError`` so the endpoint layer reports it as a 400 through
    ``safe_error_detail`` — every cause is a credential or consent problem
    the administrator can act on, not a server fault.
    """


def validate_tenant_id(tenant_id: Any) -> str:
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise MicrosoftOAuthError("Microsoft 365 directory (tenant) ID is required")
    tenant = tenant_id.strip()
    if not (_GUID.match(tenant) or _DOMAIN.match(tenant)):
        raise MicrosoftOAuthError(
            "Directory (tenant) ID must be the tenant GUID from Entra ID, or a "
            "verified domain such as contoso.onmicrosoft.com."
        )
    return tenant


def validate_client_id(client_id: Any) -> str:
    if not isinstance(client_id, str) or not client_id.strip():
        raise MicrosoftOAuthError("Microsoft 365 application (client) ID is required")
    client = client_id.strip()
    if not _GUID.match(client):
        raise MicrosoftOAuthError(
            "Application (client) ID must be the GUID shown on the app "
            "registration's Overview page in Entra ID."
        )
    return client


def xoauth2_string(user: str, access_token: str) -> str:
    """The SASL XOAUTH2 initial client response, unencoded.

    ``smtplib.SMTP.auth`` base64-encodes whatever the auth callback returns,
    so this is handed over as-is. The separators are literal 0x01 bytes.
    """
    return f"user={user}\x01auth=Bearer {access_token}\x01\x01"


def _client_app(tenant_id: str, client_id: str, client_secret: str) -> Any:
    """A cached ``msal`` confidential client for one app registration.

    Keyed by a hash of the secret as well as the identifiers, so rotating
    the secret builds a new client rather than reusing one that would keep
    presenting the retired credential.
    """
    import msal

    secret_digest = hashlib.sha256(client_secret.encode("utf-8")).hexdigest()
    key = (tenant_id, client_id, secret_digest)
    with _app_cache_lock:
        cached = _app_cache.get(key)
        if cached is not None:
            _app_cache.move_to_end(key)
            return cached

    app = msal.ConfidentialClientApplication(
        client_id,
        authority=_AUTHORITY_TEMPLATE.format(tenant=tenant_id),
        client_credential=client_secret,
    )

    with _app_cache_lock:
        _app_cache[key] = app
        _app_cache.move_to_end(key)
        while len(_app_cache) > _MAX_CACHED_APPS:
            _app_cache.popitem(last=False)
    return app


def _describe_failure(result: Optional[dict]) -> str:
    """Turn an msal error payload into something an administrator can act on."""
    error = (result or {}).get("error") or ""
    description = (result or {}).get("error_description") or ""
    # Microsoft's description is multi-line and ends with correlation and
    # timestamp lines that mean nothing on a settings screen.
    first_line = description.splitlines()[0].strip() if description else ""

    if "AADSTS90002" in description or error == "invalid_tenant":
        return (
            "Microsoft rejected the directory (tenant) ID: that tenant was not "
            "found. Check the value on the app registration's Overview page."
        )
    if error == "invalid_client" or "AADSTS7000215" in description:
        return (
            "Microsoft rejected the application credentials. Check the "
            "application (client) ID and that the client secret is the secret "
            "*value* (not its ID) and has not expired."
        )
    if error == "unauthorized_client":
        return (
            "The application is not authorized for this tenant. Confirm the "
            "app registration belongs to the directory you named."
        )
    if "AADSTS7000222" in description:
        return "The client secret has expired. Create a new secret in Entra ID."
    if first_line:
        return f"Microsoft rejected the token request: {first_line}"
    return "Microsoft rejected the token request for the Microsoft 365 application."


def acquire_access_token(tenant_id: Any, client_id: Any, client_secret: Any) -> str:
    """Return an Exchange Online access token for the app registration.

    Raises ``MicrosoftOAuthError`` with an administrator-facing message when
    the credentials are malformed or Microsoft declines the request.
    """
    tenant = validate_tenant_id(tenant_id)
    client = validate_client_id(client_id)
    if not isinstance(client_secret, str) or not client_secret:
        raise MicrosoftOAuthError("Microsoft 365 client secret is required")

    app = _client_app(tenant, client, client_secret)
    # msal serves a cached token when one is still valid, so this is not a
    # network round trip on every send.
    result = app.acquire_token_for_client(scopes=[MICROSOFT_OAUTH_SCOPE])

    token = (result or {}).get("access_token")
    if not token:
        message = _describe_failure(result)
        logger.error(
            "Microsoft 365 OAuth token request failed: error={} tenant={}",
            (result or {}).get("error"),
            tenant,
        )
        raise MicrosoftOAuthError(message)
    return token
