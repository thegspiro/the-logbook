"""
Email Testing Helper Functions

Provides SMTP connection testing functionality for onboarding email configuration.
Runs synchronous SMTP operations in thread pool to avoid blocking async event loop.
"""

import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Tuple
import logging

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
        return False, f"Authentication failed: {str(e)}", details

    except smtplib.SMTPConnectError as e:
        logger.error(f"SMTP connection error: {e}")
        return False, f"Connection error: Unable to connect to {smtp_host}:{smtp_port}", details

    except smtplib.SMTPServerDisconnected as e:
        logger.error(f"SMTP server disconnected: {e}")
        return False, "Server disconnected unexpectedly", details

    except smtplib.SMTPException as e:
        logger.error(f"SMTP error: {e}")
        return False, f"SMTP error: {str(e)}", details

    except ssl.SSLError as e:
        logger.error(f"SSL error: {e}")
        return False, f"SSL/TLS error: {str(e)}", details

    except TimeoutError:
        logger.error(f"Connection timeout to {smtp_host}:{smtp_port}")
        return False, f"Connection timeout: Unable to reach {smtp_host}:{smtp_port}", details

    except Exception as e:
        logger.error(f"Unexpected error testing SMTP: {e}")
        return False, f"Unexpected error: {str(e)}", details


def test_gmail_oauth(config: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Test Gmail OAuth configuration

    Note: Actual OAuth testing requires implementing OAuth flow.
    This is a placeholder that validates configuration presence.

    Args:
        config: Dictionary containing Gmail OAuth configuration

    Returns:
        Tuple of (success, message, details)
    """
    details = {}

    try:
        auth_method = config.get('authMethod', 'oauth')

        if auth_method == 'oauth':
            # For OAuth, we would need to implement the full OAuth2 flow
            # For now, just validate that necessary fields are present
            client_id = config.get('googleClientId')
            client_secret = config.get('googleClientSecret')

            if not all([client_id, client_secret]):
                return False, "Missing OAuth credentials (Client ID and Client Secret required)", {}

            details['auth_method'] = 'oauth'
            details['client_id_present'] = bool(client_id)

            # TODO: Implement actual OAuth token exchange and validation
            return True, "Gmail OAuth configuration present (full OAuth flow not yet implemented)", details

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


def test_microsoft_oauth(config: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Test Microsoft 365 OAuth configuration

    Note: Actual OAuth testing requires implementing OAuth flow.
    This is a placeholder that validates configuration presence.

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

        # TODO: Implement actual Microsoft Graph API OAuth flow
        return True, "Microsoft 365 OAuth configuration present (full OAuth flow not yet implemented)", details

    except Exception as e:
        logger.error(f"Error testing Microsoft configuration: {e}")
        return False, f"Error: {str(e)}", details
