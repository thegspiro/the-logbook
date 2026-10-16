"""The department events ICS feed and the honest calendar catalog entries.

The feed URL is a bearer link that ends up in members' calendar apps, so what
it carries is an allowlist (title, times, location name, type, link back) and
what it reaches is one department's published events. Google Calendar and
Outlook publishing is not built, so behind CALENDAR_SYNC_ENABLED those two
cards read "coming soon" and cannot be connected — including a row an older
release left "connected" with no credentials.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from starlette.requests import Request

from app.api.public import calendar as feed_ep
from app.api.v1.endpoints import integrations as int_ep
from app.models.integration import Integration
from app.schemas.integration import IntegrationConnectRequest
from app.services.integration_services.ical_service import (
    ORG_FEED_TOKEN_HASH_KEY,
    ORG_FEED_TOKEN_SECRET,
    generate_ical_feed,
    hash_feed_token,
    org_feed_token_matches,
)


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": ("203.0.113.41", 1234),
            "query_string": b"",
        }
    )


def _row(itype: str, **kw) -> Integration:
    return Integration(
        id=str(uuid.uuid4()),
        organization_id="org-1",
        integration_type=itype,
        name=itype,
        description="stale seeded text: Two-way sync",
        category="Calendar",
        status=kw.pop("status", "connected"),
        enabled=kw.pop("enabled", True),
        config=kw.pop("config", {}),
    )


# ============================================
# Catalog honesty and the CALENDAR_SYNC_ENABLED flag (no database)
# ============================================


@pytest.mark.unit
class TestCalendarCatalogCopy:
    def test_no_two_way_or_contact_sync_claims(self):
        entries = {
            e["integration_type"]: e
            for e in int_ep.INTEGRATION_CATALOG
            if e["integration_type"] in {"google-calendar", "outlook", "ical"}
        }
        assert set(entries) == {"google-calendar", "outlook", "ical"}
        for entry in entries.values():
            text_ = entry["description"].lower()
            assert "two-way" not in text_
            assert "contact" not in text_
            assert "email" not in text_
        assert "one way" in entries["google-calendar"]["description"]
        assert "one way" in entries["outlook"]["description"]

    def test_response_describes_the_catalog_not_the_seeded_copy(self):
        out = int_ep._integration_to_dict(_row("google-calendar"))
        assert "Two-way" not in out["description"]
        assert "one way" in out["description"]


@pytest.mark.unit
class TestCalendarPublishFlag:
    @pytest.fixture(autouse=True)
    def _flag_off(self):
        with patch.object(int_ep.settings, "CALENDAR_SYNC_ENABLED", False):
            yield

    @pytest.mark.parametrize("itype", ["google-calendar", "outlook"])
    def test_a_connected_row_reads_coming_soon(self, itype):
        out = int_ep._integration_to_dict(_row(itype))
        assert out["status"] == "coming_soon"
        assert out["enabled"] is False

    def test_other_types_are_untouched(self):
        out = int_ep._integration_to_dict(_row("slack"))
        assert out["status"] == "connected"
        assert out["enabled"] is True

    @pytest.mark.parametrize("itype", ["google-calendar", "outlook"])
    def test_cannot_be_connected(self, itype):
        with pytest.raises(HTTPException) as excinfo:
            int_ep._require_available(_row(itype, status="available"))
        assert excinfo.value.status_code == 400

    def test_flag_on_restores_the_stored_status(self):
        with patch.object(int_ep.settings, "CALENDAR_SYNC_ENABLED", True):
            out = int_ep._integration_to_dict(_row("outlook", status="available"))
            int_ep._require_available(_row("outlook", status="available"))
        assert out["status"] == "available"

    def test_flag_defaults_off(self):
        from app.core.config import Settings

        assert Settings.model_fields["CALENDAR_SYNC_ENABLED"].default is False


@pytest.mark.unit
class TestFeedTokenHelpers:
    def test_matches_only_its_own_token(self):
        config = {ORG_FEED_TOKEN_HASH_KEY: hash_feed_token("a" * 64)}
        assert org_feed_token_matches(config, "a" * 64)
        assert not org_feed_token_matches(config, "b" * 64)
        assert not org_feed_token_matches({}, "a" * 64)
        assert not org_feed_token_matches(None, "a" * 64)

    def test_a_client_cannot_set_the_token_or_its_digest(self):
        for key in ("feed_token", ORG_FEED_TOKEN_HASH_KEY):
            with pytest.raises(HTTPException) as excinfo:
                int_ep._validate_config("ical", {key: "chosen-by-client"})
            assert excinfo.value.status_code == 422

    def test_aware_datetimes_are_published_in_utc(self):
        eastern = timezone(timedelta(hours=-5))
        ics = generate_ical_feed(
            [
                {
                    "id": "e1",
                    "title": "Drill",
                    "start_time": datetime(2026, 1, 1, 19, 0, tzinfo=eastern),
                }
            ]
        )
        assert "DTSTART:20260102T000000Z" in ics


# ============================================
# Database-backed: connect, rotate, and the public feed
# ============================================


async def _org(db, name: str = "Feed Dept") -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": name, "slug": f"feed-{org_id[:8]}"},
    )
    return org_id


async def _admin(db, org_id: str) -> SimpleNamespace:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Feed', 'Admin', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"feed-{user_id[:8]}",
            "em": f"feed-{user_id[:8]}@test.com",
        },
    )
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"feed-{user_id[:8]}"
    )


async def _ical(db, org_id: str) -> Integration:
    row = Integration(
        organization_id=org_id,
        integration_type="ical",
        name="iCalendar (ICS)",
        category="Calendar",
        status="available",
        enabled=False,
        config={},
    )
    db.add(row)
    await db.flush()
    return row


async def _event(
    db,
    org_id: str,
    title: str,
    *,
    days_ahead: int = 3,
    is_draft: bool = False,
    is_cancelled: bool = False,
    event_type: str = "training",
) -> str:
    event_id = str(uuid.uuid4())
    start = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    await db.execute(
        text(
            "INSERT INTO events (id, organization_id, title, description, "
            "event_type, location, start_datetime, end_datetime, requires_rsvp, "
            "is_mandatory, is_cancelled, cancellation_reason, is_draft, "
            "custom_fields, reminder_schedule) "
            "VALUES (:id, :org, :title, 'SECRET-DESCRIPTION', :etype, 'Station 1', "
            ":start, :end, 1, 0, :cancelled, 'SECRET-REASON', :draft, "
            "'{\"gate_code\": \"SECRET-FIELD\"}', '[24]')"
        ),
        {
            "id": event_id,
            "org": org_id,
            "title": title,
            "etype": event_type,
            "start": start,
            "end": start + timedelta(hours=2),
            "cancelled": 1 if is_cancelled else 0,
            "draft": 1 if is_draft else 0,
        },
    )
    return event_id


async def _connect(db, row: Integration, admin) -> str:
    with patch.object(int_ep, "log_audit_event", new=AsyncMock()):
        await int_ep.connect_integration(
            row.id,
            _request(),
            body=IntegrationConnectRequest(),
            db=db,
            current_user=admin,
        )
        feed = await int_ep.get_ical_feed(row.id, _request(), db=db, current_user=admin)
    assert feed["feed_path"] == f"/api/public/v1/calendar/org/{feed['token']}.ics"
    token: str = feed["token"]
    return token


async def _fetch(db, token: str) -> str:
    response = await feed_ep.get_department_events_feed(token, db=db)
    return bytes(response.body).decode()


@pytest.mark.integration
class TestDepartmentFeed:
    async def test_connecting_issues_a_stored_digest_and_secret(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _ical(db_session, org_id)
        token = await _connect(db_session, row, admin)

        await db_session.refresh(row)
        assert row.get_secret(ORG_FEED_TOKEN_SECRET) == token
        assert row.config[ORG_FEED_TOKEN_HASH_KEY] == hash_feed_token(token)
        # The plaintext token is never in public config, and the digest is
        # redacted from the integration response.
        assert token not in str(row.config)
        out = int_ep._integration_to_dict(row)
        assert out["config"][ORG_FEED_TOKEN_HASH_KEY] != hash_feed_token(token)

    async def test_feed_carries_only_allowlisted_fields(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _ical(db_session, org_id)
        event_id = await _event(db_session, org_id, "Ladder Drill")
        token = await _connect(db_session, row, admin)

        ics = await _fetch(db_session, token)
        assert "SUMMARY:Ladder Drill" in ics
        assert f"UID:{event_id}@thelogbook.app" in ics
        assert "LOCATION:Station 1" in ics
        assert "CATEGORIES:Training" in ics
        assert f"/events/{event_id}" in ics
        assert "DESCRIPTION" not in ics
        for leaked in ("SECRET-DESCRIPTION", "SECRET-REASON", "SECRET-FIELD"):
            assert leaked not in ics
        assert "ATTENDEE" not in ics
        assert "ORGANIZER" not in ics

    async def test_excludes_drafts_cancelled_out_of_window_and_other_orgs(
        self, db_session
    ):
        org_id = await _org(db_session)
        other_org = await _org(db_session, name="Other Dept")
        admin = await _admin(db_session, org_id)
        row = await _ical(db_session, org_id)
        await _event(db_session, org_id, "Published Drill")
        await _event(db_session, org_id, "Draft Drill", is_draft=True)
        await _event(db_session, org_id, "Cancelled Drill", is_cancelled=True)
        await _event(db_session, org_id, "Old Drill", days_ahead=-60)
        await _event(db_session, org_id, "Far Drill", days_ahead=400)
        await _event(db_session, other_org, "Other Dept Drill")
        token = await _connect(db_session, row, admin)

        ics = await _fetch(db_session, token)
        assert "Published Drill" in ics
        for absent in (
            "Draft Drill",
            "Cancelled Drill",
            "Old Drill",
            "Far Drill",
            "Other Dept Drill",
        ):
            assert absent not in ics

    async def test_included_event_types_filters_the_feed(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _ical(db_session, org_id)
        await _event(db_session, org_id, "Ladder Drill", event_type="training")
        await _event(db_session, org_id, "Pancake Breakfast", event_type="fundraiser")
        token = await _connect(db_session, row, admin)
        row.config = {**row.config, "included_event_types": ["training", "bogus"]}
        await db_session.flush()

        ics = await _fetch(db_session, token)
        assert "Ladder Drill" in ics
        assert "Pancake Breakfast" not in ics

    @pytest.mark.parametrize("bad", ["", "short", "x" * 65, "a" * 64])
    async def test_bad_tokens_are_404(self, db_session, bad):
        with pytest.raises(HTTPException) as excinfo:
            await feed_ep.get_department_events_feed(bad, db=db_session)
        assert excinfo.value.status_code == 404

    async def test_rotate_invalidates_the_old_url_and_is_audited(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _ical(db_session, org_id)
        old = await _connect(db_session, row, admin)

        audit = AsyncMock()
        with patch.object(int_ep, "log_audit_event", new=audit):
            out = await int_ep.rotate_ical_feed(
                row.id, _request(), db=db_session, current_user=admin
            )
        new = out["token"]
        assert new != old
        assert audit.await_args is not None
        assert audit.await_args.args[1] == "integration.ical_feed_rotated"
        assert audit.await_args.kwargs["organization_id"] == org_id

        with pytest.raises(HTTPException) as excinfo:
            await _fetch(db_session, old)
        assert excinfo.value.status_code == 404
        assert "BEGIN:VCALENDAR" in await _fetch(db_session, new)

    async def test_rotate_is_org_scoped(self, db_session):
        org_id = await _org(db_session)
        other_org = await _org(db_session, name="Other Dept")
        admin = await _admin(db_session, org_id)
        intruder = await _admin(db_session, other_org)
        row = await _ical(db_session, org_id)
        await _connect(db_session, row, admin)

        with pytest.raises(HTTPException) as excinfo:
            await int_ep.rotate_ical_feed(
                row.id, _request(), db=db_session, current_user=intruder
            )
        assert excinfo.value.status_code == 404

    async def test_disconnect_kills_the_feed_and_reconnect_issues_a_new_url(
        self, db_session
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _ical(db_session, org_id)
        old = await _connect(db_session, row, admin)

        with patch.object(int_ep, "log_audit_event", new=AsyncMock()):
            await int_ep.disconnect_integration(
                row.id, _request(), db=db_session, current_user=admin
            )
        with pytest.raises(HTTPException):
            await _fetch(db_session, old)

        new = await _connect(db_session, row, admin)
        assert new != old
        with pytest.raises(HTTPException):
            await _fetch(db_session, old)

    async def test_flag_off_refuses_to_connect_google_calendar(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = Integration(
            organization_id=org_id,
            integration_type="google-calendar",
            name="Google Calendar",
            category="Calendar",
            status="available",
            enabled=False,
            config={},
        )
        db_session.add(row)
        await db_session.flush()

        with patch.object(int_ep.settings, "CALENDAR_SYNC_ENABLED", False):
            with pytest.raises(HTTPException) as excinfo:
                await int_ep.connect_integration(
                    row.id,
                    _request(),
                    body=IntegrationConnectRequest(),
                    db=db_session,
                    current_user=admin,
                )
        assert excinfo.value.status_code == 400
        await db_session.refresh(row)
        assert row.status == "available"
