"""Calendar publishing: the range and event types an administrator sets.

Owner decision 2026-11-01: the Google Calendar and Outlook cards set how far
ahead a pass publishes (``days_ahead``) and which event types it publishes
(``event_types_to_sync``). The pass (``calendar_sync_service._load_desired``)
is the reader; these tests prove the values the card saves are the values it
reads, that a value it could not read is refused, and that a row with neither
setting publishes what it always did.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_stepup
from app.api.v1.endpoints import integrations as endpoints
from app.core.database import get_db
from app.models.event import Event, EventType
from app.models.integration import Integration
from app.models.user import Organization, User
from app.schemas.integration import CALENDAR_PUBLISH_EVENT_TYPES
from app.services import calendar_sync_service as svc

CALENDAR_TYPES = ["google-calendar", "outlook"]


def _row(itype: str = "google-calendar", **config) -> Integration:
    return Integration(
        id=str(uuid.uuid4()),
        organization_id="org-1",
        integration_type=itype,
        name=itype,
        category="Calendar",
        status="connected",
        enabled=True,
        config={"calendar_id": "cal-1", **config},
    )


@pytest.mark.unit
class TestValidation:
    @pytest.mark.parametrize("itype", CALENDAR_TYPES)
    def test_an_unknown_event_type_is_refused(self, itype):
        with pytest.raises(HTTPException) as excinfo:
            endpoints._validate_config(
                itype, {"event_types_to_sync": ["training", "drill_night"]}
            )
        assert excinfo.value.status_code == 422
        assert "drill_night" in excinfo.value.detail

    @pytest.mark.parametrize("itype", CALENDAR_TYPES)
    def test_known_event_types_are_kept_once(self, itype):
        out = endpoints._validate_config(
            itype, {"event_types_to_sync": ["training", "social", "training"]}
        )
        assert out == {"event_types_to_sync": ["training", "social"]}

    @pytest.mark.parametrize("itype", CALENDAR_TYPES)
    @pytest.mark.parametrize("days", [0, -5, 731])
    def test_a_range_outside_the_bounds_is_refused(self, itype, days):
        with pytest.raises(HTTPException) as excinfo:
            endpoints._validate_config(itype, {"days_ahead": days})
        assert excinfo.value.status_code == 422

    @pytest.mark.parametrize("days", [1, 730])
    def test_the_bounds_are_the_readers_bounds(self, days):
        out = endpoints._validate_config("outlook", {"days_ahead": days})
        assert svc._days_ahead(out) == days
        assert svc.MAX_DAYS_AHEAD == 730

    def test_every_type_the_card_offers_is_one_the_pass_matches(self):
        assert CALENDAR_PUBLISH_EVENT_TYPES == {t.value for t in EventType}
        out = endpoints._validate_config(
            "google-calendar",
            {"event_types_to_sync": sorted(CALENDAR_PUBLISH_EVENT_TYPES)},
        )
        assert svc._type_filter(out) == CALENDAR_PUBLISH_EVENT_TYPES


@pytest.mark.unit
class TestStoredValues:
    def test_absence_publishes_what_it_always_did(self):
        # No setting: 180 days ahead, every type.
        assert svc._days_ahead({}) == svc.DEFAULT_DAYS_AHEAD == 180
        assert svc._type_filter({}) is None
        assert svc._type_filter({"event_types_to_sync": []}) is None

    def test_a_stored_unknown_type_does_not_block_a_later_change(self):
        row = _row(event_types_to_sync=["drill_night"])
        stored = endpoints._stored_config_for_validation(row)
        assert "event_types_to_sync" not in stored
        merged = {**stored, "sync_descriptions": True}
        assert endpoints._validate_config("google-calendar", merged) == {
            "sync_descriptions": True
        }

    def test_a_stored_known_filter_is_still_validated_and_kept(self):
        row = _row(event_types_to_sync=["training"], days_ahead=90)
        stored = endpoints._stored_config_for_validation(row)
        assert stored["event_types_to_sync"] == ["training"]
        assert stored["days_ahead"] == 90


# ---------------------------------------------------------------------------
# Saved through the API, read by the pass
# ---------------------------------------------------------------------------


@pytest.fixture
async def admin(db_session: AsyncSession) -> User:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Publish Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"publish-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pub', 'Admin', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"pub-{user_id[:8]}",
            "em": f"pub-{user_id[:8]}@test.example",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'IT Manager', 'it_manager', "
            "'[\"integrations.manage\"]')"
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    member = await db_session.get(User, user_id)
    assert member is not None
    await db_session.refresh(member, ["positions"])
    return member


def _client(db_session: AsyncSession, member: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(endpoints.router, prefix="/integrations")
    app.dependency_overrides[get_current_user] = lambda: member
    app.dependency_overrides[require_stepup] = lambda: member
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def _event(db, org_id: str, event_type: EventType, days: int) -> Event:
    start = datetime.now(timezone.utc) + timedelta(days=days)
    row = Event(
        organization_id=org_id,
        title=f"{event_type.value} in {days} days",
        event_type=event_type,
        start_datetime=start.replace(tzinfo=None),
        end_datetime=(start + timedelta(hours=2)).replace(tzinfo=None),
        is_draft=False,
        is_cancelled=False,
    )
    db.add(row)
    await db.flush()
    return row


@pytest.mark.integration
class TestSavedSettingsReachThePass:
    async def test_range_and_types_saved_on_the_card_are_what_is_published(
        self, db_session: AsyncSession, admin: User
    ):
        org_id = str(admin.organization_id)
        row = Integration(
            organization_id=org_id,
            integration_type="google-calendar",
            name="Google Calendar",
            category="Calendar",
            status="connected",
            enabled=True,
            config={"calendar_id": "cal-1", "account_email": "c@dept.org"},
        )
        row.set_secret("refresh_token", "refresh-1")
        db_session.add(row)
        near_training = await _event(db_session, org_id, EventType.TRAINING, 5)
        far_training = await _event(db_session, org_id, EventType.TRAINING, 300)
        near_social = await _event(db_session, org_id, EventType.SOCIAL, 5)
        await db_session.flush()
        organization = await db_session.get(Organization, org_id)
        assert organization is not None

        # Before anything is set: 180 days ahead, every type.
        desired, _ = await svc._load_desired(
            db_session, row, organization, datetime.now(timezone.utc)
        )
        assert set(desired) == {near_training.id, near_social.id}

        with patch.object(endpoints.settings, "CALENDAR_SYNC_ENABLED", True):
            async with _client(db_session, admin) as client:
                refused = await client.patch(
                    f"/integrations/{row.id}",
                    json={"config": {"event_types_to_sync": ["drill_night"]}},
                )
                saved = await client.patch(
                    f"/integrations/{row.id}",
                    json={
                        "config": {
                            "days_ahead": 365,
                            "event_types_to_sync": ["training"],
                        }
                    },
                )
        assert refused.status_code == 422
        assert saved.status_code == 200, saved.text
        assert saved.json()["config"]["days_ahead"] == 365
        assert saved.json()["config"]["event_types_to_sync"] == ["training"]

        await db_session.refresh(row)
        desired, _ = await svc._load_desired(
            db_session, row, organization, datetime.now(timezone.utc)
        )
        assert set(desired) == {near_training.id, far_training.id}
