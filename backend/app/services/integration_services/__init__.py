"""
Integration Services Package

Central dispatcher that routes integration actions to the correct
service based on integration_type.
"""

from typing import Any

from loguru import logger

from app.models.integration import Integration


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

    if itype in ("google-calendar", "outlook"):
        from app.services.calendar_sync_service import default_service_factory

        # The reconciler's own credentials, deployment OAuth client and
        # Outlook tenant included, so an access token that lapsed since the
        # last pass is refreshed instead of failing the test.
        return await default_service_factory(integration).test_connection()

    if itype == "salesforce":
        from app.services.integration_services.salesforce_service import (
            SalesforceService,
        )

        creds = _get_salesforce_credentials(integration)
        return await SalesforceService(creds).test_connection()

    if itype == "paypal":
        from app.services.integration_services.paypal_service import (
            test_connection as paypal_test_connection,
        )

        return await paypal_test_connection(integration)

    if itype == "zeffy":
        from app.services.integration_services.zeffy_service import (
            test_connection as zeffy_test_connection,
        )

        return await zeffy_test_connection(integration)

    if itype == "documenso":
        from app.services.integration_services.documenso_service import DocumensoService

        creds = _get_documenso_credentials(integration)
        if not creds.get("api_token"):
            raise Exception("No Documenso API token configured")
        return await DocumensoService(creds).test_connection()

    if itype == "calcom":
        from app.services.integration_services.calcom_service import CalcomService

        creds = _get_calcom_credentials(integration)
        if not creds.get("api_key"):
            raise Exception("No Cal.com API key configured")
        return await CalcomService(creds).test_connection()

    if itype == "google-workspace":
        from app.services.integration_services.google_workspace_service import (
            GoogleWorkspaceError,
            directory_for,
        )

        # The connector's messages are hand-written and safe to show; they
        # are re-raised as a bare Exception, which is what the test-connection
        # endpoint trusts (see sanitize_connector_error).
        try:
            return await directory_for(integration).test_connection(
                str(config.get("domain", "")),
                list(config.get("group_emails") or []),
                str(config.get("org_unit_path") or "/"),
            )
        except GoogleWorkspaceError as exc:
            raise Exception(str(exc)) from exc

    if itype == "microsoft-365":
        from app.services.integration_services.microsoft_365_service import (
            Microsoft365Error,
        )
        from app.services.integration_services.microsoft_365_service import (
            directory_for as microsoft_directory_for,
        )

        # Hand-written messages, re-raised bare like Google's above.
        try:
            return await microsoft_directory_for(integration).test_connection(
                str(config.get("domain", "")),
                list(config.get("groups") or []),
                str(config.get("license_sku_id") or "") or None,
            )
        except Microsoft365Error as exc:
            raise Exception(str(exc)) from exc

    if itype == "ical":
        return "iCal feeds are read-only — no connection test needed"

    if itype in {"csv-import", "nfirs-export", "nemsis-export", "epcr-import"}:
        return "File-based integration — no connection test needed"

    raise Exception(f"Test not available for integration type: {itype}")


def _get_calendar_credentials(integration: Integration) -> dict[str, Any]:
    """Extract calendar credentials from encrypted storage.

    The access token's expiry is not a secret and lives in public config, so
    the service can refresh a lapsed token before using it.
    """
    creds: dict[str, Any] = {}
    for key in (
        "refresh_token",
        "client_id",
        "client_secret",
        "tenant_id",
        "token",
        "access_token",
    ):
        val = integration.get_secret(key)
        if val:
            creds[key] = val
    config = integration.config or {}
    expires_at = config.get("token_expires_at")
    if expires_at:
        creds["token_expires_at"] = expires_at
    # The Test button checks the department calendar itself: Google's
    # calendar.app.created scope covers calendars the app made, not the
    # account's calendar list, and it is what publishing writes to.
    calendar_id = config.get("calendar_id")
    if calendar_id:
        creds["calendar_id"] = calendar_id
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


def _get_documenso_credentials(integration: Integration) -> dict[str, Any]:
    """Extract Documenso credentials (public base URL + encrypted token)."""
    config = integration.config or {}
    creds: dict[str, Any] = {
        "api_base_url": config.get("api_base_url", ""),
    }
    token = integration.get_secret("api_token")
    if token:
        creds["api_token"] = token
    return creds


def _get_calcom_credentials(integration: Integration) -> dict[str, Any]:
    """Extract Cal.com credentials (public base URL + encrypted API key)."""
    config = integration.config or {}
    creds: dict[str, Any] = {
        "api_base_url": config.get("api_base_url", ""),
    }
    api_key = integration.get_secret("api_key")
    if api_key:
        creds["api_key"] = api_key
    return creds
