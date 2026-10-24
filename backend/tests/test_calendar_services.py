"""Calendar connectors: the allowlisted payload, ids, typed errors, tokens.

Google is driven through the real googleapiclient stack with only the
httplib2 transport replaced; Outlook through the real httpx client with an
``httpx.MockTransport``. Nothing touches the network or the database.
"""

import json
import re
import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs

import httplib2
import httpx
import pytest

from app.models.event import Event, EventType
from app.services.integration_services import _get_calendar_credentials
from app.services.integration_services.calendar_common import (
    CalendarAuthRevoked,
    CalendarConflict,
    CalendarError,
    CalendarNotFound,
    CalendarRateLimited,
    CalendarTransient,
    build_calendar_payload,
    content_hash,
    google_event_id,
)
from app.services.integration_services.google_calendar_service import (
    GOOGLE_TOKEN_URL,
    GoogleCalendarService,
)
from app.services.integration_services.outlook_calendar_service import (
    OutlookCalendarService,
)

pytestmark = pytest.mark.unit

EVENT_ID = "3f2c9a1e-7b4d-4c8e-9f10-2a3b4c5d6e7f"
SECRET = "SHOULD-NOT-LEAVE"


def _event(**overrides):
    fields = dict(
        id=EVENT_ID,
        organization_id="org-1",
        title="Hose drill",
        description=f"Bring turnout gear {SECRET}",
        event_type=EventType.TRAINING,
        location="Station 6 bay",
        location_details=f"Back door {SECRET}",
        # Naive, as MySQL returns a DateTime(timezone=True) column: UTC.
        start_datetime=datetime(2026, 1, 15, 14, 0),
        end_datetime=datetime(2026, 1, 15, 16, 0),
        custom_fields={"dietary": SECRET},
        attachments=[{"url": SECRET}],
        cancellation_reason=SECRET,
        created_by="user-secret",
        organizer_id="user-secret",
    )
    fields.update(overrides)
    return Event(**fields)


def _payload(**kwargs):
    return build_calendar_payload(
        _event(),
        org_timezone="America/New_York",
        base_url="https://logbook.example/",
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Payload, hash and ids
# ---------------------------------------------------------------------------


class TestPayloadAllowlist:
    def test_default_payload_is_exactly_the_allowlist(self):
        assert _payload() == {
            "event_id": EVENT_ID,
            "title": "Hose drill",
            "start": "2026-01-15T09:00:00-05:00",
            "end": "2026-01-15T11:00:00-05:00",
            "time_zone": "America/New_York",
            "location": "Station 6 bay",
            "event_type": "Training",
            "url": f"https://logbook.example/events/{EVENT_ID}",
            "description": None,
        }

    def test_nothing_outside_the_allowlist_appears_anywhere(self):
        text = json.dumps(_payload())
        assert SECRET not in text
        assert "user-secret" not in text
        for banned in ("rsvp", "attendee", "organizer", "custom", "attachment"):
            assert banned not in text.lower()

    def test_description_only_when_opted_in(self):
        assert _payload(sync_descriptions=True)["description"] == (
            f"Bring turnout gear {SECRET}"
        )

    def test_aware_datetimes_convert_across_dst(self):
        event = _event(
            start_datetime=datetime(2026, 7, 4, 22, 30, tzinfo=timezone.utc),
            end_datetime=datetime(2026, 7, 5, 1, 0, tzinfo=timezone.utc),
        )
        payload = build_calendar_payload(
            event, org_timezone="America/New_York", base_url="https://x"
        )
        assert payload["start"] == "2026-07-04T18:30:00-04:00"
        assert payload["end"] == "2026-07-04T21:00:00-04:00"

    def test_unknown_timezone_falls_back_to_utc(self):
        payload = build_calendar_payload(
            _event(), org_timezone="Mars/Olympus", base_url="https://x"
        )
        assert payload["time_zone"] == "UTC"
        assert payload["start"] == "2026-01-15T14:00:00+00:00"

    def test_resolved_location_and_label_win(self):
        payload = _payload(location_name="Training Center", event_type_label="Drill")
        assert payload["location"] == "Training Center"
        assert payload["event_type"] == "Drill"


class TestContentHash:
    def test_key_order_does_not_matter(self):
        payload = _payload()
        reordered = dict(reversed(list(payload.items())))
        assert content_hash(payload) == content_hash(reordered)

    def test_any_value_change_does(self):
        payload = _payload()
        assert content_hash(payload) != content_hash({**payload, "title": "Other"})

    def test_is_stable_across_builds(self):
        assert content_hash(_payload()) == content_hash(_payload())


class TestGoogleEventId:
    def test_valid_for_google_and_deterministic(self):
        gid = google_event_id(EVENT_ID)
        assert re.fullmatch(r"[a-v0-9]{5,1024}", gid)
        assert len(gid) == 26
        assert gid == google_event_id(EVENT_ID.upper())

    def test_distinct_events_get_distinct_ids(self):
        other = "3f2c9a1e-7b4d-4c8e-9f10-2a3b4c5d6e70"
        assert google_event_id(EVENT_ID) != google_event_id(other)


# ---------------------------------------------------------------------------
# Google
# ---------------------------------------------------------------------------


class _ScriptedHttp(httplib2.Http):
    """httplib2 stand-in: answers from a script, records every request."""

    def __init__(self, script):
        super().__init__()
        self.script = list(script)
        self.calls = []

    def request(self, uri, method="GET", body=None, headers=None, *args, **kwargs):
        self.calls.append(
            SimpleNamespace(
                uri=uri,
                method=method,
                body=json.loads(body) if body else None,
                headers=dict(headers or {}),
                thread=threading.get_ident(),
            )
        )
        step = self.script.pop(0)
        if isinstance(step, BaseException):
            raise step
        status, content, extra = (*step, {})[:3]
        resp = httplib2.Response(
            {"status": status, "content-type": "application/json", **extra}
        )
        return resp, json.dumps(content).encode() if content is not None else b""


def _token_transport(responses, seen):
    def handler(request):
        seen.append(request)
        return responses.pop(0)

    return lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _google(script, creds=None, token_responses=None, seen=None):
    http = _ScriptedHttp(script)
    service = GoogleCalendarService(
        creds or {"token": "access-1"},
        http_factory=lambda: http,
        client_factory=_token_transport(
            token_responses or [], seen if seen is not None else []
        ),
    )
    return service, http


class TestGoogleEvents:
    async def test_insert_uses_the_deterministic_id_off_the_event_loop(self):
        service, http = _google([(200, {"id": google_event_id(EVENT_ID)})])
        result = await service.upsert_event("cal@group", None, _payload())

        assert result == google_event_id(EVENT_ID)
        call = http.calls[0]
        assert call.method == "POST"
        assert "/calendars/cal%40group/events" in call.uri
        assert call.body["id"] == google_event_id(EVENT_ID)
        assert call.body["start"] == {
            "dateTime": "2026-01-15T09:00:00-05:00",
            "timeZone": "America/New_York",
        }
        assert set(call.body) == {
            "id",
            "summary",
            "description",
            "start",
            "end",
            "source",
            "status",
            "location",
        }
        assert SECRET not in json.dumps(call.body)
        assert call.headers["authorization"] == "Bearer access-1"
        assert call.thread != threading.get_ident()

    async def test_a_409_on_insert_falls_back_to_update(self):
        service, http = _google([(409, {"error": {"code": 409}}), (200, {})])
        result = await service.upsert_event("cal", None, _payload())

        gid = google_event_id(EVENT_ID)
        assert result == gid
        assert [c.method for c in http.calls] == ["POST", "PUT"]
        assert http.calls[1].uri.split("?")[0].endswith(f"/events/{gid}")

    async def test_a_known_id_updates_and_reinserts_when_gone(self):
        service, http = _google([(404, {}), (200, {"id": "ext-1"})])
        result = await service.upsert_event("cal", "ext-1", _payload())

        assert result == "ext-1"
        assert [c.method for c in http.calls] == ["PUT", "POST"]
        assert http.calls[1].body["id"] == "ext-1"

    @pytest.mark.parametrize("status", [404, 410])
    async def test_delete_of_a_missing_event_succeeds(self, status):
        service, http = _google([(status, {})])
        await service.delete_event("cal", "ext-1")
        assert http.calls[0].method == "DELETE"

    async def test_create_calendar_returns_its_id(self):
        service, http = _google([(200, {"id": "new-cal"})])
        assert await service.create_calendar("Station 6 Events") == "new-cal"
        assert http.calls[0].body == {"summary": "Station 6 Events"}


class TestGoogleErrors:
    @pytest.mark.parametrize(
        ("status", "content", "headers", "expected"),
        [
            (401, {}, {}, CalendarAuthRevoked),
            (404, {}, {}, CalendarNotFound),
            (409, {}, {}, CalendarConflict),
            (500, {}, {}, CalendarTransient),
            (502, {}, {}, CalendarTransient),
            (503, {}, {}, CalendarRateLimited),
            (429, {}, {"retry-after": "30"}, CalendarRateLimited),
            (
                403,
                {"error": {"errors": [{"reason": "rateLimitExceeded"}]}},
                {},
                CalendarRateLimited,
            ),
            (403, {"error": {"errors": [{"reason": "forbidden"}]}}, {}, CalendarError),
            (400, {}, {}, CalendarError),
        ],
    )
    async def test_status_maps_to_a_typed_error(
        self, status, content, headers, expected
    ):
        service, _ = _google([(status, content, headers)])
        with pytest.raises(CalendarError) as exc_info:
            await service.update_event("cal", "ext-1", _payload())
        assert type(exc_info.value) is expected
        if headers.get("retry-after"):
            assert exc_info.value.retry_after == 30.0

    async def test_a_socket_timeout_is_transient(self):
        service, _ = _google([TimeoutError("timed out")])
        with pytest.raises(CalendarTransient):
            await service.delete_event("cal", "ext-1")

    async def test_test_connection_still_reports_calendars(self):
        service, http = _google([(200, {"items": [{"id": "a"}]})])
        assert await service.test_connection() == (
            "Connected to Google Calendar (1+ calendars accessible)"
        )
        assert "/users/me/calendarList" in http.calls[0].uri

    async def test_test_connection_checks_the_department_calendar(self):
        service, http = _google(
            [(200, {"id": "dept-cal", "summary": "Oakville Fire Department Events"})],
            creds={"token": "access-1", "calendar_id": "dept-cal"},
        )
        assert await service.test_connection() == (
            "Connected to Google Calendar "
            "(publishing to Oakville Fire Department Events)"
        )
        assert "/calendars/dept-cal" in http.calls[0].uri
        assert "calendarList" not in http.calls[0].uri


class TestGoogleTokens:
    CREDS = {
        "token": "access-1",
        "refresh_token": "refresh-1",
        "client_id": "cid",
        "client_secret": "csecret",
    }

    async def test_an_expired_token_is_refreshed_first_and_rotation_reported(self):
        seen = []
        service, http = _google(
            [(200, {"id": "x"})],
            creds={
                **self.CREDS,
                "token_expires_at": (
                    datetime.now(timezone.utc) - timedelta(minutes=5)
                ).isoformat(),
            },
            token_responses=[
                httpx.Response(
                    200,
                    json={
                        "access_token": "access-2",
                        "refresh_token": "refresh-2",
                        "expires_in": 3599,
                    },
                )
            ],
            seen=seen,
        )
        await service.update_event("cal", "x", _payload())

        assert str(seen[0].url) == GOOGLE_TOKEN_URL
        form = parse_qs(seen[0].content.decode())
        assert form["grant_type"] == ["refresh_token"]
        assert form["refresh_token"] == ["refresh-1"]
        assert form["client_id"] == ["cid"]
        assert http.calls[0].headers["authorization"] == "Bearer access-2"
        assert service.tokens.access_token == "access-2"
        assert service.tokens.refresh_token == "refresh-2"
        assert service.tokens.rotated is True
        assert service.tokens.expires_at > datetime.now(timezone.utc)

    async def test_a_401_refreshes_once_and_retries(self):
        service, http = _google(
            [(401, {}), (200, {})],
            creds=self.CREDS,
            token_responses=[
                httpx.Response(200, json={"access_token": "access-2"}),
            ],
        )
        await service.update_event("cal", "x", _payload())

        assert [c.headers["authorization"] for c in http.calls] == [
            "Bearer access-1",
            "Bearer access-2",
        ]
        assert service.tokens.refresh_token == "refresh-1"
        assert service.tokens.rotated is False

    async def test_invalid_grant_is_auth_revoked(self):
        service, http = _google(
            [],
            creds={k: v for k, v in self.CREDS.items() if k != "token"},
            token_responses=[
                httpx.Response(400, json={"error": "invalid_grant"}),
            ],
        )
        with pytest.raises(CalendarAuthRevoked):
            await service.delete_event("cal", "x")
        assert http.calls == []


# ---------------------------------------------------------------------------
# Outlook
# ---------------------------------------------------------------------------


def _outlook(responses, creds=None):
    seen = []

    def handler(request):
        seen.append(request)
        step = responses.pop(0)
        if isinstance(step, BaseException):
            raise step
        return step

    service = OutlookCalendarService(
        creds or {"token": "access-1"},
        client_factory=lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ),
    )
    return service, seen


class TestOutlookEvents:
    async def test_create_sends_a_transaction_id_and_utc_times(self):
        service, seen = _outlook([httpx.Response(201, json={"id": "AAMk="})])
        result = await service.upsert_event("cal/1", None, _payload())

        assert result == "AAMk="
        request = seen[0]
        assert request.method == "POST"
        assert request.url.raw_path == b"/v1.0/me/calendars/cal%2F1/events"
        body = json.loads(request.content)
        assert body["transactionId"] == EVENT_ID
        assert body["start"] == {"dateTime": "2026-01-15T14:00:00", "timeZone": "UTC"}
        assert body["end"] == {"dateTime": "2026-01-15T16:00:00", "timeZone": "UTC"}
        assert body["location"] == {"displayName": "Station 6 bay"}
        assert "Bring turnout gear" not in body["body"]["content"]
        assert set(body) == {
            "subject",
            "body",
            "start",
            "end",
            "location",
            "transactionId",
        }
        assert request.headers["authorization"] == "Bearer access-1"

    async def test_a_known_id_patches_and_recreates_when_gone(self):
        service, seen = _outlook(
            [httpx.Response(404), httpx.Response(201, json={"id": "new-id"})]
        )
        assert await service.upsert_event("cal", "old-id", _payload()) == "new-id"
        assert [r.method for r in seen] == ["PATCH", "POST"]
        assert seen[0].url.path.endswith("/events/old-id")

    async def test_delete_of_a_missing_event_succeeds(self):
        service, seen = _outlook([httpx.Response(404)])
        await service.delete_event("cal", "ext-1")
        assert seen[0].method == "DELETE"

    async def test_create_calendar_posts_to_me_calendars(self):
        service, seen = _outlook([httpx.Response(201, json={"id": "cal-9"})])
        assert await service.create_calendar("Station 6 Events") == "cal-9"
        assert seen[0].url.path == "/v1.0/me/calendars"
        assert json.loads(seen[0].content) == {"name": "Station 6 Events"}

    async def test_test_connection_counts_calendars(self):
        service, _ = _outlook([httpx.Response(200, json={"value": [{}, {}]})])
        assert await service.test_connection() == "Connected to Outlook (2 calendar(s))"


class TestOutlookErrors:
    @pytest.mark.parametrize(
        ("response", "expected"),
        [
            (httpx.Response(401), CalendarAuthRevoked),
            (httpx.Response(404), CalendarNotFound),
            (httpx.Response(500), CalendarTransient),
            (httpx.Response(503), CalendarRateLimited),
            (httpx.Response(429, headers={"Retry-After": "12"}), CalendarRateLimited),
            (httpx.Response(400), CalendarError),
            (httpx.ConnectTimeout("slow"), CalendarTransient),
            (httpx.ConnectError("dns"), CalendarTransient),
        ],
    )
    async def test_failure_maps_to_a_typed_error(self, response, expected):
        service, _ = _outlook([response])
        with pytest.raises(CalendarError) as exc_info:
            await service.update_event("cal", "ext-1", _payload())
        assert type(exc_info.value) is expected
        if isinstance(response, httpx.Response) and response.status_code == 429:
            assert exc_info.value.retry_after == 12.0


class TestOutlookTokens:
    CREDS = {
        "refresh_token": "refresh-1",
        "client_id": "cid",
        "client_secret": "csecret",
        "tenant_id": "tenant-a",
    }

    async def test_refresh_over_httpx_returns_the_rotated_token(self):
        service, seen = _outlook(
            [
                httpx.Response(
                    200,
                    json={
                        "access_token": "access-2",
                        "refresh_token": "refresh-2",
                        "expires_in": 3600,
                    },
                ),
                httpx.Response(200, json={}),
            ],
            creds=self.CREDS,
        )
        await service.update_event("cal", "ext-1", _payload())

        token_request, graph_request = seen
        assert str(token_request.url) == (
            "https://login.microsoftonline.com/tenant-a/oauth2/v2.0/token"
        )
        form = parse_qs(token_request.content.decode())
        assert form["grant_type"] == ["refresh_token"]
        assert "offline_access" in form["scope"][0]
        assert "Calendars.ReadWrite" in form["scope"][0]
        assert graph_request.headers["authorization"] == "Bearer access-2"
        assert service.tokens.refresh_token == "refresh-2"
        assert service.tokens.rotated is True

    async def test_a_401_refreshes_once_then_gives_up(self):
        service, seen = _outlook(
            [
                httpx.Response(401),
                httpx.Response(200, json={"access_token": "access-2"}),
                httpx.Response(401),
            ],
            creds={**self.CREDS, "token": "access-1"},
        )
        with pytest.raises(CalendarAuthRevoked):
            await service.delete_event("cal", "ext-1")
        assert len(seen) == 3

    async def test_invalid_grant_is_auth_revoked(self):
        service, seen = _outlook(
            [httpx.Response(400, json={"error": "invalid_grant"})], creds=self.CREDS
        )
        with pytest.raises(CalendarAuthRevoked):
            await service.create_calendar("x")
        # A refused refresh is final: no second refresh, no Graph call.
        assert len(seen) == 1

    async def test_token_endpoint_rate_limit_carries_retry_after(self):
        service, _ = _outlook(
            [httpx.Response(429, headers={"Retry-After": "7"})], creds=self.CREDS
        )
        with pytest.raises(CalendarRateLimited) as exc_info:
            await service.refresh_tokens()
        assert exc_info.value.retry_after == 7.0


def test_stored_credentials_include_the_public_expiry():
    secrets = {"refresh_token": "r", "token": "t"}
    integration = SimpleNamespace(
        get_secret=secrets.get,
        config={"token_expires_at": "2026-10-16T12:00:00+00:00"},
    )
    assert _get_calendar_credentials(integration) == {
        "refresh_token": "r",
        "token": "t",
        "token_expires_at": "2026-10-16T12:00:00+00:00",
    }
