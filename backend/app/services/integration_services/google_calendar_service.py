"""
Google Calendar Integration Service

Pushes department events one way into a calendar the app created, via the
Google Calendar API v3. Payloads come from
``calendar_common.build_calendar_payload``; failures raise the typed errors
defined there.

googleapiclient is synchronous, so every request runs in a worker thread
(``asyncio.to_thread``) over the bounded httplib2 transport below. The token
refresh is a plain OAuth POST over the shared httpx client factory, and its
result — including a rotated refresh token — is handed back to the caller
through ``tokens`` rather than stored here.

Requires: google-api-python-client, google-auth, google-auth-httplib2
(already in requirements.txt).
"""

import asyncio
import http.client
import json
from collections.abc import Callable
from typing import Any

import httplib2
from httplib2.decode import DecodeLimitError
from loguru import logger

from app.services.integration_services.base import (
    INTEGRATION_TIMEOUT,
    MAX_RESPONSE_SIZE,
    ResponseTooLargeError,
    create_integration_client,
)
from app.services.integration_services.calendar_common import (
    CalendarAuthRevoked,
    CalendarConflict,
    CalendarError,
    CalendarNotFound,
    CalendarRateLimited,
    CalendarTokens,
    CalendarTransient,
    ClientFactory,
    error_for_status,
    google_event_id,
    parse_expires_at,
    parse_retry_after,
    payload_body_text,
    refresh_oauth_token,
    token_is_fresh,
    with_refresh_on_401,
)
from app.services.integration_services.calendar_interface import CalendarSyncInterface

# INT-9: this connector's API calls go to Google through httplib2, not httpx,
# so they never reach create_integration_client() and none of that factory's
# limits would apply (the token refresh does use the factory). The same numbers are enforced here by other means: the response
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


GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_PROVIDER = "Google Calendar"
# Google reports per-user and per-project throttling as 403 with one of
# these reasons rather than as 429.
_RATE_LIMIT_REASONS = frozenset(
    {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}
)


def _build_service(
    credentials_json: dict[str, Any], http: httplib2.Http | None = None
) -> Any:
    """Build a Google Calendar API service around an access token."""
    from google.oauth2.credentials import Credentials
    from google_auth_httplib2 import AuthorizedHttp
    from googleapiclient.discovery import build

    # Only the access token: the service refreshes explicitly so the new
    # tokens reach the caller. Given a refresh token, google-auth would
    # refresh silently on a 401 and a rotated refresh token would be lost.
    creds = Credentials(token=credentials_json.get("token"))
    # `http=` and `credentials=` are mutually exclusive in build(); the
    # credentials ride on the AuthorizedHttp instead. refresh_status_codes=()
    # lets a 401 surface as an HttpError rather than a RefreshError.
    authed = AuthorizedHttp(creds, http=http or _BoundedHttp(), refresh_status_codes=())
    return build("calendar", "v3", http=authed)


def _error_reason(content: Any) -> str | None:
    try:
        reason = json.loads(content)["error"]["errors"][0]["reason"]
    except (TypeError, ValueError, KeyError, IndexError):
        return None
    return reason if isinstance(reason, str) else None


def _translate(exc: Exception) -> CalendarError:
    """Map a googleapiclient/httplib2 failure onto a typed calendar error.

    The message never carries Google's response body or transport detail.
    """
    from google.auth.exceptions import RefreshError
    from googleapiclient.errors import HttpError

    if isinstance(exc, CalendarError):
        return exc
    if isinstance(exc, HttpError):
        status = int(exc.resp.status)
        retry_after = exc.resp.get("retry-after")
        if status == 403 and _error_reason(exc.content) in _RATE_LIMIT_REASONS:
            return CalendarRateLimited(
                f"{_PROVIDER} is rate limiting requests",
                parse_retry_after(retry_after),
            )
        return error_for_status(_PROVIDER, status, retry_after)
    if isinstance(exc, RefreshError):
        return CalendarAuthRevoked(
            f"{_PROVIDER} rejected the stored authorization — reconnect required"
        )
    if isinstance(exc, ResponseTooLargeError):
        return CalendarError(
            f"{_PROVIDER} sent a response over the integration size limit"
        )
    if isinstance(exc, (TimeoutError, OSError, httplib2.HttpLib2Error)):
        return CalendarTransient(f"{_PROVIDER} could not be reached")
    return CalendarError(f"{_PROVIDER} request failed")


def _payload_to_google(payload: dict[str, Any]) -> dict[str, Any]:
    """Google's event resource for an allowlisted payload — nothing more."""
    body: dict[str, Any] = {
        "summary": payload["title"],
        "description": payload_body_text(payload),
        "start": {"dateTime": payload["start"], "timeZone": payload["time_zone"]},
        "end": {"dateTime": payload["end"], "timeZone": payload["time_zone"]},
        "source": {"title": "The Logbook", "url": payload["url"]},
        # A re-insert after a delete collides with the cancelled event's id
        # and falls back to an update; this brings that event back.
        "status": "confirmed",
    }
    if payload.get("location"):
        body["location"] = payload["location"]
    return body


class GoogleCalendarService(CalendarSyncInterface):
    """Google Calendar sync via Calendar API v3.

    ``credentials_json`` keys: ``token`` (access token), ``refresh_token``,
    ``client_id``, ``client_secret`` and optionally ``token_expires_at``.
    """

    def __init__(
        self,
        credentials_json: dict[str, Any],
        *,
        client_factory: ClientFactory = create_integration_client,
        http_factory: Callable[[], httplib2.Http] = _BoundedHttp,
    ):
        self._credentials = dict(credentials_json)
        self._client_factory = client_factory
        self._http_factory = http_factory
        self._service: Any = None
        # httplib2.Http is not thread-safe: one request at a time per service.
        self._lock = asyncio.Lock()
        self.tokens: CalendarTokens | None = None

    def _access_token(self) -> str | None:
        token = self._credentials.get("token") or self._credentials.get("access_token")
        return token if isinstance(token, str) and token else None

    def _can_refresh(self) -> bool:
        return all(
            self._credentials.get(k)
            for k in ("refresh_token", "client_id", "client_secret")
        )

    def _get_service(self) -> Any:
        if self._service is None:
            self._service = _build_service(
                {"token": self._access_token()}, self._http_factory()
            )
        return self._service

    async def refresh_tokens(self) -> CalendarTokens:
        if not self._can_refresh():
            raise CalendarAuthRevoked(
                f"{_PROVIDER} has no refresh token or client credentials — "
                "reconnect required"
            )
        tokens = await refresh_oauth_token(
            _PROVIDER,
            GOOGLE_TOKEN_URL,
            {
                "client_id": str(self._credentials["client_id"]),
                "client_secret": str(self._credentials["client_secret"]),
            },
            str(self._credentials["refresh_token"]),
            self._client_factory,
        )
        self._credentials.update(
            token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            token_expires_at=tokens.expires_at,
        )
        self._service = None
        self.tokens = tokens
        return tokens

    async def _ensure_token(self) -> None:
        expires_at = parse_expires_at(self._credentials.get("token_expires_at"))
        if self._access_token() and token_is_fresh(expires_at):
            return
        await self.refresh_tokens()

    async def _execute(self, make_request: Callable[[Any], Any]) -> Any:
        """Run one API request off the event loop, raising typed errors."""
        await self._ensure_token()

        async def attempt() -> Any:
            request = make_request(self._get_service())
            async with self._lock:
                try:
                    return await asyncio.to_thread(request.execute)
                except Exception as exc:
                    raise _translate(exc) from exc

        return await with_refresh_on_401(
            attempt, self.refresh_tokens if self._can_refresh() else None
        )

    async def create_calendar(self, name: str) -> str:
        result = await self._execute(
            lambda s: s.calendars().insert(body={"summary": name})
        )
        calendar_id = result.get("id") if isinstance(result, dict) else None
        if not isinstance(calendar_id, str) or not calendar_id:
            raise CalendarError(f"{_PROVIDER} did not return a calendar id")
        return calendar_id

    async def update_event(
        self, calendar_id: str, external_id: str, payload: dict[str, Any]
    ) -> None:
        body = _payload_to_google(payload)
        await self._execute(
            lambda s: s.events().update(
                calendarId=calendar_id, eventId=external_id, body=body
            )
        )

    async def upsert_event(
        self, calendar_id: str, external_id: str | None, payload: dict[str, Any]
    ) -> str:
        if external_id:
            try:
                await self.update_event(calendar_id, external_id, payload)
                return external_id
            except CalendarNotFound:
                pass
            event_id = external_id
        else:
            event_id = google_event_id(payload["event_id"])
        body = {**_payload_to_google(payload), "id": event_id}
        try:
            await self._execute(
                lambda s: s.events().insert(calendarId=calendar_id, body=body)
            )
        except CalendarConflict:
            # The deterministic id is taken: an earlier insert landed and its
            # response was lost, or the event was deleted and is coming back.
            # Either way the event should be overwritten, not duplicated.
            await self.update_event(calendar_id, event_id, payload)
        return event_id

    async def delete_event(self, calendar_id: str, external_id: str) -> None:
        try:
            await self._execute(
                lambda s: s.events().delete(calendarId=calendar_id, eventId=external_id)
            )
        except CalendarNotFound:
            return

    async def test_connection(self) -> str:
        try:
            calendar_list = await self._execute(
                lambda s: s.calendarList().list(maxResults=1)
            )
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
