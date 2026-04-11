"""
Integration Services Package

Central dispatcher that routes integration actions to the correct
service based on integration_type.
"""

import logging
from typing import Any

from app.models.integration import Integration

logger = logging.getLogger(__name__)


async def test_integration_connection(integration: Integration) -> str:
    """
    Test connectivity for an integration. Delegates to the appropriate service.

    Returns:
        A human-readable status message.
    """
    itype = integration.integration_type
    config = integration.config or {}

    if itype == "slack":
        from app.services.integration_services.slack_service import send_test_message

        webhook_url = integration.get_secret("webhook_url") or config.get(
            "webhook_url", ""
        )
        if not webhook_url:
            raise Exception("No webhook URL configured")
        return await send_test_message(webhook_url)

    if itype == "discord":
        from app.services.integration_services.discord_service import send_test_message

        webhook_url = integration.get_secret("webhook_url") or config.get(
            "webhook_url", ""
        )
        if not webhook_url:
            raise Exception("No webhook URL configured")
        return await send_test_message(webhook_url)

    if itype == "microsoft-teams":
        from app.services.integration_services.teams_service import send_test_message

        webhook_url = integration.get_secret("webhook_url") or config.get(
            "webhook_url", ""
        )
        if not webhook_url:
            raise Exception("No webhook URL configured")
        return await send_test_message(webhook_url)

    if itype == "nws-weather":
        from app.services.integration_services.weather_service import test_zone

        zone_id = config.get("zone_id", "")
        if not zone_id:
            raise Exception("No NWS zone ID configured")
        return await test_zone(zone_id)

    if itype == "generic-webhook":
        from app.services.integration_services.webhook_service import send_test_webhook

        url = integration.get_secret("url") or config.get("url", "")
        secret = integration.get_secret("secret")
        if not url:
            raise Exception("No webhook URL configured")
        return await send_test_webhook(url, secret)

    if itype == "google-calendar":
        from app.services.integration_services.google_calendar_service import (
            GoogleCalendarService,
        )

        creds = _get_calendar_credentials(integration)
        service = GoogleCalendarService(creds)
        return await service.test_connection()

    if itype == "outlook":
        from app.services.integration_services.outlook_calendar_service import (
            OutlookCalendarService,
        )

        creds = _get_calendar_credentials(integration)
        service = OutlookCalendarService(creds)
        return await service.test_connection()

    if itype == "salesforce":
        from app.services.integration_services.salesforce_service import (
            SalesforceService,
        )

        creds = _get_salesforce_credentials(integration)
        service = SalesforceService(creds)
        return await service.test_connection()

    if itype == "ical":
        return "iCal feeds are read-only — no connection test needed"

    if itype in {"csv-import", "nfirs-export", "nemsis-export", "epcr-import"}:
        return "File-based integration — no connection test needed"

    raise Exception(f"Test not available for integration type: {itype}")


def _get_calendar_credentials(integration: Integration) -> dict[str, Any]:
    """Extract calendar credentials from encrypted storage."""
    creds: dict[str, Any] = {}
    for key in ("refresh_token", "client_id", "client_secret", "tenant_id", "token"):
        val = integration.get_secret(key)
        if val:
            creds[key] = val
    return creds


def _get_salesforce_credentials(integration: Integration) -> dict[str, Any]:
    """Extract Salesforce OAuth credentials from encrypted storage."""
    config = integration.config or {}
    creds: dict[str, Any] = {
        "instance_url": config.get("instance_url", ""),
        "api_version": config.get("api_version", "v62.0"),
        "environment": config.get("environment", "production"),
    }
    for key in ("client_id", "client_secret", "refresh_token", "access_token"):
        val = integration.get_secret(key)
        if val:
            creds[key] = val
    return creds
