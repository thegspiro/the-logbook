"""
Google Calendar Integration Service

Two-way sync between The Logbook events and Google Calendar
via the Google Calendar API v3.

Requires: google-api-python-client, google-auth, google-auth-oauthlib
(already in requirements.txt).
"""

import http.client
from collections.abc import Callable
from typing import Any

import httplib2
from httplib2.decode import DecodeLimitError
from loguru import logger

from app.services.integration_services.base import (
    INTEGRATION_TIMEOUT,
    MAX_RESPONSE_SIZE,
    ResponseTooLargeError,
)
from app.services.integration_services.calendar_interface import CalendarSyncInterface

# INT-9: this connector talks to Google through httplib2, not httpx, so it
# never reaches create_integration_client() and none of that factory's limits
# applied. The same numbers are enforced here by other means: the response
# cap counts bytes as httplib2 drains the body, and the timeouts are socket
# timeouts — per operation, exactly what INTEGRATION_TIMEOUT means for the
# httpx connectors, which have no wall-clock deadline either (see
# KNOWN_LIMITATIONS.md, "No Wall-Clock Deadline").
_CONNECT_TIMEOUT = INTEGRATION_TIMEOUT.connect
_READ_TIMEOUT = INTEGRATION_TIMEOUT.read
_READ_CHUNK = 64 * 1024


class _CappedHTTPResponse(http.client.HTTPResponse):
    """Refuses a body larger than MAX_RESPONSE_SIZE instead of buffering it.

    httplib2's `_conn_request` drains every response with a bare `read()`,
    which in the standard library reads to EOF with no limit. Only that call
    is replaced: it reads in chunks and stops as soon as the running total
    passes the cap, so an oversized body is never held in memory whole. A
    declared Content-Length over the cap is refused before reading anything.
    `read(amt)` is left alone — it is already bounded by `amt`.
    """

    def read(self, amt: int | None = None) -> bytes:
        if amt is not None:
            return super().read(amt)
        declared = self.getheader("content-length")
        if declared is not None and declared.strip().isdigit():
            if int(declared) > MAX_RESPONSE_SIZE:
                self.close()
                raise ResponseTooLargeError(
                    f"response declared {declared} bytes, over the "
                    f"{MAX_RESPONSE_SIZE}-byte integration response size limit"
                )
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = super().read(_READ_CHUNK)
            if not chunk:
                return b"".join(chunks)
            total += len(chunk)
            if total > MAX_RESPONSE_SIZE:
                self.close()
                raise ResponseTooLargeError(
                    f"response exceeded the {MAX_RESPONSE_SIZE}-byte integration "
                    "response size limit"
                )
            chunks.append(chunk)


def _connect_with_budgets(
    conn: httplib2.HTTPConnectionWithTimeout | httplib2.HTTPSConnectionWithTimeout,
    connect: Callable[[], None],
) -> None:
    """Connect under the connect timeout, then read under the read timeout.

    httplib2 applies one `timeout` to both. Swapping it around `connect()`
    gives the TCP connect and TLS handshake the shorter connect budget the
    httpx connectors use, and every later socket operation the read budget.
    """
    conn.timeout = _CONNECT_TIMEOUT
    try:
        connect()
    finally:
        conn.timeout = _READ_TIMEOUT
    if conn.sock is not None:
        conn.sock.settimeout(_READ_TIMEOUT)


class _BoundedHTTPSConnection(httplib2.HTTPSConnectionWithTimeout):
    response_class = _CappedHTTPResponse

    def connect(self) -> None:
        _connect_with_budgets(self, super().connect)


class _BoundedHTTPConnection(httplib2.HTTPConnectionWithTimeout):
    response_class = _CappedHTTPResponse

    def connect(self) -> None:
        _connect_with_budgets(self, super().connect)


class _BoundedHttp(httplib2.Http):
    """An httplib2.Http whose every connection carries the INT-9 bounds.

    `connection_type` is a per-request argument in httplib2 that neither
    googleapiclient nor google_auth_httplib2 ever passes, so it is supplied
    here — for API calls, the OAuth token refresh, and any redirect httplib2
    follows, all of which come back through this method.

    `decode_limit_hard` caps the *decompressed* size too: httplib2 asks for
    gzip and inflates the whole body after reading it, so a small compressed
    body under the wire cap could otherwise expand far past it.
    """

    def __init__(self) -> None:
        super().__init__(timeout=_READ_TIMEOUT, decode_limit_hard=MAX_RESPONSE_SIZE)

    def request(
        self,
        uri: str,
        method: str = "GET",
        body: Any = None,
        headers: dict[str, str] | None = None,
        redirections: int = httplib2.DEFAULT_MAX_REDIRECTS,
        connection_type: type | None = None,
    ) -> Any:
        if connection_type is None:
            connection_type = (
                _BoundedHTTPConnection
                if uri.lower().startswith("http:")
                else _BoundedHTTPSConnection
            )
        try:
            return super().request(
                uri, method, body, headers, redirections, connection_type
            )
        except DecodeLimitError as exc:
            self.close()
            raise ResponseTooLargeError(
                f"decompressed response exceeded the {MAX_RESPONSE_SIZE}-byte "
                "integration response size limit"
            ) from exc
        except (ResponseTooLargeError, TimeoutError):
            # An abandoned body leaves unread bytes on a pooled connection; the
            # next request on it would parse them as its own response.
            self.close()
            raise


def _build_service(credentials_json: dict[str, Any]) -> Any:
    """Build a Google Calendar API service from stored credentials."""
    from google.oauth2.credentials import Credentials
    from google_auth_httplib2 import AuthorizedHttp
    from googleapiclient.discovery import build

    creds = Credentials(
        token=credentials_json.get("token"),
        refresh_token=credentials_json.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=credentials_json.get("client_id"),
        client_secret=credentials_json.get("client_secret"),
    )
    # `http=` and `credentials=` are mutually exclusive in build(); the
    # credentials ride on the AuthorizedHttp instead, which refreshes the
    # token through the same bounded transport.
    return build("calendar", "v3", http=AuthorizedHttp(creds, http=_BoundedHttp()))


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
            # Don't interpolate the raw exception into the re-raised
            # message — the Google API client can surface transport-level
            # detail (DNS, TLS, timeouts) that a caller-facing bare
            # Exception is otherwise trusted to be safe (INT-6 follow-up).
            logger.error("Google Calendar connection test failed: {}", e)
            raise Exception(
                "Google Calendar connection failed — check the stored credentials"
            )
