"""Query-shape guards for LocationService.

Two invariants that are invisible in a response body and so cannot be caught
by an endpoint test:

* the (name, building) duplicate check caps its result set, because the rule
  has no unique constraint behind it and an uncapped check turns a duplicate
  pair into a 500 on every later write of that name;
* the kiosk's check-in-window query eager-loads nothing, because no caller
  reads the RSVP collection and this query runs on every 30-second kiosk poll.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.schemas.location import LocationUpdate
from app.services.location_service import LocationService


def _service():
    """A service whose db records every statement and answers 'no duplicate'."""
    db = AsyncMock()
    statements = []

    async def _execute(statement, *args, **kwargs):
        statements.append(statement)
        return MagicMock(
            scalar_one_or_none=MagicMock(return_value=None),
            scalars=MagicMock(
                return_value=MagicMock(all=MagicMock(return_value=[])),
            ),
        )

    db.execute = AsyncMock(side_effect=_execute)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.scalar = AsyncMock(return_value=None)
    # `Session.add` is synchronous; left as an AsyncMock attribute it returns an
    # un-awaited coroutine and the run reports a RuntimeWarning.
    db.add = MagicMock()
    return LocationService(db), statements


def _duplicate_check(statements):
    """The statement that looks for a same-named location."""
    for statement in statements:
        rendered = str(statement)
        if "FROM locations" in rendered and "locations.name =" in rendered:
            return rendered
    raise AssertionError(
        "no duplicate-name check was issued; statements were:\n"
        + "\n".join(str(s) for s in statements)
    )


@pytest.mark.unit
class TestTheDuplicateNameCheckIsCapped:
    """``.limit(1)`` is what keeps a duplicate pair reportable as a 400.

    Nothing in the schema enforces (name, building) uniqueness — the model
    declares a plain ``ix_locations_name``, not a unique constraint — and the
    check is a read-then-write, so two concurrent creates can both pass it.
    Uncapped, ``scalar_one_or_none()`` then raises ``MultipleResultsFound`` for
    every subsequent create or update of that name. That is not a
    ``ValueError``, so ``handle_service_errors`` renders it as a 500 with a
    generic message and the real cause reaches nobody but the logs.
    """

    async def test_the_create_path_caps_it(self):
        service, statements = _service()
        service._generate_unique_display_code = AsyncMock(return_value="ABCD1234")

        data = MagicMock()
        data.name = "Bunk Room"
        data.building = "Station 2"
        data.facility_id = None
        data.model_dump = MagicMock(return_value={"name": "Bunk Room"})

        await service.create_location(
            location_data=data, organization_id=str(uuid4()), created_by=str(uuid4())
        )

        assert "LIMIT" in _duplicate_check(statements)

    async def test_the_update_path_caps_it(self):
        service, statements = _service()
        location = MagicMock()
        location.id = str(uuid4())
        location.name = "Bunk Room"
        location.building = "Station 1"
        location.facility_room_id = None
        service.get_location = AsyncMock(return_value=location)

        await service.update_location(
            location_id=uuid4(),
            location_data=LocationUpdate(building="Station 2"),
            organization_id=str(uuid4()),
        )

        assert "LIMIT" in _duplicate_check(statements)


@pytest.mark.unit
class TestTheCheckInWindowQueryEagerLoadsNothing:
    async def test_it_carries_no_loader_options(self):
        """The kiosk polls this every 30 seconds; it must not drag RSVPs along.

        A ``selectinload(Event.rsvps)`` sat here and no caller read the
        collection: both display endpoints project scalar columns only, and
        ``NfcTagService._only_event_checked_into`` issues its own query
        narrowed to one member's open check-ins. A drill with 150 RSVPs was
        therefore loading 150 unread rows per poll, per open event, behind a
        public endpoint.
        """
        service, statements = _service()

        await service.get_current_events_in_check_in_window(
            location_id=uuid4(), organization_id=str(uuid4())
        )

        assert statements, "no query was issued"
        options = [opt for s in statements for opt in s._with_options]
        assert options == [], "the check-in-window query eager-loads " + ", ".join(
            str(getattr(opt, "path", opt)) for opt in options
        )
