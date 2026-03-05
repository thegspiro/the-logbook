"""
Google Calendar Integration Service

Two-way sync between The Logbook events and Google Calendar
via the Google Calendar API v3.

Requires: google-api-python-client, google-auth, google-auth-oauthlib
(already in requirements.txt).
"""

import logging
from typing import Any

from app.services.integration_services.calendar_interface import CalendarSyncInterface

logger = logging.getLogger(__name__)


def _build_service(credentials_json: dict[str, Any]) -> Any:
    """Build a Google Calendar API service from stored credentials."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=credentials_json.get("token"),
        refresh_token=credentials_json.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=credentials_json.get("client_id"),
        client_secret=credentials_json.get("client_secret"),
    )
    return build("calendar", "v3", credentials=creds)


def _event_to_google(event_data: dict[str, Any]) -> dict[str, Any]:
    """Map Logbook event fields to Google Calendar event format."""
    google_event: dict[str, Any] = {
        "summary": event_data.get("title", ""),
        "description": event_data.get("description", ""),
        "location": event_data.get("location", ""),
    }
    if event_data.get("start_time"):
        google_event["start"] = {
            "dateTime": event_data["start_time"],
            "timeZone": event_data.get("timezone", "UTC"),
        }
    if event_data.get("end_time"):
        google_event["end"] = {
            "dateTime": event_data["end_time"],
            "timeZone": event_data.get("timezone", "UTC"),
        }
    return google_event


class GoogleCalendarService(CalendarSyncInterface):
    """Google Calendar sync via Calendar API v3."""

    def __init__(self, credentials_json: dict[str, Any]):
        self._credentials = credentials_json
        self._service: Any = None

    def _get_service(self) -> Any:
        if self._service is None:
            self._service = _build_service(self._credentials)
        return self._service

    async def push_event(
        self, event_data: dict[str, Any], calendar_id: str = "primary"
    ) -> str | None:
        try:
            service = self._get_service()
            google_event = _event_to_google(event_data)
            result = (
                service.events()
                .insert(calendarId=calendar_id, body=google_event)
                .execute()
            )
            return result.get("id")
        except Exception:
            logger.exception("Failed to push event to Google Calendar")
            return None

    async def update_event(
        self,
        external_event_id: str,
        event_data: dict[str, Any],
        calendar_id: str = "primary",
    ) -> bool:
        try:
            service = self._get_service()
            google_event = _event_to_google(event_data)
            service.events().update(
                calendarId=calendar_id,
                eventId=external_event_id,
                body=google_event,
            ).execute()
            return True
        except Exception:
            logger.exception("Failed to update Google Calendar event")
            return False

    async def delete_event(
        self, external_event_id: str, calendar_id: str = "primary"
    ) -> bool:
        try:
            service = self._get_service()
            service.events().delete(
                calendarId=calendar_id, eventId=external_event_id
            ).execute()
            return True
        except Exception:
            logger.exception("Failed to delete Google Calendar event")
            return False

    async def test_connection(self) -> str:
        try:
            service = self._get_service()
            calendar_list = service.calendarList().list(maxResults=1).execute()
            count = len(calendar_list.get("items", []))
            return f"Connected to Google Calendar ({count}+ calendars accessible)"
        except Exception as e:
            raise Exception(f"Google Calendar connection failed: {e}")
