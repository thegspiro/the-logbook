"""FAC2-10: ``list_rooms(floor=0)`` returned every floor.

The filter was ``if floor:``, so a ground floor numbered 0 read as "no filter".
The floor field accepts 0 and negatives (basements), so 0 is a real floor.
"""

import uuid

import pytest

from app.models.facilities import Facility, FacilityRoom, FacilityStatus, FacilityType
from app.models.user import Organization
from app.services.facilities_service import FacilitiesService

pytestmark = pytest.mark.integration


async def test_floor_zero_filters_to_the_ground_floor(db_session):
    org = Organization(name="Floors", slug=f"floors-{uuid.uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    kind = FacilityType(id=str(uuid.uuid4()), organization_id=org.id, name="Station")
    status = FacilityStatus(
        id=str(uuid.uuid4()), organization_id=org.id, name="In service"
    )
    db_session.add_all([kind, status])
    await db_session.flush()
    fac = Facility(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Station 1",
        facility_type_id=kind.id,
        status_id=status.id,
    )
    db_session.add(fac)
    await db_session.flush()
    for name, floor in (("Apparatus bay", 0), ("Bunk room", 1), ("Basement", -1)):
        db_session.add(
            FacilityRoom(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                facility_id=fac.id,
                name=name,
                floor=floor,
            )
        )
    await db_session.flush()
    service = FacilitiesService(db_session)

    ground = await service.list_rooms(org.id, facility_id=fac.id, floor=0)
    basement = await service.list_rooms(org.id, facility_id=fac.id, floor=-1)

    assert [room.name for room in ground] == ["Apparatus bay"]
    assert [room.name for room in basement] == ["Basement"]
