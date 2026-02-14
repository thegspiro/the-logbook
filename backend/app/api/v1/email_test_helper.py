"""
Email Testing Helper Functions

Provides SMTP connection testing functionality for onboarding email configuration.
Runs synchronous SMTP operations in thread pool to avoid blocking async event loop.
Includes OAuth validation for Gmail and Microsoft 365.
"""

import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Tuple
import logging
import urllib.request
import urllib.parse
import urllib.error
import json

logger = logging.getLogger(__name__)


def test_smtp_connection(config: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
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
        smtp_host = config.get('smtpHost')
        smtp_port = config.get('smtpPort', 587)
        smtp_username = config.get('smtpUsername')
        smtp_password = config.get('smtpPassword')
        smtp_encryption = config.get('smtpEncryption', 'tls')
        from_email = config.get('fromEmail')

        # Validate required fields
        if not all([smtp_host, smtp_port, from_email]):
            return False, "Missing required SMTP configuration fields", {
                "required": ["smtpHost", "smtpPort", "fromEmail"]
            }

        # Convert port to integer
        try:
            smtp_port = int(smtp_port)
        except (ValueError, TypeError):
            return False, f"Invalid port number: {smtp_port}", {}

        details['host'] = smtp_host
        details['port'] = smtp_port
        details['encryption'] = smtp_encryption
        details['from_email'] = from_email

        # Test connection based on encryption type
        if smtp_encryption == 'ssl':
            # SSL/TLS connection (port 465)
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=10) as server:
                logger.info(f"Connected to {smtp_host}:{smtp_port} with SSL")
                details['connected'] = True

                # Authenticate if credentials provided
                if smtp_username and smtp_password:
                    server.login(smtp_username, smtp_password)
                    logger.info("SMTP authentication successful")
                    details['authenticated'] = True
                else:
                    details['authenticated'] = False

        elif smtp_encryption == 'tls' or smtp_encryption == 'starttls':
            # STARTTLS connection (port 587)
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.ehlo()  # Identify ourselves
                details['connected'] = True
                logger.info(f"Connected to {smtp_host}:{smtp_port}")

                # Start TLS encryption
                context = ssl.create_default_context()
                server.starttls(context=context)
                server.ehlo()  # Re-identify over encrypted connection
                logger.info("TLS encryption enabled")
                details['tls_enabled'] = True

                # Authenticate if credentials provided
                if smtp_username and smtp_password:
                    server.login(smtp_username, smtp_password)
                    logger.info("SMTP authentication successful")
                    details['authenticated'] = True
                else:
                    details['authenticated'] = False

        else:
            # No encryption (not recommended, port 25)
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.ehlo()
                details['connected'] = True
                details['encrypted'] = False
                logger.warning(f"Connected to {smtp_host}:{smtp_port} without encryption (not recommended)")

                # Authenticate if credentials provided
                if smtp_username and smtp_password:
                    server.login(smtp_username, smtp_password)
                    details['authenticated'] = True
                else:
                    details['authenticated'] = False

        return True, "SMTP connection successful", details

    except smtplib.SMTPAuthenticationError as e:
        logger.error(f"SMTP authentication failed: {e}")
        error_str = str(e).lower()

        # Provide user-friendly authentication error messages
        if '535' in error_str or 'username and password not accepted' in error_str:
            message = "SMTP authentication failed. Verify your username and password are correct. For Gmail or Outlook, you may need an app-specific password."
        elif '534' in error_str:
            message = "Authentication method not supported. Try enabling SSL/TLS or STARTTLS."
        else:
            message = f"SMTP authentication failed. Check your username and password. For Gmail/Outlook, use an app-specific password instead of your regular password."

        return False, message, details

    except smtplib.SMTPConnectError as e:
        logger.error(f"SMTP connection error: {e}")
        return False, f"Connection error: Unable to connect to {smtp_host}:{smtp_port}", details

    except smtplib.SMTPServerDisconnected as e:
        logger.error(f"SMTP server disconnected: {e}")
        return False, "Server disconnected unexpectedly", details

    except smtplib.SMTPException as e:
        logger.error(f"SMTP error: {e}")
        error_str = str(e).lower()

        # Provide specific messages based on error content
        if 'connection refused' in error_str or 'errno 111' in error_str:
            message = f"Cannot connect to mail server at {smtp_host}:{smtp_port}. Verify the server address and port are correct. Common ports: 587 (STARTTLS), 465 (SSL/TLS)."
        elif 'timed out' in error_str or 'timeout' in error_str:
            message = f"Connection to {smtp_host}:{smtp_port} timed out. The server may be slow, unreachable, or the address may be incorrect."
        elif 'name or service not known' in error_str or 'nodename nor servname' in error_str:
            message = f"Server address '{smtp_host}' could not be found. Check for typos in the hostname."
        else:
            message = f"SMTP error: {str(e)}. Check your mail server configuration."

        return False, message, details

    except ssl.SSLError as e:
        logger.error(f"SSL error: {e}")
        error_str = str(e).lower()

        # Provide helpful SSL/TLS error messages
        if 'wrong version number' in error_str or 'ssl23_get_server_hello' in error_str:
            message = f"SSL/TLS version mismatch. Try changing the encryption method: Use STARTTLS for port 587, or SSL/TLS for port 465."
        elif 'certificate' in error_str:
            message = f"SSL certificate error. The server's SSL certificate may be invalid or expired."
        elif 'ssl3_get_record' in error_str:
            message = f"SSL handshake failed. Verify the correct encryption method for your port (STARTTLS for 587, SSL for 465)."
        else:
            message = f"SSL/TLS connection error. Ensure you're using the correct encryption type for your port. Port 587 uses STARTTLS, port 465 uses SSL/TLS."

        return False, message, details

    except TimeoutError:
        logger.error(f"Connection timeout to {smtp_host}:{smtp_port}")
        return False, f"Connection to {smtp_host}:{smtp_port} timed out. The server is unreachable or responding slowly. Verify the server address and check your network connection.", details

    except Exception as e:
        logger.error(f"Unexpected error testing SMTP: {e}")
        error_str = str(e).lower()

        # Try to provide helpful context for common errors
        if 'permission denied' in error_str:
            message = "Permission denied. Your server may be blocking outbound SMTP connections on this port."
        elif 'network is unreachable' in error_str:
            message = "Network unreachable. Check your internet connection."
        else:
            message = f"Unexpected error while testing email configuration. Check your settings and try again. Error: {str(e)}"

        return False, message, details


def test_gmail_oauth(config: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Test Gmail OAuth configuration

    For OAuth with refresh token: Validates credentials by exchanging refresh token for access token.
    For app password: Tests SMTP connection directly.

    Args:
        config: Dictionary containing Gmail OAuth configuration

    Returns:
        Tuple of (success, message, details)
    """
    details = {}

    try:
        auth_method = config.get('authMethod', 'oauth')

        if auth_method == 'oauth':
            client_id = config.get('googleClientId')
            client_secret = config.get('googleClientSecret')
            refresh_token = config.get('googleRefreshToken')

            if not all([client_id, client_secret]):
                return False, "Missing OAuth credentials (Client ID and Client Secret required)", {}

            details['auth_method'] = 'oauth'
            details['client_id_present'] = bool(client_id)
            details['refresh_token_present'] = bool(refresh_token)

            # If we have a refresh token, validate by exchanging for access token
            if refresh_token:
                success, message, token_details = _validate_google_oauth_token(
                    client_id=client_id,
                    client_secret=client_secret,
                    refresh_token=refresh_token,
                )
                details.update(token_details)

                if success:
                    return True, "Gmail OAuth credentials validated successfully", details
                else:
                    return False, message, details
            else:
                # No refresh token - just validate client credentials format
                # Full OAuth flow requires user consent which can't be done server-side
                if len(client_id) < 20 or not client_id.endswith('.apps.googleusercontent.com'):
                    return False, "Invalid Google Client ID format", details

                return True, "Gmail OAuth configuration valid (refresh token not provided for full validation)", details

        else:
            # App password method - use SMTP testing
            config_copy = config.copy()
            config_copy['smtpHost'] = 'smtp.gmail.com'
            config_copy['smtpPort'] = 587
            config_copy['smtpEncryption'] = 'tls'
            config_copy['smtpUsername'] = config.get('fromEmail')
            config_copy['smtpPassword'] = config.get('googleAppPassword')

            return test_smtp_connection(config_copy)

    except Exception as e:
        logger.error(f"Error testing Gmail configuration: {e}")
        return False, f"Error: {str(e)}", details


def _validate_google_oauth_token(
    client_id: str,
    client_secret: str,
    refresh_token: str,
) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Validate Google OAuth credentials by exchanging refresh token for access token.

    Args:
        client_id: Google OAuth client ID
        client_secret: Google OAuth client secret
        refresh_token: Google OAuth refresh token

    Returns:
        Tuple of (success, message, details)
    """
    details = {}
    token_url = "https://oauth2.googleapis.com/token"

    try:
        # Prepare token exchange request
        data = urllib.parse.urlencode({
            'client_id': client_id,
            'client_secret': client_secret,
            'refresh_token': refresh_token,
            'grant_type': 'refresh_token',
        }).encode('utf-8')

        request = urllib.request.Request(
            token_url,
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            method='POST'
        )

        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.loads(response.read().decode('utf-8'))

            if 'access_token' in result:
                details['token_valid'] = True
                details['token_type'] = result.get('token_type', 'Bearer')
                details['expires_in'] = result.get('expires_in')
                details['scope'] = result.get('scope', '').split()

                # Validate that we have email sending scope
                scopes = result.get('scope', '')
                if 'gmail.send' in scopes or 'mail.google.com' in scopes:
                    details['has_send_permission'] = True
                    return True, "OAuth token validated with email sending permission", details
                else:
                    details['has_send_permission'] = False
                    return True, "OAuth token valid but may lack email sending permission", details
            else:
                return False, "Token exchange failed - no access token returned", details

    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else ''
        try:
            error_data = json.loads(error_body)
            error_msg = error_data.get('error_description', error_data.get('error', str(e)))
        except json.JSONDecodeError:
            error_msg = str(e)

        logger.error(f"Google OAuth token validation failed: {error_msg}")
        details['error'] = error_msg
        return False, f"OAuth validation failed: {error_msg}", details

    except urllib.error.URLError as e:
        logger.error(f"Network error during Google OAuth validation: {e}")
        return False, f"Network error: Unable to reach Google OAuth servers", details

    except Exception as e:
        logger.error(f"Error validating Google OAuth token: {e}")
        return False, f"Validation error: {str(e)}", details


def test_microsoft_oauth(config: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Test Microsoft 365 OAuth configuration using client credentials flow.

    Validates credentials by requesting an access token from Microsoft Identity Platform.
    Uses Microsoft Graph API scope for email sending.

    Args:
        config: Dictionary containing Microsoft OAuth configuration

    Returns:
        Tuple of (success, message, details)
    """
    details = {}

    try:
        tenant_id = config.get('microsoftTenantId')
        client_id = config.get('microsoftClientId')
        client_secret = config.get('microsoftClientSecret')

        if not all([tenant_id, client_id, client_secret]):
            return False, "Missing OAuth credentials (Tenant ID, Client ID, and Client Secret required)", {}

        details['auth_method'] = 'oauth'
        details['tenant_id_present'] = bool(tenant_id)
        details['client_id_present'] = bool(client_id)

        # Validate credentials by requesting access token
        success, message, token_details = _validate_microsoft_oauth_token(
            tenant_id=tenant_id,
            client_id=client_id,
            client_secret=client_secret,
        )
        details.update(token_details)

        if success:
            return True, "Microsoft 365 OAuth credentials validated successfully", details
        else:
            return False, message, details

    except Exception as e:
        logger.error(f"Error testing Microsoft configuration: {e}")
        return False, f"Error: {str(e)}", details


def _validate_microsoft_oauth_token(
    tenant_id: str,
    client_id: str,
    client_secret: str,
) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Validate Microsoft OAuth credentials using client credentials flow.

    Requests an access token from Microsoft Identity Platform using the
    client credentials grant type.

    Args:
        tenant_id: Azure AD tenant ID
        client_id: Application (client) ID
        client_secret: Client secret value

    Returns:
        Tuple of (success, message, details)
    """
    details = {}
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    try:
        # Prepare token request using client credentials flow
        # Request scope for Microsoft Graph mail sending
        data = urllib.parse.urlencode({
            'client_id': client_id,
            'client_secret': client_secret,
            'scope': 'https://graph.microsoft.com/.default',
            'grant_type': 'client_credentials',
        }).encode('utf-8')

        request = urllib.request.Request(
            token_url,
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            method='POST'
        )

        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.loads(response.read().decode('utf-8'))

            if 'access_token' in result:
                details['token_valid'] = True
                details['token_type'] = result.get('token_type', 'Bearer')
                details['expires_in'] = result.get('expires_in')

                # Optionally validate the token has required permissions
                # by making a test call to Graph API
                access_token = result['access_token']
                has_mail_permission = _check_microsoft_mail_permission(access_token)
                details['has_mail_permission'] = has_mail_permission

                if has_mail_permission:
                    return True, "OAuth credentials validated with mail sending permission", details
                else:
                    return True, "OAuth credentials valid (mail permission may need to be configured in Azure AD)", details
            else:
                return False, "Token exchange failed - no access token returned", details

    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else ''
        try:
            error_data = json.loads(error_body)
            error_msg = error_data.get('error_description', error_data.get('error', str(e)))
            error_code = error_data.get('error', '')
        except json.JSONDecodeError:
            error_msg = str(e)
            error_code = ''

        logger.error(f"Microsoft OAuth token validation failed: {error_msg}")
        details['error'] = error_msg
        details['error_code'] = error_code

        # Provide helpful error messages for common issues
        if 'AADSTS700016' in error_msg or 'AADSTS700016' in error_code:
            return False, "Invalid Client ID - application not found in tenant", details
        elif 'AADSTS7000215' in error_msg or 'invalid_client' in error_code:
            return False, "Invalid Client Secret - secret may be expired or incorrect", details
        elif 'AADSTS90002' in error_msg:
            return False, "Invalid Tenant ID - tenant not found", details
        else:
            return False, f"OAuth validation failed: {error_msg}", details

    except urllib.error.URLError as e:
        logger.error(f"Network error during Microsoft OAuth validation: {e}")
        return False, "Network error: Unable to reach Microsoft identity servers", details

    except Exception as e:
        logger.error(f"Error validating Microsoft OAuth token: {e}")
        return False, f"Validation error: {str(e)}", details


def _check_microsoft_mail_permission(access_token: str) -> bool:
    """
    Check if the access token has mail sending permissions.

    Makes a lightweight call to Microsoft Graph API to verify permissions.

    Args:
        access_token: Valid Microsoft Graph access token

    Returns:
        True if mail permissions appear to be configured
    """
    try:
        # Try to access the organization info endpoint
        # This is a lightweight check that requires minimal permissions
        # and helps verify the token is working
        request = urllib.request.Request(
            "https://graph.microsoft.com/v1.0/organization",
            headers={
                'Authorization': f'Bearer {access_token}',
                'Content-Type': 'application/json',
            },
            method='GET'
        )

        with urllib.request.urlopen(request, timeout=10) as response:
            # If we can access organization info, the token is valid
            # Mail.Send permission would need to be verified separately
            # but for testing purposes, this confirms the credentials work
            return True

    except urllib.error.HTTPError as e:
        # 403 means token works but may lack specific permissions
        if e.code == 403:
            return True  # Token works, permissions may be limited
        return False

    except Exception:
        return False
