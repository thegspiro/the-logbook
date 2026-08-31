"""Lookup rows carry a per-organization usage count.

The facility settings screen shows a Usage column and disables Delete on a
non-zero count. No list endpoint returned the figure, so every row read 0: the
guard never fired and the button was offered for lookups the server then
refused with a 400.

The count is scoped to the caller's organization, matching the delete check.
These tables hold system rows shared by every department (organization_id
NULL), so an unscoped count would report — and leak — how many other
departments' facilities use one.
"""

import uuid

import pytest

from app.models.facilities import Facility, FacilityStatus, FacilityType
from app.models.user import Organization
from app.services.facilities_service import FacilitiesService

pytestmark = pytest.mark.integration


async def _org(db, label):
    org = Organization(name=label, slug=f"{label.lower()}-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _system_type(db, name="Station"):
    """A shared lookup: organization_id NULL, visible to every department."""
    row = FacilityType(
        id=str(uuid.uuid4()), organization_id=None, name=name, is_system=True
    )
    db.add(row)
    await db.flush()
    return row


async def _status(db):
    row = FacilityStatus(
        id=str(uuid.uuid4()), organization_id=None, name="In service", is_system=True
    )
    db.add(row)
    await db.flush()
    return row


async def _facility(db, org, type_row, name, status_row):
    fac = Facility(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        facility_type_id=type_row.id,
        status_id=status_row.id,
    )
    db.add(fac)
    await db.flush()
    return fac


class TestFacilityTypeUsageCounts:
    async def test_counts_only_the_callers_own_facilities(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        shared = await _system_type(db_session)
        status = await _status(db_session)
        await _facility(db_session, mine, shared, "Station 1", status)
        await _facility(db_session, theirs, shared, "Their Station", status)
        await _facility(db_session, theirs, shared, "Their Annex", status)

        rows = await FacilitiesService(db_session).list_facility_types(
            organization_id=mine.id
        )

        row = next(r for r in rows if r.id == shared.id)
        # One, not three: the other department's two facilities are not this
        # department's business and must not be countable through a shared row.
        assert row.usage_count == 1

    async def test_an_unused_lookup_reads_zero(self, db_session):
        org = await _org(db_session, "Unused")
        await _system_type(db_session, name="Tower")

        rows = await FacilitiesService(db_session).list_facility_types(
            organization_id=org.id
        )

        assert rows
        assert all(r.usage_count == 0 for r in rows)
