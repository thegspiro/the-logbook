"""FAC-29 (Codex, on top of FAC-26/27/28): the facility-document-reference
cleanup and the reference-filing validation are a read-then-write racing on
the same ``Document`` row from two directions, and a plain SELECT is not
enough to serialize either one.

Under InnoDB's default REPEATABLE READ, a plain SELECT answers from the
snapshot taken at the transaction's *first* read -- and every request here
already reads something before the check that matters runs (the endpoint's
own document fetch, or an auth/permission dependency's user lookup), so that
snapshot predates a concurrent commit on the other side:

* ``_delete_facility_document_references``'s existence check could miss a
  ``FacilityDocument``/``FacilityPhoto`` reference committed *after* the
  deleting transaction's snapshot was taken, letting the delete proceed
  unconditionally and leaving the just-created reference permanently
  dangling.
* ``_validate_shared_document_reference`` (facilities.py) could resolve a
  document a concurrent transaction already deleted and committed, filing a
  reference to nothing the moment both transactions finish.

The fix in both places is a *locking* read (``with_for_update()``/
``for_update=True``): unlike a plain SELECT, a locking read always reads the
latest committed version regardless of when the transaction's snapshot was
taken -- the same pattern this codebase's capacity checks already use
(CLAUDE.md Pitfall #27).

These tests use two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so
can never demonstrate cross-transaction visibility) to force the exact
interleaving. Every row created is torn down explicitly at the end.
"""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.api.v1.endpoints.facilities import _validate_shared_document_reference
from app.core.database import database_manager
from app.models.document import Document, DocumentFolder
from app.models.facilities import (
    Facility,
    FacilityDocument,
    FacilityStatus,
    FacilityType,
)
from app.models.user import Organization
from app.services.documents_service import DocumentsService

pytestmark = pytest.mark.integration


@pytest.fixture
async def two_sessions(_initialize_database):
    """Two independent AsyncSessions, each its own real connection and
    transaction -- required to demonstrate cross-transaction visibility,
    which the shared savepoint-based ``db_session`` fixture cannot do.

    FAC-33 (Codex): teardown used to swallow every rollback failure with a
    blanket ``except Exception: pass``. Verified empirically (both against a
    clean session and one whose connection was already closed) that
    ``rollback()`` raises nothing in either case against this backend --
    there is no known-benign exception to narrow the catch to. Per
    CLAUDE.md's "Fix All Errors" policy, a rollback failure here means a
    broken connection or an unreleased transaction from the test itself, and
    must surface as a test failure rather than be hidden until some later,
    unrelated test fails or hangs.
    """
    factory = database_manager.session_factory
    sessions = [factory(), factory()]
    try:
        yield sessions
    finally:
        for session in sessions:
            await session.rollback()
            await session.close()


async def _make_org_facility_document(session, slug):
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
    document = Document(organization_id=org.id, name="Policy", file_name="policy.pdf")
    session.add(document)
    await session.commit()
    return org.id, facility.id, document.id, facility_type.id, facility_status.id


async def _make_org_folder_document(session, slug):
    """A plain (non-facility) folder with one document in it -- what
    ``delete_folder``'s cascade needs, with no facility scaffolding."""
    org = Organization(name="Race Test VFD", slug=slug)
    session.add(org)
    await session.flush()
    folder = DocumentFolder(
        organization_id=org.id, name="Cascade Test", is_system=False
    )
    session.add(folder)
    await session.flush()
    document = Document(
        organization_id=org.id,
        name="Policy",
        file_name="policy.pdf",
        folder_id=folder.id,
    )
    session.add(document)
    await session.commit()
    return org.id, folder.id, document.id


async def _teardown_org_folder(org_id, folder_id, document_id):
    factory = database_manager.session_factory
    cleanup = factory()
    try:
        await cleanup.execute(
            FacilityDocument.__table__.delete().where(
                FacilityDocument.organization_id == org_id
            )
        )
        await cleanup.execute(
            Document.__table__.delete().where(Document.id == document_id)
        )
        await cleanup.execute(
            DocumentFolder.__table__.delete().where(DocumentFolder.id == folder_id)
        )
        await cleanup.execute(
            Organization.__table__.delete().where(Organization.id == org_id)
        )
        await cleanup.commit()
    finally:
        await cleanup.close()


async def _teardown_org(org_id, facility_id, document_id, facility_type_id, status_id):
    factory = database_manager.session_factory
    cleanup = factory()
    try:
        await cleanup.execute(
            FacilityDocument.__table__.delete().where(
                FacilityDocument.organization_id == org_id
            )
        )
        await cleanup.execute(
            Document.__table__.delete().where(Document.id == document_id)
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


class TestFacilityReferenceExistenceCheckIsALockingRead:
    """The delete side (FAC-26's existence check): a reference committed
    after the deleting transaction's snapshot was taken must still be seen.
    """

    async def test_a_reference_committed_after_the_snapshot_is_still_seen(
        self, two_sessions
    ):
        deleter, creator = two_sessions
        ids = await _make_org_facility_document(
            deleter, f"fcvfd-race-{uuid.uuid4().hex[:12]}"
        )
        org_id, facility_id, document_id, facility_type_id, status_id = ids
        try:
            # Simulates the endpoint's own `existing = await
            # service.get_document_by_id(...)` fetch, which already runs
            # before delete_document (and its facility-reference check)
            # ever executes -- establishing the deleting transaction's
            # REPEATABLE READ snapshot for plain reads before any
            # reference exists.
            result = await deleter.execute(
                select(Document).where(Document.id == document_id)
            )
            result.scalar_one()

            # A second, real, independently-committing transaction files a
            # facility reference to the same document.
            facility_document = FacilityDocument(
                organization_id=org_id,
                facility_id=facility_id,
                file_path=f"document:{document_id}",
                file_name="policy.pdf",
            )
            creator.add(facility_document)
            await creator.commit()

            # The deleting transaction's existence check must see the
            # reference despite its snapshot predating the commit above --
            # a plain SELECT here would not (FAC-29).
            matches = await DocumentsService(
                deleter
            )._match_facility_document_references(
                FacilityDocument, {str(document_id)}, org_id
            )
            assert matches == [facility_document.id]
        finally:
            # Release the locking read's row lock before a third session
            # tries to delete the same rows -- otherwise cleanup deadlocks
            # against this test's own still-open transaction.
            await deleter.rollback()
            await _teardown_org(*ids)


class TestCreateReferenceValidationIsALockingRead:
    """The create side (facilities.py's ``_validate_shared_document_reference``):
    a document a concurrent transaction already deleted and committed must
    not resolve as existing, even against a stale snapshot.
    """

    async def test_a_document_deleted_after_the_snapshot_no_longer_resolves(
        self, two_sessions
    ):
        creator, deleter = two_sessions
        ids = await _make_org_facility_document(
            creator, f"fcvfd-race-{uuid.uuid4().hex[:12]}"
        )
        org_id, facility_id, document_id, facility_type_id, status_id = ids
        try:
            # An unrelated first read establishes the creating transaction's
            # snapshot while the document still exists -- models a request's
            # own earlier reads (e.g. the auth dependency's user/position
            # lookup) that run before validation ever touches the document.
            result = await creator.execute(
                select(Organization).where(Organization.id == org_id)
            )
            result.scalar_one()

            # A second, real, independently-committing transaction deletes
            # the document.
            result = await deleter.execute(
                select(Document).where(Document.id == document_id)
            )
            doc = result.scalar_one()
            await deleter.delete(doc)
            await deleter.commit()

            # A plain read on the creating side would still resolve the
            # document from its stale snapshot -- demonstrating the race
            # this fixture reproduces.
            plain = await DocumentsService(creator).get_document_by_id(
                document_id, org_id, for_update=False
            )
            assert plain is not None, (
                "expected the plain read to reproduce the stale-snapshot "
                "read (this assertion documents the race, not the fix)"
            )
            await creator.rollback()

            # The actual validation path (for_update=True) must not resolve
            # the deleted document, regardless of the snapshot (FAC-29).
            result = await creator.execute(
                select(Organization).where(Organization.id == org_id)
            )
            result.scalar_one()
            locked = await DocumentsService(creator).get_document_by_id(
                document_id, org_id, for_update=True
            )
            assert locked is None
        finally:
            # Both sessions still hold open transactions (creator's last
            # read, deleter's commit started a fresh implicit one) --
            # release them before a third session tears the rows down, or
            # cleanup deadlocks against this test's own connections.
            await creator.rollback()
            await deleter.rollback()
            await _teardown_org(*ids)


class TestReferenceInsertStaysUnderTheDocumentLock:
    """FAC-31 (Codex, on top of FAC-29): validating a reference and actually
    filing it are two separate steps -- ``_validate_shared_document_reference``
    locks and (for a folderless document) assigns a folder, but the
    ``FacilityDocument``/``FacilityPhoto`` row that records the reference is
    only inserted afterward, by the caller
    (``create_facility_document``/``create_facility_photo``). FAC-29's lock
    protects the validation step; if that step commits on its own, the lock
    is released before the reference the caller is about to file even
    exists, and a concurrent delete can land in exactly that gap.

    Proving the fix needs one session to actually *block* on the other's row
    lock while it is held, not just resolve a stale value -- a plain
    sequential ``await`` between two independent sessions cannot observe a
    block (nothing else could be running for it to block against). This test
    runs the deleting session's ``delete_document`` as a background task
    while the creator's transaction is still open, and inspects whether it
    has completed after a short pause -- long enough to observe a lock wait,
    short enough not to be mistaken for one. Whichever path is taken, the
    single invariant asserted at the end is the one FAC-31 exists to
    protect: a ``FacilityDocument``/``FacilityPhoto`` row is never left
    pointing at a document that no longer exists.
    """

    async def test_a_concurrent_delete_cannot_land_between_validate_and_insert(
        self, two_sessions
    ):
        creator, deleter = two_sessions
        ids = await _make_org_facility_document(
            creator, f"fcvfd-race-{uuid.uuid4().hex[:12]}"
        )
        org_id, facility_id, document_id, facility_type_id, status_id = ids
        try:
            creator_user = SimpleNamespace(organization_id=org_id)

            # Step 1: exactly what create_facility_document/create_facility_photo
            # do before they insert the reference row -- validate, and (this
            # document has no folder yet) assign one.
            await _validate_shared_document_reference(
                creator, f"document:{document_id}", creator_user, str(facility_id)
            )

            # Step 2: a second, real session races the gap between that
            # validation and the reference the creator is about to file.
            # current_user=None means the deleter's own facility-reference
            # permission check (FAC-26) fails closed if it ever sees a
            # reference -- it should not need that check to matter here,
            # because at this instant no reference has been filed yet.
            delete_task = asyncio.create_task(
                DocumentsService(deleter).delete_document(document_id, org_id)
            )
            await asyncio.sleep(0.5)

            if not delete_task.done():
                # Fixed behaviour: the creator's transaction never committed
                # inside validation (FAC-31), so the FOR UPDATE lock taken
                # there is still held -- the deleter is genuinely blocked on
                # it. Finish the creator's flow (file the reference, then
                # commit once) to release the lock, exactly as
                # create_facility_document does.
                creator.add(
                    FacilityDocument(
                        organization_id=org_id,
                        facility_id=facility_id,
                        file_path=f"document:{document_id}",
                        file_name="policy.pdf",
                    )
                )
                await creator.commit()
                # The deleter unblocks, now sees the just-filed reference,
                # and (current_user=None) is refused by FAC-26 rather than
                # being allowed to delete a referenced document.
                with pytest.raises(PermissionError):
                    await asyncio.wait_for(delete_task, timeout=10)
                # The deleter's transaction is left open on its own
                # PermissionError -- release it before teardown.
                await deleter.rollback()
            else:
                # Pre-fix behaviour: validation's own commit already
                # released the lock, so the deleter proceeded immediately.
                # With no reference on file yet, FAC-26 never even
                # triggers -- the delete succeeds unconditionally, out from
                # under the request that is about to file a reference to
                # this document.
                assert delete_task.result() is True
                creator.add(
                    FacilityDocument(
                        organization_id=org_id,
                        facility_id=facility_id,
                        file_path=f"document:{document_id}",
                        file_name="policy.pdf",
                    )
                )
                await creator.commit()

            # The invariant, regardless of which path was taken above: any
            # surviving facility_document reference must point at a document
            # that still exists.
            verifier = database_manager.session_factory()
            try:
                remaining = await verifier.execute(
                    select(FacilityDocument).where(
                        FacilityDocument.organization_id == org_id
                    )
                )
                reference = remaining.scalar_one_or_none()
                if reference is not None:
                    still_there = await verifier.get(Document, str(document_id))
                    assert still_there is not None, (
                        "a facility_document row references a document that "
                        "no longer exists -- FAC-31's race reopened"
                    )
            finally:
                await verifier.close()
        finally:
            await creator.rollback()
            await deleter.rollback()
            await _teardown_org(*ids)


class TestDeleteFolderLocksDocumentsBeforeTheReferenceTable:
    """FAC-32 (Codex, on top of FAC-29/31): FAC-31 makes the creator path
    lock a ``Document`` row first, then -- still holding it -- insert into
    the ``FacilityDocument``/``FacilityPhoto`` reference table.
    ``delete_folder``'s cascade used to do the opposite: it scanned (and
    locked) the reference table first, via
    ``_match_facility_document_references``, and only reached the subtree's
    ``Document`` rows afterward, implicitly, through the ORM's cascade
    delete. Two transactions taking the same two locks in opposite orders is
    a textbook InnoDB deadlock: the creator's reference-table insert can
    block on this scan's gap lock while this scan's later Document need
    blocks on the creator's already-held row lock, and neither can proceed.

    A true deadlock needs both sides genuinely blocked on each other at the
    same instant, which is inherently timing-sensitive to force on demand in
    a way that is reliable across both this project's MySQL 8.0 and MariaDB
    10.11 test matrices. Rather than chase that, this test verifies the
    concrete, engine-independent effect the reordering fix guarantees: with
    a ``Document`` row already locked by one session, ``delete_folder`` run
    in a second, real session must block on *that* row before it ever
    reaches the reference-table scan -- not merely block *somewhere*
    eventually, which the old, wrong order also did (just later, at the
    cascade delete itself, by which point the reference-table lock had
    already been taken in the wrong order). ``_match_facility_document_references``
    is instrumented, on this one cascade-only ``DocumentsService`` instance,
    to record whether it has been reached yet -- ``patch.object`` on an
    object built for, and used by, only this one coroutine is the case
    CLAUDE.md pitfall #22 carves out; nothing else concurrently patches the
    same target.
    """

    async def test_delete_folder_blocks_on_the_document_lock_before_scanning_references(
        self, two_sessions
    ):
        creator, cascade = two_sessions
        ids = await _make_org_folder_document(
            creator, f"fcvfd-lockorder-{uuid.uuid4().hex[:12]}"
        )
        org_id, folder_id, document_id = ids
        cascade_task = None
        try:
            # Creator side: lock the Document first, exactly as the
            # FAC-31-fixed create path does.
            await DocumentsService(creator).get_document_by_id(
                document_id, org_id, for_update=True
            )

            reference_scan_reached = asyncio.Event()
            cascade_service = DocumentsService(cascade)
            original_scan = cascade_service._match_facility_document_references

            async def _tracking_scan(*args, **kwargs):
                reference_scan_reached.set()
                return await original_scan(*args, **kwargs)

            with patch.object(
                cascade_service, "_match_facility_document_references", _tracking_scan
            ):
                cascade_task = asyncio.create_task(
                    cascade_service.delete_folder(folder_id, org_id, current_user=None)
                )
                await asyncio.sleep(0.5)

                # The reordering fix's whole point: delete_folder is still
                # blocked, and blocked *before* it ever reached the
                # reference-table scan -- not merely blocked somewhere,
                # which the wrong order produced too (just later).
                assert not cascade_task.done(), (
                    "delete_folder should still be blocked on the "
                    "already-locked Document row"
                )
                assert not reference_scan_reached.is_set(), (
                    "delete_folder reached the reference-table scan before "
                    "locking the subtree's Document rows -- FAC-32's lock "
                    "order regressed"
                )

                # Release the Document lock; delete_folder should now run
                # to completion without deadlocking.
                await creator.commit()
                deleted = await asyncio.wait_for(cascade_task, timeout=10)
                assert deleted is True
                assert reference_scan_reached.is_set()
        finally:
            if cascade_task is not None and not cascade_task.done():
                cascade_task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await cascade_task
            await creator.rollback()
            await cascade.rollback()
            await _teardown_org_folder(*ids)
