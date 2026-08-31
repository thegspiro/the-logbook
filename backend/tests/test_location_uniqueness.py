"""
Tests for LocationService.update_location's (name, building) uniqueness scope
and LocationUpdate's rejection of null for non-nullable columns.

The duplicate check must fire whenever either half of that scope changes —
not only when name changes — or a PATCH that moves a location into a
building that already has a same-named one goes undetected. Separately,
``name`` and ``is_active`` back NOT NULL columns, so an explicit
``null`` for either must 422 at the schema boundary rather than reach the
database and 500.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.location import LocationUpdate
from app.services.location_service import LocationService


def _service_with(location, dup_result):
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=dup_result))
    )
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    service = LocationService(db)
    service.get_location = AsyncMock(return_value=location)
    return service, db


def _location(name="Bunk Room", building="Station 2"):
    location = MagicMock()
    location.id = str(uuid4())
    location.name = name
    location.building = building
    location.facility_room_id = None
    return location


async def test_building_only_change_is_checked_for_duplicates():
    """A same-named location already in the target building is rejected.

    Before the fix, the dup-check only ran when ``name`` was supplied and
    different — a PATCH changing only ``building`` skipped it entirely, so
    two same-named locations valid in separate buildings could be merged
    into one building undetected.
    """
    location = _location(name="Bunk Room", building="Station 2")
    duplicate = MagicMock()  # a "Bunk Room" already exists at Station 1
    service, db = _service_with(location, duplicate)

    with pytest.raises(ValueError, match="already exists"):
        await service.update_location(
            uuid4(), LocationUpdate(building="Station 1"), "org-1"
        )

    db.commit.assert_not_awaited()


async def test_building_only_change_with_no_conflict_succeeds():
    location = _location(name="Bunk Room", building="Station 2")
    service, db = _service_with(location, None)

    result = await service.update_location(
        uuid4(), LocationUpdate(building="Station 1"), "org-1"
    )

    assert result is location
    assert location.building == "Station 1"
    db.commit.assert_awaited_once()


async def test_unrelated_field_change_skips_the_duplicate_query():
    """Changing neither name nor building must not pay for a dup check."""
    location = _location(name="Bunk Room", building="Station 2")
    service, db = _service_with(location, MagicMock())

    result = await service.update_location(
        uuid4(), LocationUpdate(capacity=10), "org-1"
    )

    assert result is location
    assert location.capacity == 10
    db.execute.assert_not_called()
    db.commit.assert_awaited_once()


class TestLocationUpdateRejectsNullForNonNullableFields:
    def test_explicit_null_name_is_rejected(self):
        with pytest.raises(ValidationError, match="name"):
            LocationUpdate(name=None)

    def test_explicit_null_is_active_is_rejected(self):
        with pytest.raises(ValidationError, match="is_active"):
            LocationUpdate(is_active=None)

    def test_omitting_name_is_fine(self):
        # Omission (not sent at all) must stay legal — that's how a PATCH
        # leaves the field alone.
        payload = LocationUpdate(building="Station 1")
        assert "name" not in payload.model_fields_set

    def test_a_real_value_is_fine(self):
        payload = LocationUpdate(name="Bunk Room", is_active=False)
        assert payload.name == "Bunk Room"
        assert payload.is_active is False
