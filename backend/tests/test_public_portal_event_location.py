"""A public event placed at a facility publishes the facility's name.

Events pick their place from the department's locations (``location_id``);
the free-text ``location`` column is the "Other" fallback. ``/events/public``
read only the free text, so an open house scheduled at Station 1 through the
picker went out to the department's website with no location at all (W76).
The department calendar feed already resolved the facility's name; the portal
now does the same.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.public import portal
from app.models.event import Event, EventType
from app.models.location import Location
from app.models.public_portal import (
    PublicPortalAPIKey,
    PublicPortalConfig,
    PublicPortalDataWhitelist,
)
from tests.fake_request import fake_request

pytestmark = [pytest.mark.integration]


async def _portal(db: AsyncSession, org_id: str) -> None:
    config = PublicPortalConfig(
        organization_id=org_id,
        enabled=True,
        allowed_origins=[],
        default_rate_limit=1000,
        cache_ttl_seconds=300,
        settings={},
    )
    db.add(config)
    await db.flush()
    for field in ("id", "title", "location"):
        db.add(
            PublicPortalDataWhitelist(
                organization_id=org_id,
                config_id=str(config.id),
                data_category="events",
                field_name=field,
                is_enabled=True,
            )
        )
    await db.flush()


def _event(org_id: str, admin_id: str, title: str, **place) -> Event:
    start = datetime.now(timezone.utc) + timedelta(days=3)
    return Event(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        title=title,
        event_type=EventType.PUBLIC_EDUCATION,
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        created_by=admin_id,
        **place,
    )


async def _published(db: AsyncSession, org_id: str) -> dict[str, str | None]:
    with (
        patch.object(portal, "check_portal_enabled", new=AsyncMock()),
        patch.object(portal, "log_public_api_request", new=AsyncMock()),
    ):
        events = await portal.get_public_events(
            request=fake_request(),
            api_key=PublicPortalAPIKey(organization_id=org_id),
            db=db,
            limit=10,
            offset=0,
        )
    return {e.title or "": e.location for e in events}


class TestThePublishedLocation:
    async def test_a_facility_event_publishes_the_facility_name(
        self, db_session: AsyncSession, setup_org_and_admin
    ) -> None:
        org_id, admin_id = setup_org_and_admin
        await _portal(db_session, org_id)
        station = Location(organization_id=org_id, name="Station 1")
        db_session.add(station)
        await db_session.flush()
        db_session.add_all(
            [
                _event(org_id, admin_id, "Open house", location_id=str(station.id)),
                _event(org_id, admin_id, "Park safety day", location="City Park"),
            ]
        )
        await db_session.flush()
        db_session.expunge_all()

        published = await _published(db_session, org_id)

        assert published == {
            "Open house": "Station 1",
            "Park safety day": "City Park",
        }
