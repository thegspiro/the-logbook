"""
Microsoft Outlook/365 Calendar Integration Service

Two-way sync between The Logbook events and Outlook Calendar
via Microsoft Graph API.

Requires: msal (already in requirements.txt).
"""

import logging
from typing import Any

from app.services.integration_services.base import create_integration_client
from app.services.integration_services.calendar_interface import CalendarSyncInterface

logger = logging.getLogger(__name__)

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"


def _event_to_outlook(event_data: dict[str, Any]) -> dict[str, Any]:
    """Map Logbook event fields to Microsoft Graph event format."""
    outlook_event: dict[str, Any] = {
        "subject": event_data.get("title", ""),
        "body": {
            "contentType": "text",
            "content": event_data.get("description", ""),
        },
    }
    if event_data.get("location"):
        outlook_event["location"] = {
            "displayName": event_data["location"],
        }
    tz = event_data.get("timezone", "UTC")
    if event_data.get("start_time"):
        outlook_event["start"] = {
            "dateTime": event_data["start_time"],
            "timeZone": tz,
        }
    if event_data.get("end_time"):
        outlook_event["end"] = {
            "dateTime": event_data["end_time"],
            "timeZone": tz,
        }
    return outlook_event


def _get_access_token(
    client_id: str,
    client_secret: str,
    tenant_id: str,
    refresh_token: str,
) -> str:
    """Acquire an access token from MSAL using refresh token."""
    import msal

    app = msal.ConfidentialClientApplication(
        client_id,
        authority=f"https://login.microsoftonline.com/{tenant_id}",
        client_credential=client_secret,
    )
    result = app.acquire_token_by_refresh_token(
        refresh_token,
        scopes=["https://graph.microsoft.com/Calendars.ReadWrite"],
    )
    if "access_token" not in result:
        raise Exception(
            f"Failed to acquire token: {result.get('error_description', 'unknown')}"
        )
    return result["access_token"]


class OutlookCalendarService(CalendarSyncInterface):
    """Outlook/365 Calendar sync via Microsoft Graph API."""

    def __init__(self, credentials: dict[str, Any]):
        self._credentials = credentials
        self._access_token: str | None = None

    def _get_token(self) -> str:
        if self._access_token is None:
            self._access_token = _get_access_token(
                client_id=self._credentials["client_id"],
                client_secret=self._credentials["client_secret"],
                tenant_id=self._credentials["tenant_id"],
                refresh_token=self._credentials["refresh_token"],
            )
        return self._access_token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type": "application/json",
        }

    async def push_event(
        self, event_data: dict[str, Any], calendar_id: str = "primary"
    ) -> str | None:
        try:
            outlook_event = _event_to_outlook(event_data)
            url = f"{GRAPH_API_BASE}/me/calendars/{calendar_id}/events"
            if calendar_id == "primary":
                url = f"{GRAPH_API_BASE}/me/events"

            async with create_integration_client() as client:
                response = await client.post(
                    url, json=outlook_event, headers=self._headers()
                )
                response.raise_for_status()
                return response.json().get("id")
        except Exception:
            logger.exception("Failed to push event to Outlook Calendar")
            return None

    async def update_event(
        self,
        external_event_id: str,
        event_data: dict[str, Any],
        calendar_id: str = "primary",
    ) -> bool:
        try:
            outlook_event = _event_to_outlook(event_data)
            url = f"{GRAPH_API_BASE}/me/events/{external_event_id}"
            async with create_integration_client() as client:
                response = await client.patch(
                    url, json=outlook_event, headers=self._headers()
                )
                response.raise_for_status()
                return True
        except Exception:
            logger.exception("Failed to update Outlook Calendar event")
            return False

    async def delete_event(
        self, external_event_id: str, calendar_id: str = "primary"
    ) -> bool:
        try:
            url = f"{GRAPH_API_BASE}/me/events/{external_event_id}"
            async with create_integration_client() as client:
                response = await client.delete(url, headers=self._headers())
                response.raise_for_status()
                return True
        except Exception:
            logger.exception("Failed to delete Outlook Calendar event")
            return False

    async def test_connection(self) -> str:
        try:
            url = f"{GRAPH_API_BASE}/me/calendars"
            async with create_integration_client() as client:
                response = await client.get(url, headers=self._headers())
                response.raise_for_status()
                calendars = response.json().get("value", [])
                return f"Connected to Outlook ({len(calendars)} calendar(s))"
        except Exception as e:
            raise Exception(f"Outlook Calendar connection failed: {e}")
