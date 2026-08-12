"""Tenant-isolation tests for the optional Location → Facility bridge."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.schemas.location import LocationCreate, LocationUpdate
from app.services.location_service import LocationService


@pytest.fixture
def service():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return LocationService(db)


async def test_create_validates_facility_in_callers_org(service):
    facility_id = uuid4()
    organization_id = str(uuid4())

    with patch(
        "app.services.location_service.assert_in_org",
        side_effect=ValueError("Invalid facility"),
    ) as validate:
        with pytest.raises(ValueError, match="Invalid facility"):
            await service.create_location(
                LocationCreate(name="Foreign station", facility_id=facility_id),
                organization_id,
                str(uuid4()),
            )

    validate.assert_awaited_once()
    assert validate.await_args.args[2] == facility_id
    assert validate.await_args.args[3] == organization_id
    service.db.add.assert_not_called()


async def test_update_allows_safe_facility_reassignment(service):
    facility_id = uuid4()
    organization_id = str(uuid4())
    location = MagicMock()
    location.name = "Station"
    service.get_location = AsyncMock(return_value=location)

    with patch(
        "app.services.location_service.assert_in_org", new_callable=AsyncMock
    ) as validate:
        await service.update_location(
            uuid4(), LocationUpdate(facility_id=facility_id), organization_id
        )

    validate.assert_awaited_once()
    assert validate.await_args.args[2] == facility_id
    assert location.facility_id == facility_id


async def test_update_can_clear_facility_link(service):
    organization_id = str(uuid4())
    location = MagicMock()
    location.name = "Station"
    service.get_location = AsyncMock(return_value=location)

    with patch(
        "app.services.location_service.assert_in_org", new_callable=AsyncMock
    ) as validate:
        await service.update_location(
            uuid4(), LocationUpdate(facility_id=None), organization_id
        )

    assert validate.await_args.kwargs["allow_none"] is True
    assert location.facility_id is None
