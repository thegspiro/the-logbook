"""The apparatus FK org-scoping, proved against a real database.

App-review passes 2, 3 and 4 all closed the XC-1 create/update FK class on this
module and all three recorded the same gap: the wiring rested on
``assert_in_org``'s own unit tests plus mocked-session tests, so nothing
exercised it through real SQL. A mocked session cannot tell a working
``WHERE organization_id = :org`` from a missing one — it returns whatever the
stub was handed. These tests close that, and they are the reason the gap is no
longer listed as open.

Each cross-org case is paired with a same-org case on the same field. Without
the positive half a guard that rejected *everything* would pass this file, which
is the failure mode a scoping test is most likely to have.
"""

import uuid

import pytest

from app.models.apparatus import (
    Apparatus,
    ApparatusComponent,
    ApparatusMaintenanceType,
    ApparatusServiceProvider,
    ApparatusStatus,
    ApparatusType,
    EvocLevel,
)
from app.models.user import Organization, User
from app.schemas.apparatus import (
    ApparatusCreate,
    ApparatusMaintenanceCreate,
    ApparatusUpdate,
)
from app.services.apparatus_service import ApparatusService

pytestmark = [pytest.mark.integration]


async def _org(db_session, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"{name.lower()}-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _actor(db_session, org: Organization) -> str:
    """A real user row: `create_apparatus` stamps `status_changed_by`, which
    carries a foreign key to `users.id`, so a bare uuid fails at flush."""
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"actor-{suffix}",
        email=f"actor-{suffix}@example.org",
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _maintenance_type(
    db_session, org: Organization, name: str = "Annual"
) -> ApparatusMaintenanceType:
    return ApparatusMaintenanceType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        code=f"MT{uuid.uuid4().hex[:4]}",
    )


async def _type_and_status(db_session, org: Organization):
    apparatus_type = ApparatusType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Engine",
        code=f"ENG{uuid.uuid4().hex[:4]}",
    )
    status = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="In Service",
        code=f"IS{uuid.uuid4().hex[:4]}",
    )
    db_session.add_all([apparatus_type, status])
    await db_session.flush()
    return apparatus_type, status


async def _evoc_level(
    db_session, org: Organization, level_number: int = 2
) -> EvocLevel:
    level = EvocLevel(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        level_number=level_number,
        name=f"EVOC {level_number}",
        code=f"EV{uuid.uuid4().hex[:4]}",
    )
    db_session.add(level)
    await db_session.flush()
    return level


async def _apparatus(db_session, org: Organization) -> Apparatus:
    apparatus_type, status = await _type_and_status(db_session, org)
    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number=f"E-{uuid.uuid4().hex[:5]}",
        apparatus_type_id=apparatus_type.id,
        status_id=status.id,
    )
    db_session.add(apparatus)
    await db_session.flush()
    return apparatus


class TestCreateApparatusEvocFkIsOrgScoped:
    async def test_foreign_evoc_level_is_refused(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        apparatus_type, status = await _type_and_status(db_session, mine)
        foreign_level = await _evoc_level(db_session, theirs)

        with pytest.raises(ValueError, match="Invalid EVOC level"):
            await ApparatusService(db_session).create_apparatus(
                ApparatusCreate(
                    unit_number=f"E-{uuid.uuid4().hex[:5]}",
                    apparatus_type_id=apparatus_type.id,
                    status_id=status.id,
                    required_evoc_level_id=foreign_level.id,
                ),
                mine.id,
                created_by=await _actor(db_session, mine),
            )

    async def test_own_evoc_level_is_accepted(self, db_session):
        mine = await _org(db_session, "Mine")
        apparatus_type, status = await _type_and_status(db_session, mine)
        own_level = await _evoc_level(db_session, mine)

        created = await ApparatusService(db_session).create_apparatus(
            ApparatusCreate(
                unit_number=f"E-{uuid.uuid4().hex[:5]}",
                apparatus_type_id=apparatus_type.id,
                status_id=status.id,
                required_evoc_level_id=own_level.id,
            ),
            mine.id,
            created_by=await _actor(db_session, mine),
        )
        assert created.required_evoc_level_id == own_level.id


class TestUpdateApparatusEvocFkIsOrgScoped:
    async def test_foreign_evoc_level_is_refused_on_update(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        apparatus = await _apparatus(db_session, mine)
        foreign_level = await _evoc_level(db_session, theirs)

        with pytest.raises(ValueError, match="Invalid EVOC level"):
            await ApparatusService(db_session).update_apparatus(
                apparatus.id,
                ApparatusUpdate(required_evoc_level_id=foreign_level.id),
                mine.id,
                updated_by=await _actor(db_session, mine),
            )


class TestMaintenanceRecordFksAreOrgScoped:
    """``component_id`` / ``service_provider_id`` — the AP2-2 integrity FKs."""

    async def test_foreign_component_is_refused(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        apparatus = await _apparatus(db_session, mine)
        their_apparatus = await _apparatus(db_session, theirs)

        maint_type = await _maintenance_type(db_session, mine)
        foreign_component = ApparatusComponent(
            id=str(uuid.uuid4()),
            organization_id=theirs.id,
            apparatus_id=their_apparatus.id,
            name="Pump",
        )
        db_session.add_all([maint_type, foreign_component])
        await db_session.flush()

        with pytest.raises(ValueError, match="Invalid component"):
            await ApparatusService(db_session).create_maintenance_record(
                ApparatusMaintenanceCreate(
                    apparatus_id=apparatus.id,
                    maintenance_type_id=maint_type.id,
                    component_id=foreign_component.id,
                ),
                mine.id,
                created_by=await _actor(db_session, mine),
            )

    async def test_foreign_service_provider_is_refused(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        apparatus = await _apparatus(db_session, mine)

        maint_type = await _maintenance_type(db_session, mine)
        foreign_provider = ApparatusServiceProvider(
            id=str(uuid.uuid4()), organization_id=theirs.id, name="Their Garage"
        )
        db_session.add_all([maint_type, foreign_provider])
        await db_session.flush()

        with pytest.raises(ValueError, match="Invalid service provider"):
            await ApparatusService(db_session).create_maintenance_record(
                ApparatusMaintenanceCreate(
                    apparatus_id=apparatus.id,
                    maintenance_type_id=maint_type.id,
                    service_provider_id=foreign_provider.id,
                ),
                mine.id,
                created_by=await _actor(db_session, mine),
            )

    async def test_own_component_and_provider_are_accepted(self, db_session):
        mine = await _org(db_session, "Mine")
        apparatus = await _apparatus(db_session, mine)

        maint_type = await _maintenance_type(db_session, mine)
        component = ApparatusComponent(
            id=str(uuid.uuid4()),
            organization_id=mine.id,
            apparatus_id=apparatus.id,
            name="Pump",
        )
        provider = ApparatusServiceProvider(
            id=str(uuid.uuid4()), organization_id=mine.id, name="Our Garage"
        )
        db_session.add_all([maint_type, component, provider])
        await db_session.flush()

        record = await ApparatusService(db_session).create_maintenance_record(
            ApparatusMaintenanceCreate(
                apparatus_id=apparatus.id,
                maintenance_type_id=maint_type.id,
                component_id=component.id,
                service_provider_id=provider.id,
            ),
            mine.id,
            created_by=await _actor(db_session, mine),
        )
        assert record.component_id == component.id
        assert record.service_provider_id == provider.id


class TestApparatusLookupIsOrgScoped:
    """A by-id read must not cross tenants (XC-3), proved through real SQL."""

    async def test_other_orgs_apparatus_is_not_visible(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        their_apparatus = await _apparatus(db_session, theirs)

        found = await ApparatusService(db_session).get_apparatus(
            their_apparatus.id, mine.id, include_relations=False
        )
        assert found is None

        own = await _apparatus(db_session, mine)
        assert (
            await ApparatusService(db_session).get_apparatus(
                own.id, mine.id, include_relations=False
            )
        ) is not None
