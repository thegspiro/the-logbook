"""Delegated service-account tokens for sending mail through the Gmail API.

An App Password is tied to the Google account's password: changing that
password revokes every App Password on it, and email stops with nothing in
The Logbook having changed. A user-consent OAuth refresh token does not help,
because Google revokes tokens carrying Gmail scopes on a password change too.
A service account with domain-wide delegation is the one credential that is
not tied to a person's password, so it is what a Google Workspace department
uses to send without that failure mode.

The scope is ``gmail.send`` and nothing broader. Gmail's SMTP server accepts
only ``https://mail.google.com/`` over XOAUTH2 — full read and delete access
to the mailbox — and domain-wide delegation cannot be limited to one mailbox,
so that scope would let whoever holds the key read every mailbox in the
domain. The Gmail API's send method accepts ``gmail.send``, which is why
delegated sending goes through the API rather than SMTP.

Delegation still cannot be limited to one mailbox: the key can send as any
user in the domain. That is recorded in docs/KNOWN_LIMITATIONS.md, and it is
why configuring this method requires ``admin.access``.
"""

import hashlib
import json
import threading
from collections import OrderedDict
from typing import Any, Optional

from loguru import logger

GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"

# The token endpoint every service account key Google Cloud issues carries.
# ``Credentials.from_service_account_info`` sends the signed JWT assertion to
# whatever ``token_uri`` the key names, so an admin-pasted key with a
# different value would make this process POST that assertion to a host of
# the admin's choosing — the same SSRF shape ``microsoft_oauth.py``'s
# ``tenant_id`` validation exists to close, except here there is no
# legitimate value other than Google's own endpoint to allow.
_GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"

# google-auth's requests transport waits 120 seconds by default. A real send
# runs this in a worker thread with no outer deadline, so an unreachable token
# endpoint would hold that thread for two minutes per message; the connection
# test's own budget is 30 seconds.
GOOGLE_TOKEN_TIMEOUT_SECONDS = 10

# One entry per distinct (key, sending address). Bounded because this dict
# lives for the life of the process (CLAUDE.md pitfall 9).
_MAX_CACHED_CREDENTIALS = 32


class GoogleOAuthError(ValueError):
    """A Gmail send token could not be obtained.

    A ``ValueError`` so the endpoint layer reports it as a 400 through
    ``safe_error_detail``: every cause is a key, delegation or account
    problem the administrator can act on, not a server fault.
    """


class _Entry:
    __slots__ = ("credentials", "lock")

    def __init__(self, credentials: Any) -> None:
        self.credentials = credentials
        self.lock = threading.Lock()


_cache: "OrderedDict[str, _Entry]" = OrderedDict()
_cache_lock = threading.Lock()


def parse_service_account_key(value: Any) -> dict[str, Any]:
    """The service-account key as a dict, or ``GoogleOAuthError`` saying why not.

    Checked on every write path as well as at send time, so a key that cannot
    sign a token never saves green.
    """
    if isinstance(value, dict):
        info = value
    elif isinstance(value, str) and value.strip():
        try:
            info = json.loads(value)
        except ValueError:
            raise GoogleOAuthError(
                "The service account key is not valid JSON. Upload the JSON "
                "key file downloaded from Google Cloud."
            ) from None
    else:
        raise GoogleOAuthError("A Google service account key is required")
    if not isinstance(info, dict) or info.get("type") != "service_account":
        raise GoogleOAuthError(
            "The key must be a service account key (type service_account) "
            "downloaded from Google Cloud."
        )
    for field in ("client_email", "client_id", "private_key", "token_uri"):
        if not isinstance(info.get(field), str) or not info[field]:
            raise GoogleOAuthError(
                f"The service account key is missing {field}. Download a new "
                "JSON key from Google Cloud."
            )
    if info["token_uri"] != _GOOGLE_TOKEN_URI:
        raise GoogleOAuthError(
            "The service account key's token_uri is not Google's own token "
            f"endpoint ({_GOOGLE_TOKEN_URI}). Download a fresh, unedited JSON "
            "key from Google Cloud."
        )
    return info


def service_account_client_id(value: Any) -> Optional[str]:
    """The numeric client ID an administrator authorizes in the Admin console."""
    try:
        return str(parse_service_account_key(value)["client_id"])
    except GoogleOAuthError:
        return None


class _TimedRequest:
    """google-auth's requests transport with a bounded timeout.

    The token refresh calls the transport without a timeout argument, so the
    library's 120-second default applies unless the transport supplies one.
    """

    def __init__(self) -> None:
        from google.auth.transport.requests import Request

        self._request = Request()

    def __call__(self, url: str, method: str = "GET", **kwargs: Any) -> Any:
        kwargs["timeout"] = GOOGLE_TOKEN_TIMEOUT_SECONDS
        return self._request(url, method=method, **kwargs)


def _cache_key(info: dict[str, Any], subject: str) -> str:
    material = json.dumps(
        [info.get("client_email"), info.get("private_key_id"), info["private_key"]],
        sort_keys=True,
    )
    return hashlib.sha256(f"{material}\0{subject.lower()}".encode()).hexdigest()


def _entry_for(info: dict[str, Any], subject: str) -> _Entry:
    key = _cache_key(info, subject)
    with _cache_lock:
        entry = _cache.get(key)
        if entry is not None:
            _cache.move_to_end(key)
            return entry
    from google.oauth2 import service_account

    try:
        credentials = service_account.Credentials.from_service_account_info(
            info, scopes=[GMAIL_SEND_SCOPE], subject=subject
        )
    except ValueError:
        # Raised for a private key that does not parse. Its message can quote
        # key material, so it is replaced rather than passed on.
        raise GoogleOAuthError(
            "The service account key could not be read. Download a new JSON "
            "key from Google Cloud."
        ) from None
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            entry = _Entry(credentials)
            _cache[key] = entry
            while len(_cache) > _MAX_CACHED_CREDENTIALS:
                _cache.popitem(last=False)
        _cache.move_to_end(key)
        return entry


def _refresh_error_message(exc: Exception, client_id: str) -> str:
    """Name what the administrator has to fix, from Google's error code.

    Only the OAuth error code is read; Google's description is not passed on,
    since the code is what decides the fix and the description adds nothing
    the administrator can act on.
    """
    text = str(exc)
    if "unauthorized_client" in text:
        return (
            "Google refused delegation for this service account. In the Google "
            "Admin console, open Security > API controls > Domain-wide "
            f"delegation and authorize client ID {client_id} for the scope "
            f"{GMAIL_SEND_SCOPE}."
        )
    if "invalid_grant" in text:
        return (
            "Google refused the key or the sending account. Check that the From "
            "address is an active user in your Google Workspace domain and that "
            "this key has not been deleted in Google Cloud."
        )
    return (
        "Google did not issue a token for this service account. Check the key "
        "and its domain-wide delegation in the Google Admin console."
    )


def acquire_gmail_send_token(key: Any, subject: str) -> str:
    """An access token for sending as ``subject`` through the Gmail API.

    Blocking: call it from a worker thread. The credentials are cached, so a
    token is only requested when the previous one has expired.
    """
    from google.auth.exceptions import RefreshError, TransportError

    if not isinstance(subject, str) or "@" not in subject:
        raise GoogleOAuthError("A From address is required to send through Gmail")
    info = parse_service_account_key(key)
    entry = _entry_for(info, subject)
    with entry.lock:
        credentials = entry.credentials
        if credentials.valid and credentials.token:
            return str(credentials.token)
        try:
            credentials.refresh(_TimedRequest())
        except RefreshError as e:
            raise GoogleOAuthError(
                _refresh_error_message(e, str(info["client_id"]))
            ) from None
        except TransportError as e:
            logger.warning(
                "Google token request failed: {}", type(e.__cause__ or e).__name__
            )
            raise GoogleOAuthError(
                "Could not reach Google to obtain an access token. Check "
                "outbound access to oauth2.googleapis.com."
            ) from None
        return str(credentials.token)


def forget_cached_credentials() -> None:
    """Drop every cached credential. For tests."""
    with _cache_lock:
        _cache.clear()
