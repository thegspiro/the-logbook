"""
Microsoft Outlook/365 Calendar Integration Service

Pushes department events one way into a calendar the app created, via
Microsoft Graph. Payloads come from
``calendar_common.build_calendar_payload``; failures raise the typed errors
defined there.

Every request, including the OAuth refresh against the Microsoft identity
platform, goes through the shared httpx client factory, so the outbound
bounds (timeouts, response size cap, no redirects) apply throughout. A
refreshed token — Microsoft rotates the refresh token on most refreshes — is
handed back through ``tokens`` for the caller to persist.
"""

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx
from loguru import logger

from app.services.integration_services.base import (
    ResponseTooLargeError,
    create_integration_client,
)
from app.services.integration_services.calendar_common import (
    CalendarAuthRevoked,
    CalendarError,
    CalendarNotFound,
    CalendarTokens,
    CalendarTransient,
    ClientFactory,
    error_for_status,
    parse_expires_at,
    payload_body_text,
    refresh_oauth_token,
    token_is_fresh,
    with_refresh_on_401,
)
from app.services.integration_services.calendar_interface import CalendarSyncInterface

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_SCOPE = "offline_access https://graph.microsoft.com/Calendars.ReadWrite"
_PROVIDER = "Outlook Calendar"


def _token_url(tenant_id: str) -> str:
    return (
        f"https://login.microsoftonline.com/{quote(tenant_id, safe='')}"
        "/oauth2/v2.0/token"
    )


def _utc_wall_time(iso: str) -> str:
    dt = datetime.fromisoformat(iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(tzinfo=None).isoformat()


def _payload_to_outlook(payload: dict[str, Any]) -> dict[str, Any]:
    """Graph's event resource for an allowlisted payload — nothing more.

    Times go as UTC wall time with ``timeZone: "UTC"``: Graph's support for
    IANA zone names varies by mailbox, and UTC is accepted everywhere. Each
    subscriber's client shows the event in their own zone either way.
    """
    return {
        "subject": payload["title"],
        "body": {"contentType": "text", "content": payload_body_text(payload)},
        "start": {"dateTime": _utc_wall_time(payload["start"]), "timeZone": "UTC"},
        "end": {"dateTime": _utc_wall_time(payload["end"]), "timeZone": "UTC"},
        # Sent empty rather than omitted so a PATCH clears a removed location.
        "location": {"displayName": payload.get("location") or ""},
    }


class OutlookCalendarService(CalendarSyncInterface):
    """Outlook/365 Calendar sync via Microsoft Graph.

    ``credentials`` keys: ``token`` (access token), ``refresh_token``,
    ``client_id``, ``client_secret``, ``tenant_id`` (default ``common``) and
    optionally ``token_expires_at`` and ``calendar_id`` (which the connection
    test reads).
    """

    def __init__(
        self,
        credentials: dict[str, Any],
        *,
        client_factory: ClientFactory = create_integration_client,
    ):
        self._credentials = dict(credentials)
        self._client_factory = client_factory
        self.tokens: CalendarTokens | None = None

    def _access_token(self) -> str | None:
        token = self._credentials.get("token") or self._credentials.get("access_token")
        return token if isinstance(token, str) and token else None

    def _can_refresh(self) -> bool:
        return all(
            self._credentials.get(k)
            for k in ("refresh_token", "client_id", "client_secret")
        )

    async def refresh_tokens(self) -> CalendarTokens:
        if not self._can_refresh():
            raise CalendarAuthRevoked(
                f"{_PROVIDER} has no refresh token or client credentials — "
                "reconnect required"
            )
        tokens = await refresh_oauth_token(
            _PROVIDER,
            _token_url(str(self._credentials.get("tenant_id") or "common")),
            {
                "client_id": str(self._credentials["client_id"]),
                "client_secret": str(self._credentials["client_secret"]),
                "scope": GRAPH_SCOPE,
            },
            str(self._credentials["refresh_token"]),
            self._client_factory,
        )
        self._credentials.update(
            token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            token_expires_at=tokens.expires_at,
        )
        self.tokens = tokens
        return tokens

    async def _get_token(self) -> str:
        expires_at = parse_expires_at(self._credentials.get("token_expires_at"))
        token = self._access_token()
        if token and token_is_fresh(expires_at):
            return token
        return (await self.refresh_tokens()).access_token

    async def _send(
        self, method: str, path: str, json: dict[str, Any] | None = None
    ) -> httpx.Response:
        # Outside attempt(): a refused refresh must not itself be retried as
        # though the API had answered 401.
        await self._get_token()

        async def attempt() -> httpx.Response:
            headers = {"Authorization": f"Bearer {self._access_token()}"}
            try:
                async with self._client_factory() as client:
                    response = await client.request(
                        method, f"{GRAPH_API_BASE}{path}", json=json, headers=headers
                    )
            except ResponseTooLargeError as exc:
                raise CalendarError(
                    f"{_PROVIDER} sent a response over the integration size limit"
                ) from exc
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                raise CalendarTransient(f"{_PROVIDER} could not be reached") from exc
            if response.status_code >= 400:
                raise error_for_status(
                    _PROVIDER,
                    response.status_code,
                    response.headers.get("retry-after"),
                )
            return response

        result: httpx.Response = await with_refresh_on_401(
            attempt, self.refresh_tokens if self._can_refresh() else None
        )
        return result

    @staticmethod
    def _id_from(response: httpx.Response, what: str) -> str:
        try:
            value = response.json().get("id")
        except ValueError:
            value = None
        if not isinstance(value, str) or not value:
            raise CalendarError(f"{_PROVIDER} did not return {what} id")
        return value

    @staticmethod
    def _events_path(calendar_id: str, external_id: str | None = None) -> str:
        path = f"/me/calendars/{quote(calendar_id, safe='')}/events"
        if external_id:
            path += f"/{quote(external_id, safe='')}"
        return path

    async def create_calendar(self, name: str) -> str:
        response = await self._send("POST", "/me/calendars", {"name": name})
        return self._id_from(response, "a calendar")

    async def calendar_exists(self, calendar_id: str) -> bool:
        """Whether ``calendar_id`` is still reachable with these credentials.

        A reconnect keeps publishing into the calendar members already
        subscribe to, but only if it survived: someone may have deleted it
        in Outlook while the grant was broken.
        """
        try:
            await self._send("GET", f"/me/calendars/{quote(calendar_id, safe='')}")
        except CalendarNotFound:
            return False
        return True

    async def update_event(
        self, calendar_id: str, external_id: str, payload: dict[str, Any]
    ) -> None:
        await self._send(
            "PATCH",
            self._events_path(calendar_id, external_id),
            _payload_to_outlook(payload),
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
        # Graph returns the event already created under a transactionId
        # instead of creating a second one, so a retried insert whose first
        # response was lost does not duplicate the event.
        body = {**_payload_to_outlook(payload), "transactionId": payload["event_id"]}
        response = await self._send("POST", self._events_path(calendar_id), body)
        return self._id_from(response, "an event")

    async def delete_event(self, calendar_id: str, external_id: str) -> None:
        try:
            await self._send("DELETE", self._events_path(calendar_id, external_id))
        except CalendarNotFound:
            return

    async def test_connection(self) -> str:
        calendar_id = self._credentials.get("calendar_id")
        try:
            if calendar_id:
                # With a calendar connected, check that one: it is what the
                # reconciler publishes into.
                response = await self._send(
                    "GET", f"/me/calendars/{quote(str(calendar_id), safe='')}"
                )
                name = response.json().get("name") or "the department calendar"
                return f"Connected to Outlook (publishing to {name})"
            response = await self._send("GET", "/me/calendars")
            calendars = response.json().get("value", [])
            return f"Connected to Outlook ({len(calendars)} calendar(s))"
        except Exception as e:
            # Don't interpolate the raw exception into the re-raised
            # message — httpx/Graph API failures can surface transport-
            # level detail (DNS, TLS, timeouts) that a caller-facing bare
            # Exception is otherwise trusted to be safe (INT-6 follow-up).
            logger.error("Outlook Calendar connection test failed: {}", e)
            raise Exception(
                "Outlook Calendar connection failed — check the stored credentials"
            )
