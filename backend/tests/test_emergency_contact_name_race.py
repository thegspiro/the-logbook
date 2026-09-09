"""FAC-57 (Codex, on top of FAC-51): two concurrent PATCHes clearing
*different* names on the same emergency contact can each pass
``update_emergency_contact``'s "at least one name" check against a
pre-commit snapshot of the other field, then both commit -- leaving the
row with both nullable fields NULL, exactly the state that check exists
to prevent.

Under InnoDB's default REPEATABLE READ, a plain SELECT answers from the
snapshot taken at the transaction's first read. FAC-51's own fix loads the
contact via a plain ``get_emergency_contact`` before checking the merged
result, so a request that cleared ``company_name`` still sees the
*original* (pre-commit) ``contact_name`` in its own snapshot even after a
concurrent request has already cleared ``contact_name`` and committed --
its check passes on stale data, and vice versa for the other request.

The fix is the same pattern this codebase's capacity checks and the
sibling `test_facility_document_reference_race.py` file already use
(CLAUDE.md Pitfall #27): a *locking* read (`for_update=True`), which
always reads the latest committed version regardless of when the
transaction's snapshot was taken, serializing the two requests instead of
letting them both succeed against stale state.

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so
can never demonstrate cross-transaction visibility) to force the exact
interleaving.
"""

import asyncio
import uuid

import pytest

from app.core.database import database_manager
from app.models.facilities import (
    EmergencyContactType,
    Facility,
    FacilityEmergencyContact,
    FacilityStatus,
    FacilityType,
)
from app.models.user import Organization
from app.schemas.facilities import FacilityEmergencyContactUpdate
from app.services.facilities_service import FacilitiesService

pytestmark = pytest.mark.integration


@pytest.fixture
async def two_sessions(_initialize_database):
    """Two independent AsyncSessions, each its own real connection and
    transaction -- required to demonstrate cross-transaction visibility.
    """
    factory = database_manager.session_factory
    sessions = [factory(), factory()]
    try:
        yield sessions
    finally:
        for session in sessions:
            await session.rollback()
            await session.close()


async def _make_org_facility_contact(session, slug):
    org = Organization(name="Race Test VFD", slug=slug)
    session.add(org)
    await session.flush()
    facility_type = FacilityType(organization_id=None, name="Station", is_system=True)
    facility_status = FacilityStatus(
        organization_id=None, name="In service", is_system=True
    )
    session.add_all([facility_type, facility_status])
    await session.flush()
    facility = Facility(
        organization_id=org.id,
        name="Station 1",
        facility_type_id=facility_type.id,
        status_id=facility_status.id,
    )
    session.add(facility)
    await session.flush()
    contact = FacilityEmergencyContact(
        organization_id=org.id,
        facility_id=facility.id,
        contact_type=EmergencyContactType.ALARM_COMPANY,
        company_name="Acme Alarm Co.",
        contact_name="Jane Doe",
    )
    session.add(contact)
    await session.commit()
    return org.id, facility.id, contact.id, facility_type.id, facility_status.id


async def _teardown_org(org_id, facility_id, contact_id, facility_type_id, status_id):
    factory = database_manager.session_factory
    cleanup = factory()
    try:
        await cleanup.execute(
            FacilityEmergencyContact.__table__.delete().where(
                FacilityEmergencyContact.id == contact_id
            )
        )
        await cleanup.execute(
            Facility.__table__.delete().where(Facility.id == facility_id)
        )
        await cleanup.execute(
            FacilityType.__table__.delete().where(FacilityType.id == facility_type_id)
        )
        await cleanup.execute(
            FacilityStatus.__table__.delete().where(FacilityStatus.id == status_id)
        )
        await cleanup.execute(
            Organization.__table__.delete().where(Organization.id == org_id)
        )
        await cleanup.commit()
    finally:
        await cleanup.close()


class TestUpdateEmergencyContactNameCheckIsALockingRead:
    async def test_clearing_different_names_concurrently_cannot_leave_both_null(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        ids = await _make_org_facility_contact(
            session_a, f"fcvfd-race-{uuid.uuid4().hex[:12]}"
        )
        org_id, facility_id, contact_id, facility_type_id, status_id = ids
        b_task = None
        try:
            service_a = FacilitiesService(session_a)
            service_b = FacilitiesService(session_b)

            # Request A: load+lock the row (exactly what
            # update_emergency_contact's own first step does), simulating
            # "A is mid-transaction, has read the row, has not committed
            # yet" -- deliberately not calling update_emergency_contact
            # itself, which has no seam to pause between its own read and
            # its commit.
            contact_a = await service_a.get_emergency_contact(
                contact_id, org_id, for_update=True
            )
            assert contact_a is not None

            # Request B: clears contact_name, leaving company_name set --
            # started while A's transaction is still open. Post-fix, B's
            # own locking read must block on A's still-held row lock.
            # Pre-fix, get_emergency_contact accepts no `for_update` at all
            # and this whole test errors out before ever reaching the race
            # it demonstrates -- itself a valid failure signal for a test
            # whose entire premise is that parameter existing.
            lock_attempted = asyncio.Event()
            original_get = service_b.get_emergency_contact

            async def _tracking_get(*args, **kwargs):
                if kwargs.get("for_update"):
                    lock_attempted.set()
                return await original_get(*args, **kwargs)

            service_b.get_emergency_contact = _tracking_get

            b_task = asyncio.create_task(
                service_b.update_emergency_contact(
                    contact_id=contact_id,
                    contact_data=FacilityEmergencyContactUpdate(contact_name=None),
                    organization_id=org_id,
                )
            )
            await asyncio.wait_for(lock_attempted.wait(), timeout=10)
            await asyncio.sleep(0.2)
            assert not b_task.done(), (
                "update_emergency_contact should still be blocked on A's "
                "already-locked row"
            )

            # Request A completes its own update (clearing company_name)
            # and commits, releasing the lock B is waiting on.
            contact_a.company_name = None
            assert contact_a.company_name or contact_a.contact_name
            await session_a.commit()

            # B unblocks, re-reads the now-current row (company_name
            # already NULL from A's commit) via its own locking read, and
            # must refuse to also clear contact_name -- leaving both NULL
            # is exactly the state FAC-51's check exists to prevent, and a
            # stale (pre-commit) snapshot is the only way B could miss it.
            with pytest.raises(ValueError, match="company_name or contact_name"):
                await asyncio.wait_for(b_task, timeout=10)
            b_task = None

            # Read back with a third, fresh session so this assertion
            # cannot itself answer from either session's own snapshot.
            factory = database_manager.session_factory
            verifier = factory()
            try:
                refreshed = await FacilitiesService(verifier).get_emergency_contact(
                    contact_id, org_id
                )
                assert refreshed.company_name or refreshed.contact_name
                assert refreshed.contact_name == "Jane Doe"
            finally:
                await verifier.close()
        finally:
            if b_task is not None and not b_task.done():
                b_task.cancel()
            for session in (session_a, session_b):
                await session.rollback()
            await _teardown_org(*ids)
