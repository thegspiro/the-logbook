"""
EV2-2 (app-review B17 pass 4): two client-supplied location FKs in the events
module were persisted without an in-org check.

1. `schedule_request` stored `event_location_id` from the request body, and the
   response enrichment (`_get_location_name`) resolved it with no org filter — so a
   foreign location_id's name leaked into `event_location_name` (a cross-org
   read-leak). The enrichment is now org-scoped, and the write path validates the
   location in-org.
2. `create_template` / `update_template` stored `default_location_id` unvalidated
   (a dangling reference — not projected today). Both paths now validate it in-org,
   mirroring the EV-8 create_event check.

DB-free.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.event_requests import _get_location_name
from app.services.event_service import EventService


class TestTemplateLocationScoping:
    async def test_create_rejects_foreign_default_location(self):
        svc = EventService(AsyncMock())
        with patch("app.services.event_service.LocationService") as MockLoc:
            MockLoc.return_value.get_location = AsyncMock(return_value=None)  # foreign
            with pytest.raises(ValueError, match="Location not found"):
                await svc.create_template(
                    {"name": "Open House", "default_location_id": str(uuid4())},
                    str(uuid4()),
                    str(uuid4()),
                )

    async def test_create_without_location_skips_validation(self):
        db = AsyncMock()
        db.add = MagicMock()
        svc = EventService(db)
        with patch("app.services.event_service.LocationService") as MockLoc:
            await svc.create_template(
                {"name": "Open House"}, str(uuid4()), str(uuid4())
            )
            MockLoc.return_value.get_location.assert_not_called()

    async def test_update_rejects_foreign_default_location(self):
        svc = EventService(AsyncMock())
        template = MagicMock()
        with patch.object(
            svc, "get_template", new_callable=AsyncMock, return_value=template
        ), patch("app.services.event_service.LocationService") as MockLoc:
            MockLoc.return_value.get_location = AsyncMock(return_value=None)
            with pytest.raises(ValueError, match="Location not found"):
                await svc.update_template(
                    uuid4(), str(uuid4()), {"default_location_id": str(uuid4())}
                )

    async def test_update_without_location_key_skips_validation(self):
        db = AsyncMock()
        svc = EventService(db)
        template = MagicMock()
        with patch.object(
            svc, "get_template", new_callable=AsyncMock, return_value=template
        ), patch("app.services.event_service.LocationService") as MockLoc:
            await svc.update_template(uuid4(), str(uuid4()), {"name": "Renamed"})
            MockLoc.return_value.get_location.assert_not_called()


class TestLocationNameEnrichmentOrgScoped:
    async def test_requires_org_and_returns_none_for_no_match(self):
        # The enrichment now takes organization_id and filters on it; a location
        # not in the caller's org yields no row -> None (no name leak).
        db = AsyncMock()
        result = MagicMock()
        result.first.return_value = None
        db.execute = AsyncMock(return_value=result)
        assert await _get_location_name(db, str(uuid4()), str(uuid4())) is None

    async def test_in_org_match_returns_name(self):
        db = AsyncMock()
        result = MagicMock()
        result.first.return_value = ("Station 1",)
        db.execute = AsyncMock(return_value=result)
        assert await _get_location_name(db, str(uuid4()), str(uuid4())) == "Station 1"
