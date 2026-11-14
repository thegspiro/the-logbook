"""LOC-41: a location's name is unique within its building, in the database.

The service has refused a second "Bunk Room" in the same building for a long
time, but as a read-then-write with nothing behind it, so two creates arriving
together could both pass. ``uq_locations_org_name_building`` now holds the
rule, over ``building_key`` (``COALESCE(building, '')``) so that locations with
no building collide too, as the service check treats them.

Proved against a real database because the guarantee *is* the constraint.
"""

import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.facilities import Facility, FacilityStatus, FacilityType
from app.models.location import Location
from app.models.user import Organization, User
from app.schemas.facilities import FacilityRoomCreate
from app.schemas.location import LocationCreate, LocationUpdate
from app.services.facilities_service import FacilitiesService
from app.services.location_service import LocationService

pytestmark = [pytest.mark.integration]


def _id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org(db_session) -> Organization:
    organization = Organization(
        id=_id(), name="Unique Names", slug=f"unique-names-{uuid.uuid4().hex[:8]}"
    )
    db_session.add(organization)
    await db_session.flush()
    return organization


@pytest.fixture
async def actor(db_session, org) -> str:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=_id(),
        organization_id=org.id,
        username=f"actor-{suffix}",
        email=f"actor-{suffix}@example.org",
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


@pytest.fixture
def rival():
    """Commit a location from another connection, as a concurrent request would.

    Requested *before* ``db_session`` in a test's arguments, so its teardown
    runs after the session's rollback has released the locks it holds.
    """
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    org_id = _id()
    created = {"org": False}

    def commit(name: str, building: str | None) -> str:
        with engine.begin() as conn:
            if not created["org"]:
                conn.execute(
                    sa.text(
                        "INSERT INTO organizations (id, name, organization_type, "
                        "slug, timezone) VALUES (:id, 'Rival FD', "
                        "'fire_department', :slug, 'UTC')"
                    ),
                    {"id": org_id, "slug": f"rival-{org_id[:8]}"},
                )
                created["org"] = True
            conn.execute(
                sa.text(
                    "INSERT INTO locations (id, organization_id, name, building) "
                    "VALUES (:id, :org, :name, :building)"
                ),
                {"id": _id(), "org": org_id, "name": name, "building": building},
            )
        return org_id

    yield commit
    with engine.begin() as conn:
        conn.execute(
            sa.text("DELETE FROM locations WHERE organization_id = :org"),
            {"org": org_id},
        )
        conn.execute(
            sa.text("DELETE FROM organizations WHERE id = :org"), {"org": org_id}
        )
    engine.dispose()


async def _take_snapshot(db_session) -> None:
    """Open the session's read view, so a row committed after it is unseen.

    Under REPEATABLE READ the service's duplicate check then reads the
    snapshot and misses the rival's row, exactly as the second of two
    simultaneous requests does; only the unique index sees it.
    """
    await db_session.execute(select(Location.id).limit(1))


class TestTheDatabaseHoldsTheRule:
    @pytest.mark.parametrize(
        ("first", "second"),
        [("HQ", "HQ"), (None, None), (None, "")],
        ids=["same-building", "no-building", "null-and-empty"],
    )
    async def test_a_second_location_of_that_name_is_refused(
        self, db_session, org, first, second
    ):
        db_session.add(
            Location(id=_id(), organization_id=org.id, name="Bunk Room", building=first)
        )
        await db_session.flush()
        db_session.add(
            Location(
                id=_id(), organization_id=org.id, name="Bunk Room", building=second
            )
        )

        with pytest.raises(IntegrityError):
            await db_session.flush()

    async def test_the_same_name_in_another_building_is_allowed(self, db_session, org):
        db_session.add_all(
            [
                Location(
                    id=_id(), organization_id=org.id, name="Bunk Room", building="1"
                ),
                Location(
                    id=_id(), organization_id=org.id, name="Bunk Room", building="2"
                ),
            ]
        )

        await db_session.flush()


class TestTheServiceReportsTheConstraintAsItsOwnError:
    async def test_a_create_that_races_the_check_gets_the_friendly_error(
        self, rival, db_session
    ):
        await _take_snapshot(db_session)
        org_id = rival("Bunk Room", "HQ")

        with pytest.raises(ValueError, match="Location with name 'Bunk Room'"):
            await LocationService(db_session).create_location(
                LocationCreate(name="Bunk Room", building="HQ"), org_id, None
            )

    async def test_an_update_that_races_the_check_gets_the_friendly_error(
        self, rival, db_session
    ):
        await _take_snapshot(db_session)
        org_id = rival("Day Room", "HQ")
        service = LocationService(db_session)
        mine = await service.create_location(
            LocationCreate(name="Kitchen", building="HQ"), org_id, None
        )
        mine_id = mine.id
        rival("Bunk Room", "HQ")

        with pytest.raises(ValueError, match="Location with name 'Bunk Room'"):
            await service.update_location(
                uuid.UUID(mine_id), LocationUpdate(name="Bunk Room"), org_id
            )

    async def test_the_check_treats_an_empty_building_as_none(
        self, db_session, org, actor
    ):
        service = LocationService(db_session)
        await service.create_location(LocationCreate(name="Bunk Room"), org.id, actor)

        with pytest.raises(ValueError, match="already exists"):
            await service.create_location(
                LocationCreate(name="Bunk Room", building=""), org.id, actor
            )


class TestRoomLocationsAreNamedApart:
    async def test_two_rooms_of_one_name_get_distinct_locations(
        self, db_session, org, actor
    ):
        facility_type = FacilityType(id=_id(), organization_id=org.id, name="Station")
        facility_status = FacilityStatus(
            id=_id(), organization_id=org.id, name="Operational"
        )
        db_session.add_all([facility_type, facility_status])
        await db_session.flush()
        facility = Facility(
            id=_id(),
            organization_id=org.id,
            name="Station 1",
            facility_type_id=facility_type.id,
            status_id=facility_status.id,
        )
        db_session.add(facility)
        await db_session.flush()
        service = FacilitiesService(db_session)

        first = await service.create_room(
            FacilityRoomCreate(facility_id=facility.id, name="Storage"), org.id, actor
        )
        second = await service.create_room(
            FacilityRoomCreate(facility_id=facility.id, name="Storage"), org.id, actor
        )
        first_id, second_id = first.id, second.id
        # Saving the first room again must not take back the plain name it
        # already has, nor collide with the second.
        await service._sync_room_location(first, facility, org.id)
        await db_session.flush()

        names = {
            room_id: await db_session.scalar(
                select(Location.name).where(Location.facility_room_id == room_id)
            )
            for room_id in (first_id, second_id)
        }
        assert names == {
            first_id: "Storage — Station 1",
            second_id: "Storage — Station 1 (2)",
        }


@pytest.fixture
def station():
    """A department and station committed from another connection.

    The system-named saves below race a location that this fixture commits
    after the session under test has opened its read view, so their name
    lookup misses it and only the unique key sees it. Requested before
    ``db_session`` so its teardown runs after the session has rolled back.
    """
    from sqlalchemy.orm import Session

    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    org_id = _id()
    ids = {"org": org_id}
    with Session(engine) as session, session.begin():
        session.add(Organization(id=org_id, name="Race FD", slug=f"race-{org_id[:8]}"))
        session.flush()
        facility_type = FacilityType(id=_id(), organization_id=org_id, name="Station")
        facility_status = FacilityStatus(
            id=_id(), organization_id=org_id, name="Operational"
        )
        session.add_all([facility_type, facility_status])
        session.flush()
        facility = Facility(
            id=_id(),
            organization_id=org_id,
            name="Station 1",
            facility_type_id=facility_type.id,
            status_id=facility_status.id,
        )
        session.add(facility)
        ids.update(
            type=facility_type.id, status=facility_status.id, facility=facility.id
        )

    def commit_location(name: str, building: str | None) -> None:
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO locations (id, organization_id, name, building) "
                    "VALUES (:id, :org, :name, :building)"
                ),
                {"id": _id(), "org": org_id, "name": name, "building": building},
            )

    yield ids, commit_location
    with engine.begin() as conn:
        for statement in (
            "DELETE FROM locations WHERE organization_id = :org",
            "DELETE FROM facilities WHERE organization_id = :org",
            "DELETE FROM facility_statuses WHERE organization_id = :org",
            "DELETE FROM facility_types WHERE organization_id = :org",
            "DELETE FROM organizations WHERE id = :org",
        ):
            conn.execute(sa.text(statement), {"org": org_id})
    engine.dispose()


class TestSystemNamedLocationsSurviveALostRace:
    """A room's or a station's location is named by the system, so losing the
    race for its name is retried with the next number, never a 500."""

    async def test_a_room_whose_name_is_taken_mid_save_is_numbered(
        self, station, db_session
    ):
        ids, commit_location = station
        await _take_snapshot(db_session)
        commit_location("Storage — Station 1", "Station 1")

        room = await FacilitiesService(db_session).create_room(
            FacilityRoomCreate(facility_id=ids["facility"], name="Storage"),
            ids["org"],
            None,
        )

        name = await db_session.scalar(
            select(Location.name).where(Location.facility_room_id == room.id)
        )
        assert name == "Storage — Station 1 (2)"

    async def test_a_station_whose_name_is_taken_mid_save_is_numbered(
        self, station, db_session
    ):
        from app.services.onboarding import OnboardingService

        ids, commit_location = station
        await _take_snapshot(db_session)
        org = await db_session.get(Organization, ids["org"])
        commit_location("Station 1", None)

        facility = await OnboardingService(db_session)._create_facility_with_location(
            org=org,
            name="Station 1",
            facility_number=None,
            facility_type_id=ids["type"],
            status_id=ids["status"],
            address_line1=None,
            city=None,
            state=None,
            zip_code=None,
        )

        name = await db_session.scalar(
            select(Location.name).where(Location.facility_id == facility.id)
        )
        assert name == "Station 1 (2)"
