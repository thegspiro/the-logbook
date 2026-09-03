"""
Email Testing Helper Functions

Provides SMTP connection testing functionality for onboarding email configuration.
Runs synchronous SMTP operations in thread pool to avoid blocking async event loop.
Gmail and Microsoft 365 are tested as SMTP submission with an App Password;
Cloudflare is verified through its REST API.
"""

import json
import re
import smtplib
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, NamedTuple, Optional

from loguru import logger

from app.utils.email_providers import (
    normalize_app_password,
    resolve_smtp_settings,
    uses_microsoft_oauth,
)
from app.utils.microsoft_oauth import (
    MicrosoftOAuthError,
    acquire_access_token,
    xoauth2_string,
)


def _https_urlopen(request: urllib.request.Request, timeout: int = 10):
    """urlopen restricted to https.

    Every provider endpoint in this module is a hardcoded https URL, but
    urlopen itself would also follow file:// or custom schemes — guard the
    scheme centrally so a refactor can't silently widen it (Bandit B310).
    """
    scheme = urllib.parse.urlparse(request.full_url).scheme
    if scheme != "https":
        raise ValueError(f"Refusing non-https URL scheme: {scheme!r}")
    return urllib.request.urlopen(request, timeout=timeout)  # nosec B310


def _authenticate(
    server: smtplib.SMTP, config: dict[str, Any], details: dict[str, Any]
) -> None:
    """Sign in to an already-connected server, if credentials were supplied.

    A bearer token (Microsoft 365 on the client credentials flow) is
    presented over SASL XOAUTH2; smtplib base64-encodes what the callback
    returns and may call it with or without the server's challenge. Anything
    else is an ordinary password login. No credentials at all is a valid
    configuration for a relay that accepts unauthenticated submission.
    """
    username = config.get("smtpUsername")
    oauth_token = config.get("smtpOAuthToken")

    if username and oauth_token:
        auth_string = xoauth2_string(username, oauth_token)
        server.auth("XOAUTH2", lambda challenge=None: auth_string)
        logger.info("SMTP XOAUTH2 authentication successful")
        details["authenticated"] = True
        details["auth_method"] = "oauth"
        return

    password = config.get("smtpPassword")
    if username and password:
        server.login(username, password)
        logger.info("SMTP authentication successful")
        details["authenticated"] = True
        details["auth_method"] = "password"
        return

    details["authenticated"] = False


def test_smtp_connection(config: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
    """
    Test SMTP connection with provided configuration

    Args:
        config: Dictionary containing SMTP configuration

    Returns:
        Tuple of (success, message, details)
    """
    details = {}

    try:
        # Extract configuration
        smtp_host = config.get("smtpHost")
        smtp_port = config.get("smtpPort", 587)
        smtp_encryption = config.get("smtpEncryption", "tls")
        from_email = config.get("fromEmail")

        # Validate required fields
        if not all([smtp_host, smtp_port, from_email]):
            return (
                False,
                "Missing required SMTP configuration fields",
                {"required": ["smtpHost", "smtpPort", "fromEmail"]},
            )

        # Convert port to integer
        try:
            smtp_port = int(smtp_port)
        except (ValueError, TypeError):
            return False, f"Invalid port number: {smtp_port}", {}

        details["host"] = smtp_host
        details["port"] = smtp_port
        details["encryption"] = smtp_encryption
        details["from_email"] = from_email

        # Test connection based on encryption type
        if smtp_encryption == "ssl":
            # SSL/TLS connection (port 465)
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(
                smtp_host, smtp_port, context=context, timeout=10
            ) as server:
                logger.info("Connected to {}:{} with SSL", smtp_host, smtp_port)
                details["connected"] = True

                _authenticate(server, config, details)

        elif smtp_encryption == "tls" or smtp_encryption == "starttls":
            # STARTTLS connection (port 587)
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.ehlo()  # Identify ourselves
                details["connected"] = True
                logger.info("Connected to {}:{}", smtp_host, smtp_port)

                # Start TLS encryption
                context = ssl.create_default_context()
                server.starttls(context=context)
                server.ehlo()  # Re-identify over encrypted connection
                logger.info("TLS encryption enabled")
                details["tls_enabled"] = True

                _authenticate(server, config, details)

        else:
            # No encryption (not recommended, port 25)
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.ehlo()
                details["connected"] = True
                details["encrypted"] = False
                logger.warning(
                    "Connected to {}:{} without encryption (not recommended)",
                    smtp_host,
                    smtp_port,
                )

                _authenticate(server, config, details)

        return True, "SMTP connection successful", details

    except smtplib.SMTPAuthenticationError as e:
        logger.error("SMTP authentication failed: {}", e)
        error_str = str(e).lower()

        # Provide user-friendly authentication error messages
        if "535" in error_str or "username and password not accepted" in error_str:
            message = "SMTP authentication failed. Verify your username and password are correct. For Gmail or Outlook, you may need an app-specific password."
        elif "534" in error_str:
            message = (
                "Authentication method not supported. Try enabling SSL/TLS or STARTTLS."
            )
        else:
            message = "SMTP authentication failed. Check your username and password. For Gmail/Outlook, use an app-specific password instead of your regular password."

        return False, message, details

    except smtplib.SMTPConnectError as e:
        logger.error("SMTP connection error: {}", e)
        return (
            False,
            f"Connection error: Unable to connect to {smtp_host}:{smtp_port}",
            details,
        )

    except smtplib.SMTPServerDisconnected as e:
        logger.error("SMTP server disconnected: {}", e)
        return False, "Server disconnected unexpectedly", details

    except smtplib.SMTPException as e:
        logger.error("SMTP error: {}", e)
        error_str = str(e).lower()

        # Provide specific messages based on error content
        if "connection refused" in error_str or "errno 111" in error_str:
            message = f"Cannot connect to mail server at {smtp_host}:{smtp_port}. Verify the server address and port are correct. Common ports: 587 (STARTTLS), 465 (SSL/TLS)."
        elif "timed out" in error_str or "timeout" in error_str:
            message = f"Connection to {smtp_host}:{smtp_port} timed out. The server may be slow, unreachable, or the address may be incorrect."
        elif (
            "name or service not known" in error_str
            or "nodename nor servname" in error_str
        ):
            message = f"Server address '{smtp_host}' could not be found. Check for typos in the hostname."
        else:
            message = f"SMTP error: {str(e)}. Check your mail server configuration."

        return False, message, details

    except ssl.SSLError as e:
        logger.error("SSL error: {}", e)
        error_str = str(e).lower()

        # Provide helpful SSL/TLS error messages
        if "wrong version number" in error_str or "ssl23_get_server_hello" in error_str:
            message = "SSL/TLS version mismatch. Try changing the encryption method: Use STARTTLS for port 587, or SSL/TLS for port 465."
        elif "certificate" in error_str:
            message = "SSL certificate error. The server's SSL certificate may be invalid or expired."
        elif "ssl3_get_record" in error_str:
            message = "SSL handshake failed. Verify the correct encryption method for your port (STARTTLS for 587, SSL for 465)."
        else:
            message = "SSL/TLS connection error. Ensure you're using the correct encryption type for your port. Port 587 uses STARTTLS, port 465 uses SSL/TLS."

        return False, message, details

    except TimeoutError:
        logger.error("Connection timeout to {}:{}", smtp_host, smtp_port)
        return (
            False,
            f"Connection to {smtp_host}:{smtp_port} timed out. The server is unreachable or responding slowly. Verify the server address and check your network connection.",
            details,
        )

    except Exception as e:
        logger.error("Unexpected error testing SMTP: {}", e)
        error_str = str(e).lower()

        # Try to provide helpful context for common errors
        if "permission denied" in error_str:
            message = "Permission denied. Your server may be blocking outbound SMTP connections on this port."
        elif "network is unreachable" in error_str:
            message = "Network unreachable. Check your internet connection."
        else:
            message = f"Unexpected error while testing email configuration. Check your settings and try again. Error: {str(e)}"

        return False, message, details


def _settings_shape(platform: str, config: dict[str, Any]) -> dict[str, Any]:
    """The snake_case ``email_service`` view of a camelCase test request.

    The request carries the onboarding form's keys; the preset resolver and
    the OAuth predicate both read the stored settings shape, so translate
    once here and keep those helpers as the single authority on what the
    sender will actually do.
    """
    return {
        "platform": platform,
        "from_email": config.get("fromEmail"),
        "google_app_password": config.get("googleAppPassword"),
        "microsoft_app_password": config.get("microsoftAppPassword"),
        "microsoft_auth_method": config.get("microsoftAuthMethod"),
        "microsoft_tenant_id": config.get("microsoftTenantId"),
        "microsoft_client_id": config.get("microsoftClientId"),
        "microsoft_client_secret": config.get("microsoftClientSecret"),
    }


def _provider_smtp_config(platform: str, config: dict[str, Any]) -> dict[str, Any]:
    """Translate a Gmail / Microsoft 365 test request into SMTP test settings.

    Keeping ``resolve_smtp_settings`` as the single authority means the
    connection test exercises exactly the host, port and login the sender
    will use.
    """
    resolved = resolve_smtp_settings(_settings_shape(platform, config))
    config_copy = config.copy()
    config_copy["smtpHost"] = resolved["host"]
    config_copy["smtpPort"] = resolved["port"]
    config_copy["smtpEncryption"] = resolved["encryption"]
    config_copy["smtpUsername"] = resolved["user"]
    config_copy["smtpPassword"] = resolved["password"]
    return config_copy


_OAUTH_FIELD_LABELS = (
    ("microsoftTenantId", "directory (tenant) ID"),
    ("microsoftClientId", "application (client) ID"),
    ("microsoftClientSecret", "client secret"),
)


def _test_microsoft_oauth_connection(
    config: dict[str, Any],
) -> tuple[bool, str, dict[str, Any]]:
    """Sign in to Exchange Online with an app-registration access token.

    Two distinct things can fail and the administrator fixes them in
    different places, so they are reported separately: Entra ID declining to
    issue a token (the app registration), and Exchange Online declining the
    token it issued (the SendAs grant on the mailbox, or SMTP AUTH being
    switched off for it).
    """
    missing = [key for key, _ in _OAUTH_FIELD_LABELS if not config.get(key)]
    if missing:
        labels = ", ".join(
            label for key, label in _OAUTH_FIELD_LABELS if key in missing
        )
        return (
            False,
            f"Microsoft 365 OAuth needs the {labels} from your Entra ID app "
            "registration.",
            {"required": missing},
        )

    try:
        token = acquire_access_token(
            config.get("microsoftTenantId"),
            config.get("microsoftClientId"),
            config.get("microsoftClientSecret"),
        )
    except MicrosoftOAuthError as e:
        return False, str(e), {"error": "token_request_failed"}

    smtp_config = _provider_smtp_config("microsoft", config)
    smtp_config["smtpOAuthToken"] = token
    success, message, details = test_smtp_connection(smtp_config)
    details["token_acquired"] = True
    if not success and details.get("connected"):
        # A token was issued and the server still refused it, so the app
        # registration is fine and the mailbox grant is what is missing.
        message = (
            "Entra ID issued an access token but Exchange Online refused it. "
            "Confirm the application has SendAs permission on this mailbox "
            "and that SMTP AUTH is enabled for it."
        )
    return success, message, details


def _test_provider_connection(
    platform: str, label: str, config: dict[str, Any]
) -> tuple[bool, str, dict[str, Any]]:
    if not config.get("fromEmail"):
        return False, f"{label} account email address is required", {}
    if uses_microsoft_oauth(_settings_shape(platform, config)):
        return _test_microsoft_oauth_connection(config)
    password_key = (
        "googleAppPassword" if platform == "gmail" else "microsoftAppPassword"
    )
    if normalize_app_password(config.get(password_key)) is None:
        return (
            False,
            f"{label} App Password is required",
            {"required": ["fromEmail", password_key]},
        )
    return test_smtp_connection(_provider_smtp_config(platform, config))


def test_gmail_connection(config: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
    """Test a Gmail / Google Workspace account by signing in to smtp.gmail.com.

    Gmail is SMTP submission behind an App Password (2-Step Verification must
    be on for the account). There is no OAuth path: the sender only speaks
    SMTP, so a test that validated OAuth client credentials was confirming
    something the system could never use.
    """
    return _test_provider_connection("gmail", "Gmail", config)


def test_microsoft_connection(
    config: dict[str, Any],
) -> tuple[bool, str, dict[str, Any]]:
    """Test a Microsoft 365 mailbox by signing in to smtp.office365.com.

    Either authentication method is exercised the way the sender will use
    it: an App Password over Basic auth, or an Entra ID app-registration
    token over XOAUTH2. Both require SMTP AUTH to be enabled for the mailbox
    in Exchange Online.
    """
    return _test_provider_connection("microsoft", "Microsoft 365", config)


class _TokenVerification(NamedTuple):
    """One call to a Cloudflare ``tokens/verify`` endpoint.

    ``ok`` is True only when Cloudflare answered that the token is valid;
    ``status`` is the token's own lifecycle status ("active", "expired",
    ...), which is a separate question from whether the call succeeded.
    """

    ok: bool
    status: Optional[str]
    message: Optional[str]
    http_status: Optional[int]
    network_error: bool = False


def _cloudflare_verify_token(url: str, api_token: str) -> _TokenVerification:
    """Ask one Cloudflare verify endpoint about a token."""
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        method="GET",
    )
    try:
        with _https_urlopen(request, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        try:
            error_data = json.loads(error_body)
            errors = error_data.get("errors", [])
            error_msg = errors[0].get("message") if errors else str(e)
        except (json.JSONDecodeError, IndexError, AttributeError):
            error_msg = str(e)
        return _TokenVerification(False, None, error_msg, e.code)
    except urllib.error.URLError as e:
        logger.error("Network error during Cloudflare API verification: {}", e)
        return _TokenVerification(
            False,
            None,
            "Network error: Unable to reach Cloudflare API servers",
            None,
            network_error=True,
        )

    if not result.get("success"):
        errors = result.get("errors", [])
        error_msg = errors[0].get("message") if errors else "Unknown error"
        return _TokenVerification(False, None, error_msg, 200)
    return _TokenVerification(
        True, (result.get("result") or {}).get("status", "unknown"), None, 200
    )


def _cloudflare_failure_message(verification: _TokenVerification) -> str:
    """The administrator-facing reason a verify call did not succeed."""
    if verification.network_error:
        return verification.message or "Network error: Unable to reach Cloudflare"
    if verification.http_status == 401:
        return (
            "Invalid API token. Check that the token is correct and has not "
            "been revoked."
        )
    if verification.http_status == 403:
        return (
            "API token lacks required permissions. Ensure the token has "
            "email sending permission."
        )
    if verification.http_status and verification.http_status != 200:
        return (
            f"Cloudflare API error (HTTP {verification.http_status}): "
            f"{verification.message}"
        )
    return f"Cloudflare API token verification failed: {verification.message}"


def test_cloudflare_email(
    config: dict[str, Any],
) -> tuple[bool, str, dict[str, Any]]:
    """Verify a Cloudflare Email Service token, against the account if possible.

    The sender posts to ``/accounts/{account_id}/email/sending/send``, so the
    account the token can reach is the thing that decides whether mail goes
    out. An account-owned token can be checked against exactly that account
    (``/accounts/{id}/tokens/verify``); a user-owned token is only verifiable
    at ``/user/tokens/verify``, which says the token is valid without saying
    which accounts it reaches.

    Rather than fail every department using a user-owned token that sends
    perfectly well today, an unconfirmable token passes and the message says
    what was not checked. ``details["account_scope_verified"]`` carries the
    same fact for anything reading the result programmatically.
    """
    details: dict[str, Any] = {}

    account_id = config.get("cloudflareAccountId")
    api_token = config.get("cloudflareApiToken")

    if not account_id or not api_token:
        return (
            False,
            "Missing required Cloudflare credentials (Account ID and API Token)",
            {"required": ["cloudflareAccountId", "cloudflareApiToken"]},
        )

    if not re.fullmatch(r"[a-f0-9]{32}", account_id):
        return (
            False,
            "Invalid Account ID format. It should be a 32-character hex string "
            "from your Cloudflare dashboard.",
            {},
        )

    details["account_id_present"] = True
    details["api_token_present"] = True

    base = "https://api.cloudflare.com/client/v4"
    account_check = _cloudflare_verify_token(
        f"{base}/accounts/{account_id}/tokens/verify", api_token
    )

    if account_check.ok:
        details["token_valid"] = True
        details["token_status"] = account_check.status
        details["account_scope_verified"] = True
        if account_check.status != "active":
            return (
                False,
                f"Cloudflare API token status: {account_check.status}",
                details,
            )
        return (
            True,
            "Cloudflare API token verified for this account",
            details,
        )

    # Not an account-owned token for this account — which is not yet a
    # failure, because a user-owned token is verified elsewhere. Ask the
    # endpoint that can answer for it.
    user_check = _cloudflare_verify_token(f"{base}/user/tokens/verify", api_token)

    if not user_check.ok:
        details["token_valid"] = False
        details["account_scope_verified"] = False
        failed = user_check if user_check.network_error else account_check
        if not user_check.network_error and user_check.http_status in (401, 403):
            failed = user_check
        return False, _cloudflare_failure_message(failed), details

    details["token_valid"] = True
    details["token_status"] = user_check.status
    details["account_scope_verified"] = False

    if user_check.status != "active":
        return False, f"Cloudflare API token status: {user_check.status}", details

    return (
        True,
        "Cloudflare API token is valid. It is a user-owned token, so access to "
        f"account {account_id} could not be confirmed here — if sending fails, "
        "check that the token grants email sending on that account.",
        details,
    )
