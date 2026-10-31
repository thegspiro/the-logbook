"""
The event's own guest QR code (``Event.guest_check_in_token``).

The room kiosk's guest sign-in, reached through a token an events.manage
holder issues for one event, so a public event held where there is no kiosk
can still sign visitors in. Unit tests cover the token, the confirm-token
binding and the endpoint gates with the database mocked; the integration tests
drive the real endpoints against the real schema, because what the token
resolves (cancelled, draft, switched off, another department) is a query
property a mocked session cannot evaluate.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.api.public.display as display
import app.api.public.event_guest as event_guest
import app.api.v1.endpoints.events as events_endpoints
from app.core.database import get_db
from app.core.error_reporting import sanitize_path
from app.models.event import (
    CheckInWindowType,
    Event,
    EventExternalAttendee,
    EventType,
)
from app.schemas.event import GuestCheckInRequest
from app.services.guest_check_in_service import GuestCheckInService

EVENT_ID = str(uuid.uuid4())
ORG_ID = str(uuid.uuid4())
LOC_ID = str(uuid.uuid4())
PROSPECT_ID = str(uuid.uuid4())
TOKEN = GuestCheckInService.new_link_token()


@pytest.mark.unit
class TestLinkToken:
    def test_issued_token_matches_the_accepted_shape(self):
        for _ in range(50):
            token = GuestCheckInService.new_link_token()
            assert GuestCheckInService.LINK_TOKEN_PATTERN.fullmatch(token)

    def test_issued_tokens_differ(self):
        tokens = {GuestCheckInService.new_link_token() for _ in range(50)}
        assert len(tokens) == 50

    @pytest.mark.parametrize(
        "token", ["", "short", "x" * 42, "x" * 44, "a" * 42 + "!", "../" + "a" * 40]
    )
    async def test_malformed_token_never_reaches_the_database(self, token):
        db = MagicMock()
        db.execute = AsyncMock()

        assert await GuestCheckInService(db).get_event_by_link_token(token) is None
        db.execute.assert_not_awaited()


@pytest.mark.unit
class TestConfirmTokenChannels:
    """A confirm token works only through the entrance that issued it."""

    def _issue(self, location_id):
        return GuestCheckInService.issue_confirm_token(
            prospect_id=PROSPECT_ID,
            event_id=EVENT_ID,
            location_id=location_id,
            organization_id=ORG_ID,
        )

    def _read(self, token, location_id):
        return GuestCheckInService.read_confirm_token(
            token, event_id=EVENT_ID, location_id=location_id, organization_id=ORG_ID
        )

    def test_link_token_round_trips_through_the_link(self):
        assert self._read(self._issue(None), None) == PROSPECT_ID

    def test_kiosk_token_is_refused_through_the_link(self):
        assert self._read(self._issue(LOC_ID), None) is None

    def test_link_token_is_refused_at_a_kiosk(self):
        assert self._read(self._issue(None), LOC_ID) is None


@pytest.mark.unit
class TestTokenRedaction:
    """The token is a credential, so error reports must not keep it."""

    def test_page_path_is_redacted(self):
        assert sanitize_path(f"/event-guest/{TOKEN}") == "/event-guest/[REDACTED]"

    def test_api_path_is_redacted(self):
        assert sanitize_path(f"/api/public/v1/event-guest/{TOKEN}/guest-check-in") == (
            "/api/public/v1/event-guest/[REDACTED]/guest-check-in"
        )

    def test_route_parameter_is_redacted(self):
        assert sanitize_path(
            f"/public/v1/event-guest/{TOKEN}/guest", {"guest_token": TOKEN}
        ) == ("/public/v1/event-guest/[REDACTED]/guest")


@pytest.mark.unit
class TestManagerEndpointsArePermissionGated:
    """The member QR page is open to every member; the guest code is not."""

    @pytest.mark.parametrize(
        ("path", "method"),
        [
            ("/{event_id}/guest-check-in-link", "GET"),
            ("/{event_id}/guest-check-in-link", "POST"),
            ("/{event_id}/guest-check-in-link/rotate", "POST"),
        ],
    )
    def test_requires_events_manage(self, path, method):
        route = next(
            r
            for r in events_endpoints.router.routes
            if r.path.endswith(path) and method in r.methods
        )
        required = [
            getattr(dep.call, "required_permissions", None)
            for dep in route.dependant.dependencies
        ]
        assert ["events.manage"] in required


def _event(**overrides):
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=uuid.UUID(EVENT_ID),
        organization_id=ORG_ID,
        location_id=None,
        title="Open House",
        event_type=None,
        start_datetime=now - timedelta(minutes=5),
        end_datetime=now + timedelta(hours=1),
        actual_start_time=None,
        actual_end_time=None,
        check_in_window_type=CheckInWindowType.FLEXIBLE,
        check_in_minutes_before=30,
        check_in_minutes_after=None,
        allow_guest_check_in=True,
        guest_check_in_creates_prospect=False,
        attendance_finalized_at=None,
        custom_fields={},
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _patch_resolve(monkeypatch, event):
    org = SimpleNamespace(name="Test Dept", timezone="UTC")
    monkeypatch.setattr(
        event_guest, "_resolve_link_event", AsyncMock(return_value=(event, org))
    )
    monkeypatch.setattr(event_guest, "log_audit_event", AsyncMock())


def _payload(**overrides):
    args = dict(first_name="Dana", last_name="Reyes")
    args.update(overrides)
    return GuestCheckInRequest(**args)


@pytest.mark.unit
class TestEndpointGates:
    """The kiosk's ordering: every refusal runs before the cap is spent."""

    async def test_typed_form_is_refused_at_a_pipeline_event(self, monkeypatch):
        _patch_resolve(monkeypatch, _event(guest_check_in_creates_prospect=True))
        cap = AsyncMock(return_value=False)
        monkeypatch.setattr(event_guest, "daily_cap_exceeded", cap)

        with pytest.raises(HTTPException) as exc:
            await event_guest.link_guest_check_in(
                payload=_payload(email="dana@example.com"),
                request=MagicMock(),
                guest_token=TOKEN,
                db=MagicMock(),
            )

        assert exc.value.status_code == 400
        assert exc.value.error_code.value == "LB-EVT-006"
        cap.assert_not_awaited()

    async def test_window_not_open_does_not_spend_the_cap(self, monkeypatch):
        now = datetime.now(timezone.utc)
        _patch_resolve(
            monkeypatch,
            _event(
                start_datetime=now + timedelta(hours=3),
                end_datetime=now + timedelta(hours=5),
            ),
        )
        cap = AsyncMock(return_value=False)
        monkeypatch.setattr(event_guest, "daily_cap_exceeded", cap)

        with pytest.raises(HTTPException) as exc:
            await event_guest.link_guest_check_in(
                payload=_payload(),
                request=MagicMock(),
                guest_token=TOKEN,
                db=MagicMock(),
            )

        assert exc.value.status_code == 400
        cap.assert_not_awaited()

    async def test_finalized_attendance_does_not_spend_the_cap(self, monkeypatch):
        _patch_resolve(
            monkeypatch, _event(attendance_finalized_at=datetime.now(timezone.utc))
        )
        cap = AsyncMock(return_value=False)
        monkeypatch.setattr(event_guest, "daily_cap_exceeded", cap)

        with pytest.raises(HTTPException) as exc:
            await event_guest.link_guest_check_in(
                payload=_payload(),
                request=MagicMock(),
                guest_token=TOKEN,
                db=MagicMock(),
            )

        assert exc.value.status_code == 400
        cap.assert_not_awaited()

    async def test_shares_the_kiosk_daily_ceiling(self, monkeypatch):
        """Alternating entrances must not double an event's allowance."""
        _patch_resolve(monkeypatch, _event())
        cap = AsyncMock(return_value=True)
        monkeypatch.setattr(event_guest, "daily_cap_exceeded", cap)

        with pytest.raises(HTTPException) as exc:
            await event_guest.link_guest_check_in(
                payload=_payload(),
                request=MagicMock(),
                guest_token=TOKEN,
                db=MagicMock(),
            )

        assert exc.value.status_code == 429
        assert cap.await_args.args[0] == f"guest_checkin:{uuid.UUID(EVENT_ID)}"

    async def test_honeypot_writes_nothing(self, monkeypatch):
        _patch_resolve(monkeypatch, _event())
        cap = AsyncMock(return_value=False)
        monkeypatch.setattr(event_guest, "daily_cap_exceeded", cap)
        check_in = AsyncMock()
        monkeypatch.setattr(GuestCheckInService, "check_in_guest", check_in)

        result = await event_guest.link_guest_check_in(
            payload=_payload(hp_website="http://spam.example"),
            request=MagicMock(),
            guest_token=TOKEN,
            db=MagicMock(),
        )

        assert result.status == "checked_in"
        check_in.assert_not_awaited()
        cap.assert_not_awaited()


@pytest.mark.unit
class TestManagerSeesWhetherTheCodeWouldWork:
    """The card hides the code exactly while a scan of it would be refused."""

    def _response(self, **overrides):
        return events_endpoints._guest_link_response(
            _event(guest_check_in_token=TOKEN, **overrides)
        )

    def test_open_window_reports_open_with_its_bounds(self):
        result = self._response()

        assert result.is_open is True
        assert result.closed_reason is None
        opens = datetime.fromisoformat(result.check_in_opens_at)
        closes = datetime.fromisoformat(result.check_in_closes_at)
        assert opens < datetime.now(timezone.utc) < closes
        assert result.guest_token == TOKEN

    def test_before_the_window_reports_closed(self):
        now = datetime.now(timezone.utc)
        result = self._response(
            start_datetime=now + timedelta(hours=3),
            end_datetime=now + timedelta(hours=5),
        )

        assert result.is_open is False
        assert result.closed_reason == "Check-in for this event has not opened yet."
        assert datetime.fromisoformat(result.check_in_opens_at) > now

    def test_after_the_window_reports_closed(self):
        now = datetime.now(timezone.utc)
        result = self._response(
            start_datetime=now - timedelta(hours=5),
            end_datetime=now - timedelta(hours=3),
        )

        assert result.is_open is False
        assert result.closed_reason == "Check-in has closed for this event."

    def test_finalized_attendance_reports_closed_inside_the_window(self):
        result = self._response(attendance_finalized_at=datetime.now(timezone.utc))

        assert result.is_open is False
        assert result.closed_reason == "Attendance for this event has been closed."

    def test_agrees_with_what_the_public_endpoint_enforces(self):
        """One definition: the manager's view and the public gate cannot drift."""
        now = datetime.now(timezone.utc)
        cases = [
            _event(),
            _event(start_datetime=now + timedelta(hours=3)),
            _event(attendance_finalized_at=now),
        ]
        for event in cases:
            is_open, _reason = GuestCheckInService.guest_sign_in_state(event, now)
            try:
                display._assert_guest_sign_in_open(event)
                accepted = True
            except HTTPException:
                accepted = False
            assert accepted is is_open


# ---- Integration: the real endpoints against the real schema ----


async def _other_org(db_session: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"other-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


@pytest.fixture
async def org_id(setup_org_and_admin) -> str:
    org, _admin = setup_org_and_admin
    return org


@pytest.fixture
async def admin(setup_org_and_admin):
    org, admin_id = setup_org_and_admin
    return SimpleNamespace(id=admin_id, organization_id=org, username="admin")


async def _make_event(db_session, org_id, **overrides) -> Event:
    now = datetime.now(timezone.utc)
    fields = dict(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        title="Community Open House",
        event_type=EventType.PUBLIC_EDUCATION,
        start_datetime=now - timedelta(minutes=5),
        end_datetime=now + timedelta(hours=2),
        check_in_window_type=CheckInWindowType.FLEXIBLE,
        location="Central Park Pavilion",
        allow_guest_check_in=True,
    )
    fields.update(overrides)
    event = Event(**fields)
    db_session.add(event)
    await db_session.flush()
    return event


@pytest.mark.integration
class TestIssueLinkToken:
    async def test_existing_rows_keep_a_null_token(self, db_session, org_id):
        """The unique index admits every pre-existing event's NULL at once."""
        events = [await _make_event(db_session, org_id) for _ in range(3)]

        tokens = (
            await db_session.execute(
                select(Event.guest_check_in_token).where(
                    Event.id.in_([e.id for e in events])
                )
            )
        ).scalars()
        assert list(tokens) == [None, None, None]

    async def test_issue_is_idempotent(self, db_session, org_id):
        event = await _make_event(db_session, org_id)
        service = GuestCheckInService(db_session)

        first, changed_first = await service.issue_link_token(event.id, org_id)
        second, changed_second = await service.issue_link_token(event.id, org_id)

        assert changed_first is True
        assert changed_second is False
        assert first.guest_check_in_token == second.guest_check_in_token

    async def test_rotate_replaces_the_code(self, db_session, org_id):
        event = await _make_event(db_session, org_id)
        service = GuestCheckInService(db_session)
        issued, _ = await service.issue_link_token(event.id, org_id)
        old = issued.guest_check_in_token

        rotated, changed = await service.issue_link_token(event.id, org_id, True)

        assert changed is True
        assert rotated.guest_check_in_token != old
        assert await service.get_event_by_link_token(old) is None

    async def test_issue_refused_while_guest_check_in_is_off(self, db_session, org_id):
        event = await _make_event(db_session, org_id, allow_guest_check_in=False)

        with pytest.raises(ValueError, match="Turn on guest check-in"):
            await GuestCheckInService(db_session).issue_link_token(event.id, org_id)

    async def test_rotate_allowed_while_guest_check_in_is_off(self, db_session, org_id):
        event = await _make_event(db_session, org_id, allow_guest_check_in=False)

        rotated, changed = await GuestCheckInService(db_session).issue_link_token(
            event.id, org_id, rotate=True
        )

        assert changed is True
        assert rotated.guest_check_in_token

    async def test_another_departments_event_is_not_found(self, db_session, org_id):
        other = await _other_org(db_session)
        event = await _make_event(db_session, other)

        found, changed = await GuestCheckInService(db_session).issue_link_token(
            event.id, org_id
        )

        assert found is None
        assert changed is False
        await db_session.refresh(event)
        assert event.guest_check_in_token is None


@pytest.mark.integration
class TestManagerEndpoints:
    async def test_get_reports_none_until_issued(self, db_session, admin):
        event = await _make_event(db_session, admin.organization_id)

        result = await events_endpoints.get_guest_check_in_link(
            event_id=uuid.UUID(event.id), db=db_session, current_user=admin
        )

        assert result.guest_token is None
        assert result.allow_guest_check_in is True

    async def test_issue_then_get_return_the_same_code(self, db_session, admin):
        event = await _make_event(db_session, admin.organization_id)

        issued = await events_endpoints.issue_guest_check_in_link(
            event_id=uuid.UUID(event.id), db=db_session, current_user=admin
        )
        fetched = await events_endpoints.get_guest_check_in_link(
            event_id=uuid.UUID(event.id), db=db_session, current_user=admin
        )

        assert issued.guest_token
        assert fetched.guest_token == issued.guest_token

    async def test_issue_while_off_is_a_400(self, db_session, admin):
        event = await _make_event(
            db_session, admin.organization_id, allow_guest_check_in=False
        )

        with pytest.raises(HTTPException) as exc:
            await events_endpoints.issue_guest_check_in_link(
                event_id=uuid.UUID(event.id), db=db_session, current_user=admin
            )

        assert exc.value.status_code == 400

    async def test_another_departments_event_is_a_404(self, db_session, admin):
        other = await _other_org(db_session)
        event = await _make_event(db_session, other)

        for handler in (
            events_endpoints.get_guest_check_in_link,
            events_endpoints.issue_guest_check_in_link,
            events_endpoints.rotate_guest_check_in_link,
        ):
            with pytest.raises(HTTPException) as exc:
                await handler(
                    event_id=uuid.UUID(event.id), db=db_session, current_user=admin
                )
            assert exc.value.status_code == 404

    async def test_event_detail_never_carries_the_token(self, db_session, admin):
        """Any member reads the detail; only the manage endpoint returns the code."""
        from app.schemas.event import EventResponse

        assert "guest_check_in_token" not in EventResponse.model_fields


@pytest.fixture
def client(db_session: AsyncSession, monkeypatch):
    # The per-IP limiters live in display.py and the daily ceiling is a Redis
    # counter shared across the run; they are covered above.
    monkeypatch.setattr(
        display, "public_rate_limit", AsyncMock(return_value=(False, None))
    )
    monkeypatch.setattr(
        event_guest, "daily_cap_exceeded", AsyncMock(return_value=False)
    )

    app = FastAPI()
    app.include_router(event_guest.router)

    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _issued(db_session, org_id, **overrides) -> tuple[Event, str]:
    event = await _make_event(db_session, org_id, **overrides)
    issued, _ = await GuestCheckInService(db_session).issue_link_token(
        event.id, org_id, rotate=True
    )
    return issued, issued.guest_check_in_token


@pytest.mark.integration
class TestPublicSignIn:
    async def test_info_names_the_event_and_its_venue(self, client, db_session, org_id):
        _event, token = await _issued(db_session, org_id)

        async with client as c:
            r = await c.get(f"/public/v1/event-guest/{token}/guest")

        assert r.status_code == 200, r.text
        body = r.json()
        assert body["event_name"] == "Community Open House"
        assert body["location_name"] == "Central Park Pavilion"
        assert body["is_open"] is True

    async def test_info_reports_closed_once_attendance_is_finalized(
        self, client, db_session, org_id
    ):
        """PUB-13: the info the sign-in page reads must agree with what the
        write endpoint enforces (GuestCheckInService.guest_sign_in_state),
        not merely with the check-in window — otherwise the page shows the
        form for an event whose attendance is already closed, and the guest
        is refused only after filling it in."""
        _event, token = await _issued(
            db_session, org_id, attendance_finalized_at=datetime.now(timezone.utc)
        )

        async with client as c:
            r = await c.get(f"/public/v1/event-guest/{token}/guest")

        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_open"] is False
        assert body["closed_reason"] == "Attendance for this event has been closed."

    async def test_sign_in_records_the_guest_as_event_qr(
        self, client, db_session, org_id
    ):
        event, token = await _issued(db_session, org_id)

        async with client as c:
            r = await c.post(
                f"/public/v1/event-guest/{token}/guest-check-in",
                json={"first_name": "Dana", "last_name": "Reyes"},
            )

        assert r.status_code == 201, r.text
        attendee = (
            await db_session.execute(
                select(EventExternalAttendee).where(
                    EventExternalAttendee.event_id == event.id
                )
            )
        ).scalar_one()
        assert attendee.name == "Dana Reyes"
        assert attendee.checked_in is True
        assert attendee.source == GuestCheckInService.SOURCE_EVENT_QR
        assert attendee.organization_id == org_id

    async def test_repeat_sign_in_is_one_attendee(self, client, db_session, org_id):
        event, token = await _issued(db_session, org_id)
        body = {"first_name": "Dana", "last_name": "Reyes", "email": "d@x.example"}

        async with client as c:
            first = await c.post(
                f"/public/v1/event-guest/{token}/guest-check-in", json=body
            )
            second = await c.post(
                f"/public/v1/event-guest/{token}/guest-check-in", json=body
            )

        assert first.status_code == second.status_code == 201
        rows = (
            await db_session.execute(
                select(EventExternalAttendee).where(
                    EventExternalAttendee.event_id == event.id
                )
            )
        ).scalars()
        assert len(list(rows)) == 1

    @pytest.mark.parametrize(
        "overrides",
        [
            {"allow_guest_check_in": False},
            {"is_cancelled": True},
            {"is_draft": True},
        ],
    )
    async def test_unavailable_event_is_a_404(
        self, client, db_session, org_id, overrides
    ):
        event, token = await _issued(db_session, org_id)
        for key, value in overrides.items():
            setattr(event, key, value)
        await db_session.flush()

        async with client as c:
            info = await c.get(f"/public/v1/event-guest/{token}/guest")
            write = await c.post(
                f"/public/v1/event-guest/{token}/guest-check-in",
                json={"first_name": "Dana", "last_name": "Reyes"},
            )

        assert info.status_code == 404
        assert write.status_code == 404

    async def test_rotated_code_is_a_404(self, client, db_session, org_id):
        event, old = await _issued(db_session, org_id)
        await GuestCheckInService(db_session).issue_link_token(
            event.id, org_id, rotate=True
        )

        async with client as c:
            r = await c.get(f"/public/v1/event-guest/{old}/guest")

        assert r.status_code == 404

    async def test_unknown_code_is_a_404(self, client):
        async with client as c:
            r = await c.get(
                f"/public/v1/event-guest/{GuestCheckInService.new_link_token()}/guest"
            )

        assert r.status_code == 404

    async def test_malformed_code_is_rejected(self, client):
        async with client as c:
            r = await c.get("/public/v1/event-guest/not-a-token/guest")

        assert r.status_code == 422
