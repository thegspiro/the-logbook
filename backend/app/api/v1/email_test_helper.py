"""
Email Testing Helper Functions

Provides SMTP connection testing functionality for onboarding email configuration.
Runs synchronous SMTP operations in thread pool to avoid blocking async event loop.
Gmail and Microsoft 365 are tested as SMTP submission with an App Password;
Cloudflare is verified through its REST API.
"""

import json
import smtplib
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from loguru import logger

from app.utils.email_providers import normalize_app_password, resolve_smtp_settings


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
        smtp_username = config.get("smtpUsername")
        smtp_password = config.get("smtpPassword")
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

                # Authenticate if credentials provided
                if smtp_username and smtp_password:
                    server.login(smtp_username, smtp_password)
                    logger.info("SMTP authentication successful")
                    details["authenticated"] = True
                else:
                    details["authenticated"] = False

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

                # Authenticate if credentials provided
                if smtp_username and smtp_password:
                    server.login(smtp_username, smtp_password)
                    logger.info("SMTP authentication successful")
                    details["authenticated"] = True
                else:
                    details["authenticated"] = False

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

                # Authenticate if credentials provided
                if smtp_username and smtp_password:
                    server.login(smtp_username, smtp_password)
                    details["authenticated"] = True
                else:
                    details["authenticated"] = False

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


def _provider_smtp_config(platform: str, config: dict[str, Any]) -> dict[str, Any]:
    """Translate a Gmail / Microsoft 365 test request into SMTP test settings.

    The request carries the onboarding form's camelCase keys; the preset
    resolver reads the snake_case settings shape, so map into that, resolve,
    and map back. Keeping the resolver as the single authority means the
    connection test exercises exactly the host, port and login the sender
    will use.
    """
    resolved = resolve_smtp_settings(
        {
            "platform": platform,
            "from_email": config.get("fromEmail"),
            "google_app_password": config.get("googleAppPassword"),
            "microsoft_app_password": config.get("microsoftAppPassword"),
        }
    )
    config_copy = config.copy()
    config_copy["smtpHost"] = resolved["host"]
    config_copy["smtpPort"] = resolved["port"]
    config_copy["smtpEncryption"] = resolved["encryption"]
    config_copy["smtpUsername"] = resolved["user"]
    config_copy["smtpPassword"] = resolved["password"]
    return config_copy


def _test_provider_connection(
    platform: str, label: str, config: dict[str, Any]
) -> tuple[bool, str, dict[str, Any]]:
    password_key = (
        "googleAppPassword" if platform == "gmail" else "microsoftAppPassword"
    )
    if not config.get("fromEmail"):
        return False, f"{label} account email address is required", {}
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

    Requires SMTP AUTH to be enabled for the mailbox in Exchange Online and,
    where the tenant enforces multi-factor sign-in, an App Password.
    """
    return _test_provider_connection("microsoft", "Microsoft 365", config)


def test_cloudflare_email(
    config: dict[str, Any],
) -> tuple[bool, str, dict[str, Any]]:
    """
    Test Cloudflare Email Service configuration by calling the Cloudflare API
    to verify the account ID and API token are valid.

    Uses the Email Routing zones endpoint as a lightweight connectivity check
    (actual send permission is confirmed by a successful token validation).

    Args:
        config: Dictionary containing cloudflareAccountId and cloudflareApiToken

    Returns:
        Tuple of (success, message, details)
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

    import re

    if not re.fullmatch(r"[a-f0-9]{32}", account_id):
        return (
            False,
            "Invalid Account ID format. It should be a 32-character hex string "
            "from your Cloudflare dashboard.",
            {},
        )

    details["account_id_present"] = True
    details["api_token_present"] = True

    try:
        # Verify the API token by calling the token verification endpoint
        verify_url = "https://api.cloudflare.com/client/v4/user/tokens/verify"
        request = urllib.request.Request(
            verify_url,
            headers={
                "Authorization": f"Bearer {api_token}",
                "Content-Type": "application/json",
            },
            method="GET",
        )

        with _https_urlopen(request, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))

            if result.get("success"):
                details["token_valid"] = True
                token_status = result.get("result", {}).get("status", "unknown")
                details["token_status"] = token_status

                if token_status == "active":
                    return (
                        True,
                        "Cloudflare API token verified successfully",
                        details,
                    )
                else:
                    return (
                        False,
                        f"Cloudflare API token status: {token_status}",
                        details,
                    )
            else:
                errors = result.get("errors", [])
                error_msg = errors[0].get("message") if errors else "Unknown error"
                details["token_valid"] = False
                return (
                    False,
                    f"Cloudflare API token verification failed: {error_msg}",
                    details,
                )

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        try:
            error_data = json.loads(error_body)
            errors = error_data.get("errors", [])
            error_msg = errors[0].get("message") if errors else str(e)
        except (json.JSONDecodeError, IndexError):
            error_msg = str(e)

        logger.error("Cloudflare API token verification failed: {}", error_msg)

        if e.code == 401:
            return (
                False,
                "Invalid API token. Check that the token is correct and has "
                "not been revoked.",
                details,
            )
        elif e.code == 403:
            return (
                False,
                "API token lacks required permissions. Ensure the token has "
                "email sending permission.",
                details,
            )
        else:
            return (
                False,
                f"Cloudflare API error (HTTP {e.code}): {error_msg}",
                details,
            )

    except urllib.error.URLError as e:
        logger.error("Network error during Cloudflare API verification: {}", e)
        return (
            False,
            "Network error: Unable to reach Cloudflare API servers",
            details,
        )

    except Exception as e:
        logger.error("Error testing Cloudflare email configuration: {}", e)
        return False, f"Unexpected error: {str(e)}", details
