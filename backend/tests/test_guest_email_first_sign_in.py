"""
Email-first guest sign-in at pipeline-linked events.

At an event that adds its guests to the prospective members pipeline, the
kiosk no longer takes a typed name: the visitor enters an email, an active
applicant is recognised by first name and last initial and confirms, a member
account is pointed at the member QR code, and anyone else is sent to staff.

Unit tests cover the token and the endpoint gates with the database mocked;
the integration tests drive the real endpoints against the real schema,
because what the lookup matches (status, organization, case) is a query
property a mocked session cannot evaluate.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import jwt
import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.api.public.display as display
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, email_fingerprint
from app.models.event import (
    CheckInWindowType,
    Event,
    EventExternalAttendee,
    EventType,
)
from app.models.location import Location
from app.models.membership_pipeline import (
    ProspectEventLink,
    ProspectiveMember,
    ProspectStatus,
)
from app.schemas.event import GuestCheckInRequest, GuestLookupRequest
from app.services.guest_check_in_service import GuestCheckInService

EVENT_ID = str(uuid.uuid4())
LOC_ID = str(uuid.uuid4())
ORG_ID = str(uuid.uuid4())
PROSPECT_ID = str(uuid.uuid4())


def _token(**overrides):
    args = dict(
        prospect_id=PROSPECT_ID,
        event_id=EVENT_ID,
        location_id=LOC_ID,
        organization_id=ORG_ID,
    )
    args.update(overrides)
    return GuestCheckInService.issue_confirm_token(**args)


def _read(token, **overrides):
    args = dict(event_id=EVENT_ID, location_id=LOC_ID, organization_id=ORG_ID)
    args.update(overrides)
    return GuestCheckInService.read_confirm_token(token, **args)


@pytest.mark.unit
class TestShortName:
    def test_first_name_and_last_initial(self):
        assert GuestCheckInService.short_name("Jane", "Smith") == "Jane S."

    def test_surrounding_whitespace_is_ignored(self):
        assert GuestCheckInService.short_name(" Jane ", "  smith") == "Jane s."

    def test_missing_last_name_shows_first_name_only(self):
        assert GuestCheckInService.short_name("Jane", "") == "Jane"


@pytest.mark.unit
class TestConfirmToken:
    """The token, not the browser, names the applicant being signed in."""

    def test_round_trip_returns_the_prospect(self):
        assert _read(_token()) == PROSPECT_ID

    def test_another_event_is_refused(self):
        assert _read(_token(), event_id=str(uuid.uuid4())) is None

    def test_another_room_is_refused(self):
        assert _read(_token(), location_id=str(uuid.uuid4())) is None

    def test_another_department_is_refused(self):
        assert _read(_token(), organization_id=str(uuid.uuid4())) is None

    def test_expired_token_is_refused(self):
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        token = jwt.encode(
            {
                "type": GuestCheckInService.CONFIRM_TOKEN_TYPE,
                "sub": PROSPECT_ID,
                "evt": EVENT_ID,
                "loc": LOC_ID,
                "org": ORG_ID,
                "exp": past,
            },
            settings.SECRET_KEY,
            algorithm="HS256",
        )
        assert _read(token) is None

    def test_a_session_token_is_not_a_confirm_token(self):
        assert _read(create_access_token({"sub": PROSPECT_ID})) is None

    def test_a_token_signed_with_another_key_is_refused(self):
        token = jwt.encode(
            {
                "type": GuestCheckInService.CONFIRM_TOKEN_TYPE,
                "sub": PROSPECT_ID,
                "evt": EVENT_ID,
                "loc": LOC_ID,
                "org": ORG_ID,
                "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
            },
            "not-the-secret-key-" * 4,
            algorithm="HS256",
        )
        assert _read(token) is None

    def test_garbage_is_refused(self):
        assert _read("not-a-token") is None

    def test_lifetime_is_ten_minutes(self):
        payload = jwt.decode(_token(), settings.SECRET_KEY, algorithms=["HS256"])
        lifetime = payload["exp"] - payload["iat"]
        assert lifetime == 600


def _pipeline_event(**overrides):
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=uuid.UUID(EVENT_ID),
        organization_id=ORG_ID,
        title="Recruitment Night",
        event_type=None,
        start_datetime=now - timedelta(minutes=5),
        end_datetime=now + timedelta(hours=1),
        actual_start_time=None,
        actual_end_time=None,
        check_in_window_type=CheckInWindowType.FLEXIBLE,
        check_in_minutes_before=30,
        check_in_minutes_after=None,
        allow_guest_check_in=True,
        guest_check_in_creates_prospect=True,
        attendance_finalized_at=None,
        custom_fields={},
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _patch_resolve(monkeypatch, event):
    location = SimpleNamespace(id=LOC_ID, organization_id=ORG_ID)
    org = SimpleNamespace(name="Test Dept", timezone="UTC")
    monkeypatch.setattr(
        display, "_resolve_guest_event", AsyncMock(return_value=(location, event, org))
    )
    monkeypatch.setattr(display, "log_audit_event", AsyncMock())
    return location


@pytest.mark.unit
class TestEndpointGates:
    async def test_typed_form_is_refused_at_a_pipeline_event(self, monkeypatch):
        """Hiding the form is not enough; a direct call must not open a prospect."""
        _patch_resolve(monkeypatch, _pipeline_event())
        cap = AsyncMock(return_value=False)
        monkeypatch.setattr(display, "daily_cap_exceeded", cap)

        with pytest.raises(HTTPException) as exc:
            await display.guest_check_in(
                display_code="abc123",
                event_id=uuid.UUID(EVENT_ID),
                payload=GuestCheckInRequest(
                    first_name="Dana", last_name="Reyes", email="dana@example.com"
                ),
                request=MagicMock(),
                db=MagicMock(),
            )

        assert exc.value.status_code == 400
        assert exc.value.error_code.value == "LB-EVT-006"
        cap.assert_not_awaited()

    async def test_lookup_is_unavailable_at_a_non_pipeline_event(self, monkeypatch):
        _patch_resolve(
            monkeypatch, _pipeline_event(guest_check_in_creates_prospect=False)
        )

        with pytest.raises(HTTPException) as exc:
            await display.guest_lookup(
                display_code="abc123",
                event_id=uuid.UUID(EVENT_ID),
                payload=GuestLookupRequest(email="dana@example.com"),
                request=MagicMock(),
                db=MagicMock(),
            )

        assert exc.value.status_code == 404

    async def test_confirm_is_unavailable_at_a_non_pipeline_event(self, monkeypatch):
        """Turning the switch off between the two taps stops the confirm too."""
        from app.schemas.event import GuestConfirmRequest

        _patch_resolve(
            monkeypatch, _pipeline_event(guest_check_in_creates_prospect=False)
        )

        with pytest.raises(HTTPException) as exc:
            await display.guest_confirm(
                display_code="abc123",
                event_id=uuid.UUID(EVENT_ID),
                payload=GuestConfirmRequest(confirm_token=_token()),
                request=MagicMock(),
                db=MagicMock(),
            )

        assert exc.value.status_code == 404

    async def test_lookup_outside_the_window_does_not_spend_the_cap(self, monkeypatch):
        now = datetime.now(timezone.utc)
        _patch_resolve(
            monkeypatch,
            _pipeline_event(
                start_datetime=now + timedelta(hours=2),
                end_datetime=now + timedelta(hours=4),
            ),
        )
        cap = AsyncMock(return_value=False)
        monkeypatch.setattr(display, "daily_cap_exceeded", cap)

        with pytest.raises(HTTPException) as exc:
            await display.guest_lookup(
                display_code="abc123",
                event_id=uuid.UUID(EVENT_ID),
                payload=GuestLookupRequest(email="dana@example.com"),
                request=MagicMock(),
                db=MagicMock(),
            )

        assert exc.value.status_code == 400
        cap.assert_not_awaited()

    async def test_lookup_honeypot_answers_like_an_unknown_email(self, monkeypatch):
        _patch_resolve(monkeypatch, _pipeline_event())
        cap = AsyncMock(return_value=False)
        monkeypatch.setattr(display, "daily_cap_exceeded", cap)
        lookup = AsyncMock()
        monkeypatch.setattr(GuestCheckInService, "lookup_guest", lookup)

        result = await display.guest_lookup(
            display_code="abc123",
            event_id=uuid.UUID(EVENT_ID),
            payload=GuestLookupRequest(
                email="dana@example.com", hp_website="http://spam.example"
            ),
            request=MagicMock(),
            db=MagicMock(),
        )

        assert result.status == "not_found"
        assert result.confirm_token is None
        lookup.assert_not_awaited()
        cap.assert_not_awaited()

    async def test_bad_token_does_not_spend_the_cap(self, monkeypatch):
        from app.schemas.event import GuestConfirmRequest

        _patch_resolve(monkeypatch, _pipeline_event())
        cap = AsyncMock(return_value=False)
        monkeypatch.setattr(display, "daily_cap_exceeded", cap)

        with pytest.raises(HTTPException) as exc:
            await display.guest_confirm(
                display_code="abc123",
                event_id=uuid.UUID(EVENT_ID),
                payload=GuestConfirmRequest(
                    confirm_token=_token(event_id=str(uuid.uuid4()))
                ),
                request=MagicMock(),
                db=MagicMock(),
            )

        assert exc.value.status_code == 400
        assert "expired" in exc.value.detail
        cap.assert_not_awaited()


# ---- Integration: the real endpoints against the real schema ----


class _Bench:
    def __init__(self, org_id, other_org_id, location, event, other_event):
        self.org_id = org_id
        self.other_org_id = other_org_id
        self.location = location
        self.event = event
        self.other_event = other_event


@pytest.fixture
async def bench(db_session: AsyncSession, setup_org_and_admin) -> _Bench:
    org_id, _admin_id = setup_org_and_admin
    other_org = await _other_org(db_session)
    now = datetime.now(timezone.utc)

    location = Location(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Training Room",
        display_code=uuid.uuid4().hex[:10],
    )
    db_session.add(location)
    await db_session.flush()

    def _event(title):
        return Event(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            title=title,
            event_type=EventType.PUBLIC_EDUCATION,
            start_datetime=now - timedelta(minutes=5),
            end_datetime=now + timedelta(hours=2),
            check_in_window_type=CheckInWindowType.FLEXIBLE,
            location_id=location.id,
            allow_guest_check_in=True,
            guest_check_in_creates_prospect=True,
        )

    event = _event("Recruitment Night")
    other_event = _event("Second Recruitment Night")
    db_session.add_all([event, other_event])
    await db_session.flush()
    return _Bench(org_id, other_org, location, event, other_event)


async def _other_org(db_session: AsyncSession) -> str:
    from sqlalchemy import text

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


async def _prospect(db_session, org_id, email, status=ProspectStatus.ACTIVE):
    prospect = ProspectiveMember(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        first_name="Jane",
        last_name="Smith",
        email=email,
        phone="555-0100",
        status=status,
    )
    db_session.add(prospect)
    await db_session.flush()
    return prospect


async def _member(db_session, org_id, email, status="active"):
    from sqlalchemy import text

    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, email_hash, password_hash, status) "
            "VALUES (:id, :org, :un, 'Mo', 'Member', :em, :fp, 'hashed', :st)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m-{user_id[:8]}",
            "em": email,
            "fp": email_fingerprint(email),
            "st": status,
        },
    )
    await db_session.flush()


def _email():
    return f"guest-{uuid.uuid4().hex[:10]}@test.example"


@pytest.fixture
def client(db_session: AsyncSession, monkeypatch):
    # The limiters and the daily ceiling are Redis counters shared across the
    # run; they are covered above and must not make this file order-dependent.
    monkeypatch.setattr(
        display, "public_rate_limit", AsyncMock(return_value=(False, None))
    )
    monkeypatch.setattr(display, "daily_cap_exceeded", AsyncMock(return_value=False))

    app = FastAPI()
    app.include_router(display.router)

    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _url(bench, event, action):
    return (
        f"/public/v1/display/{bench.location.display_code}/events/{event.id}/{action}"
    )


@pytest.mark.integration
class TestLookup:
    async def test_active_applicant_is_recognised_by_short_name(
        self, bench, client, db_session
    ):
        email = _email()
        await _prospect(db_session, bench.org_id, email)

        async with client as c:
            r = await c.post(
                _url(bench, bench.event, "guest-lookup"),
                json={"email": email.upper()},
            )

        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "prospect"
        assert body["display_name"] == "Jane S."
        assert body["confirm_token"]
        assert "Smith" not in r.text

    @pytest.mark.parametrize(
        "status",
        [ProspectStatus.WITHDRAWN, ProspectStatus.REJECTED, ProspectStatus.ON_HOLD],
    )
    async def test_inactive_applicant_is_not_recognised(
        self, bench, client, db_session, status
    ):
        email = _email()
        await _prospect(db_session, bench.org_id, email, status=status)

        async with client as c:
            r = await c.post(
                _url(bench, bench.event, "guest-lookup"), json={"email": email}
            )

        assert r.json()["status"] == "not_found"
        assert r.json()["confirm_token"] is None

    async def test_another_departments_applicant_is_not_recognised(
        self, bench, client, db_session
    ):
        email = _email()
        await _prospect(db_session, bench.other_org_id, email)

        async with client as c:
            r = await c.post(
                _url(bench, bench.event, "guest-lookup"), json={"email": email}
            )

        assert r.json()["status"] == "not_found"

    async def test_member_account_is_pointed_at_the_member_code(
        self, bench, client, db_session
    ):
        email = _email()
        await _member(db_session, bench.org_id, email)

        async with client as c:
            r = await c.post(
                _url(bench, bench.event, "guest-lookup"), json={"email": email}
            )

        body = r.json()
        assert body["status"] == "member"
        assert body["display_name"] is None
        assert body["confirm_token"] is None
        assert "member QR code" in body["message"]

    async def test_probationary_member_is_a_member(self, bench, client, db_session):
        email = _email()
        await _member(db_session, bench.org_id, email, status="probationary")

        async with client as c:
            r = await c.post(
                _url(bench, bench.event, "guest-lookup"), json={"email": email}
            )

        assert r.json()["status"] == "member"

    async def test_former_member_is_not_found(self, bench, client, db_session):
        email = _email()
        await _member(db_session, bench.org_id, email, status="retired")

        async with client as c:
            r = await c.post(
                _url(bench, bench.event, "guest-lookup"), json={"email": email}
            )

        assert r.json()["status"] == "not_found"

    async def test_unknown_email_is_sent_to_staff(self, bench, client):
        async with client as c:
            r = await c.post(
                _url(bench, bench.event, "guest-lookup"), json={"email": _email()}
            )

        body = r.json()
        assert body["status"] == "not_found"
        assert "member of staff" in body["message"]

    async def test_lookup_writes_no_attendance(self, bench, client, db_session):
        email = _email()
        await _prospect(db_session, bench.org_id, email)

        async with client as c:
            await c.post(
                _url(bench, bench.event, "guest-lookup"), json={"email": email}
            )

        count = await db_session.scalar(
            select(func.count())
            .select_from(EventExternalAttendee)
            .where(EventExternalAttendee.event_id == bench.event.id)
        )
        assert count == 0


@pytest.mark.integration
class TestConfirm:
    async def _lookup_token(self, client, bench, event, email):
        r = await client.post(_url(bench, event, "guest-lookup"), json={"email": email})
        return r.json()["confirm_token"]

    async def test_confirm_signs_in_and_links_the_applicant(
        self, bench, client, db_session
    ):
        email = _email()
        prospect = await _prospect(db_session, bench.org_id, email)

        async with client as c:
            token = await self._lookup_token(c, bench, bench.event, email)
            r = await c.post(
                _url(bench, bench.event, "guest-confirm"),
                json={"confirm_token": token},
            )

        assert r.status_code == 200, r.text
        assert r.json()["status"] == "checked_in"

        attendee = (
            await db_session.execute(
                select(EventExternalAttendee).where(
                    EventExternalAttendee.event_id == bench.event.id
                )
            )
        ).scalar_one()
        assert attendee.checked_in is True
        assert attendee.prospect_id == prospect.id
        assert attendee.name == "Jane Smith"
        assert attendee.email == email
        assert attendee.source == GuestCheckInService.SOURCE_KIOSK_QR

        link = (
            await db_session.execute(
                select(ProspectEventLink).where(
                    ProspectEventLink.prospect_id == prospect.id,
                    ProspectEventLink.event_id == bench.event.id,
                )
            )
        ).scalar_one_or_none()
        assert link is not None

        # No second applicant was opened for the same person.
        applicants = await db_session.scalar(
            select(func.count())
            .select_from(ProspectiveMember)
            .where(ProspectiveMember.email_hash == email_fingerprint(email))
        )
        assert applicants == 1

    async def test_second_confirm_reports_already_checked_in(
        self, bench, client, db_session
    ):
        email = _email()
        await _prospect(db_session, bench.org_id, email)

        async with client as c:
            token = await self._lookup_token(c, bench, bench.event, email)
            first = await c.post(
                _url(bench, bench.event, "guest-confirm"),
                json={"confirm_token": token},
            )
            again = await self._lookup_token(c, bench, bench.event, email)
            second = await c.post(
                _url(bench, bench.event, "guest-confirm"),
                json={"confirm_token": again},
            )

        assert first.json()["status"] == "checked_in"
        assert second.status_code == 200
        assert second.json()["status"] == "already_checked_in"
        assert second.json()["checked_in_at"] == first.json()["checked_in_at"]

        count = await db_session.scalar(
            select(func.count())
            .select_from(EventExternalAttendee)
            .where(EventExternalAttendee.event_id == bench.event.id)
        )
        assert count == 1

    async def test_token_from_another_event_is_refused(self, bench, client, db_session):
        email = _email()
        await _prospect(db_session, bench.org_id, email)

        async with client as c:
            token = await self._lookup_token(c, bench, bench.other_event, email)
            r = await c.post(
                _url(bench, bench.event, "guest-confirm"),
                json={"confirm_token": token},
            )

        assert r.status_code == 400
        count = await db_session.scalar(
            select(func.count())
            .select_from(EventExternalAttendee)
            .where(EventExternalAttendee.event_id == bench.event.id)
        )
        assert count == 0

    async def test_applicant_withdrawn_between_taps_is_refused(
        self, bench, client, db_session
    ):
        email = _email()
        prospect = await _prospect(db_session, bench.org_id, email)

        async with client as c:
            token = await self._lookup_token(c, bench, bench.event, email)
            prospect.status = ProspectStatus.WITHDRAWN
            await db_session.flush()
            r = await c.post(
                _url(bench, bench.event, "guest-confirm"),
                json={"confirm_token": token},
            )

        assert r.status_code == 400
        assert "member of staff" in r.json()["detail"]

    async def test_typed_form_is_refused_and_opens_no_applicant(
        self, bench, client, db_session
    ):
        email = _email()

        async with client as c:
            r = await c.post(
                _url(bench, bench.event, "guest-check-in"),
                json={"first_name": "Walk", "last_name": "In", "email": email},
            )

        assert r.status_code == 400
        applicants = await db_session.scalar(
            select(func.count())
            .select_from(ProspectiveMember)
            .where(ProspectiveMember.email_hash == email_fingerprint(email))
        )
        assert applicants == 0
