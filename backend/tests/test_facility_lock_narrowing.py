"""FAC-41 / FAC-44: the facility locking reads lock only what they match.

FAC-41: ``_match_facility_document_references`` used to filter on
``file_path LIKE 'document:%'``, which no index satisfies, so locking one
document's references locked every shared-document reference in the
organization. It now matches the indexed ``(organization_id, document_id)``.

FAC-44: ``_lock_facilities_root`` and ``_lock_facility_folder`` filter on
``slug``, which had no index, so the locking read walked the organization's
(or the root's) folders in primary-key order and locked each one it passed.

Folder and document ids are chosen so the unrelated row sorts *before* the
target in primary-key order (and, for FAC-41, sits outside the target's gap in
the new index) -- the arrangement that made the old scans block, rather than a
random one that only sometimes did.

Real, independently committing sessions: the savepoint-backed ``db_session``
never commits, so it cannot show one transaction waiting on another.
"""

import asyncio
import uuid

import pytest
from sqlalchemy import select

from app.core.constants import FOLDER_FACILITIES
from app.core.database import database_manager
from app.models.document import DocumentFolder
from app.models.facilities import (
    Facility,
    FacilityDocument,
    FacilityStatus,
    FacilityType,
)
from app.models.user import Organization
from app.services.documents_service import DocumentsService

pytestmark = pytest.mark.integration

# How long a call that must not wait is given before the test calls it
# blocked, and how long one that must wait is watched before it is released.
_UNBLOCKED_WITHIN = 5
_STILL_WAITING_AFTER = 1.5


def _id_with_prefix(first: str) -> str:
    return first + str(uuid.uuid4())[1:]


@pytest.fixture
async def three_sessions(_initialize_database):
    factory = database_manager.session_factory
    sessions = [factory(), factory(), factory()]
    try:
        yield sessions
    finally:
        for session in sessions:
            await session.rollback()
            await session.close()


async def _cleanup(org_id, facility_id=None, type_id=None, status_id=None):
    cleanup = database_manager.session_factory()
    try:
        await cleanup.execute(
            FacilityDocument.__table__.delete().where(
                FacilityDocument.organization_id == org_id
            )
        )
        await cleanup.execute(
            DocumentFolder.__table__.delete().where(
                DocumentFolder.organization_id == org_id
            )
        )
        if facility_id:
            await cleanup.execute(
                Facility.__table__.delete().where(Facility.id == facility_id)
            )
            await cleanup.execute(
                FacilityType.__table__.delete().where(FacilityType.id == type_id)
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


async def _org_with_facility(session):
    org = Organization(name="Lock Narrowing VFD", slug=f"fac41-{uuid.uuid4().hex[:12]}")
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
    return org.id, facility.id, facility_type.id, facility_status.id


def _reference(org_id, facility_id, document_id):
    return FacilityDocument(
        organization_id=org_id,
        facility_id=facility_id,
        file_path=f"document:{document_id}",
        file_name="policy.pdf",
    )


class TestDocumentReferenceLockIsNarrow:
    async def test_locks_the_target_references_and_not_their_neighbours(
        self, three_sessions
    ):
        locker, other_writer, same_writer = three_sessions
        target_doc = "10000000-0000-4000-8000-000000000000"
        neighbour_doc = "50000000-0000-4000-8000-000000000000"
        unrelated_doc = "90000000-0000-4000-8000-000000000000"
        org_id, facility_id, type_id, status_id = await _org_with_facility(locker)
        # Stored in a non-canonical spelling: matching goes through the
        # derived document_id, so FAC-27's coverage must survive the change.
        target_ref = FacilityDocument(
            organization_id=org_id,
            facility_id=facility_id,
            file_path=f"document:{{{target_doc.upper()}}}",
            file_name="policy.pdf",
        )
        locker.add_all([target_ref, _reference(org_id, facility_id, neighbour_doc)])
        await locker.commit()
        target_ref_id = target_ref.id
        blocked = None
        try:
            matches = await DocumentsService(
                locker
            )._match_facility_document_references(
                FacilityDocument, {target_doc}, org_id
            )
            assert matches == [target_ref_id]

            # A reference to a different document in the same organization
            # is filed while the lock is held. Under the LIKE scan this
            # waited for the locker to finish.
            other_writer.add(_reference(org_id, facility_id, unrelated_doc))
            await asyncio.wait_for(other_writer.commit(), timeout=_UNBLOCKED_WITHIN)

            # FAC-29 still holds: a new reference to the locked document
            # lands in the locked range and waits.
            same_writer.add(_reference(org_id, facility_id, target_doc))
            blocked = asyncio.create_task(same_writer.flush())
            await asyncio.sleep(_STILL_WAITING_AFTER)
            assert not blocked.done()

            await locker.rollback()
            await asyncio.wait_for(blocked, timeout=_UNBLOCKED_WITHIN)
            await same_writer.rollback()
        finally:
            if blocked is not None and not blocked.done():
                await locker.rollback()
                await blocked
            await locker.rollback()
            await other_writer.rollback()
            await same_writer.rollback()
            await _cleanup(org_id, facility_id, type_id, status_id)


class TestFolderLocksAreNarrow:
    async def _folders(self, session):
        org = Organization(
            name="Lock Narrowing VFD", slug=f"fac44-{uuid.uuid4().hex[:12]}"
        )
        session.add(org)
        await session.flush()
        root = DocumentFolder(
            id=_id_with_prefix("f"),
            organization_id=org.id,
            name="Facility Files",
            slug=FOLDER_FACILITIES,
            is_system=True,
        )
        session.add(root)
        await session.flush()
        target_facility = str(uuid.uuid4())
        target = DocumentFolder(
            id=_id_with_prefix("e"),
            organization_id=org.id,
            name="Station 1",
            slug=f"facility-{target_facility}",
            parent_id=root.id,
        )
        # Sorts first in primary-key order, under the same parent and in
        # the same organization: what the old scans walked through.
        sibling = DocumentFolder(
            id=_id_with_prefix("0"),
            organization_id=org.id,
            name="Station 2",
            slug=f"facility-{uuid.uuid4()}",
            parent_id=root.id,
        )
        session.add_all([target, sibling])
        await session.commit()
        return org.id, root.id, target.id, sibling.id, target_facility

    async def _hold(self, session, folder_id):
        held = (
            await session.execute(
                select(DocumentFolder)
                .where(DocumentFolder.id == folder_id)
                .with_for_update()
            )
        ).scalar_one()
        assert held.id == folder_id

    async def test_root_lock_does_not_lock_a_sibling_folder(self, three_sessions):
        locker, caller, _ = three_sessions
        org_id, root_id, _, sibling_id, _ = await self._folders(locker)
        try:
            await self._hold(locker, sibling_id)
            root = await asyncio.wait_for(
                DocumentsService(caller)._lock_facilities_root(org_id),
                timeout=_UNBLOCKED_WITHIN,
            )
            assert root is not None
            assert root.id == root_id
        finally:
            await locker.rollback()
            await caller.rollback()
            await _cleanup(org_id)

    async def test_facility_folder_lock_does_not_lock_a_sibling_folder(
        self, three_sessions
    ):
        locker, caller, _ = three_sessions
        org_id, root_id, target_id, sibling_id, target_facility = await self._folders(
            locker
        )
        try:
            await self._hold(locker, sibling_id)
            folder = await asyncio.wait_for(
                DocumentsService(caller)._lock_facility_folder(
                    root_id, target_facility
                ),
                timeout=_UNBLOCKED_WITHIN,
            )
            assert folder is not None
            assert folder.id == target_id
        finally:
            await locker.rollback()
            await caller.rollback()
            await _cleanup(org_id)
