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


async def _make_org_facility_document_with_folder(session, slug):
    """Like ``_make_org_facility_document``, but with the facility's own
    ``DocumentFolder`` pre-created (via ``ensure_facility_folder``, in its
    own committed transaction first) -- what FAC-34's race needs: an
    *existing* folder row for a concurrent ``delete_folder`` to target, and
    for ``_validate_shared_document_reference``'s ``ensure_facility_folder``
    call to find (and lock) via its "found" path rather than create fresh.
    """
    ids = await _make_org_facility_document(session, slug)
    org_id, facility_id, document_id, facility_type_id, status_id = ids
    factory = database_manager.session_factory
    setup_session = factory()
    try:
        folder = await DocumentsService(setup_session).ensure_facility_folder(
            org_id, str(facility_id), "Station 1"
        )
        await setup_session.commit()
        folder_id = folder.id
    finally:
        await setup_session.close()
    return org_id, facility_id, document_id, facility_type_id, status_id, folder_id


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


class TestDeleteFolderLocksTheDestinationFolderBeforeAnyDocumentQuery:
    """FAC-34 (Codex, on top of FAC-32): a *third* shared resource, not just
    the two FAC-32 already orders correctly. Filing a folderless document
    (facilities.py, ``_validate_shared_document_reference``) locks the
    ``Document`` row, then -- via ``ensure_facility_folder`` -- the
    destination ``DocumentFolder``, and only *then* flushes
    ``document.folder_id`` onto it.

    That flush is an UPDATE against the ``folder_id`` secondary index.
    FAC-32 made this cascade run a locking ``SELECT`` filtered on that exact
    column (``_lock_subtree_documents``, below) before the reference-table
    scan -- correct for FAC-32's own concern (ordering against the reference
    table), but a locking ``SELECT`` filtered on a column a concurrent
    transaction is about to write into can block that write regardless of
    whether the two ultimately conflict on the same row: a gap/next-key lock
    at the filtered value if it currently matches no rows, or -- depending
    on which index MySQL/MariaDB's optimizer picks for the query, itself a
    function of the subtree's size and the table's statistics -- blocking
    outright on some *other*, unrelated row of the same organization the
    scan happens to examine first. Verified empirically both ways with two
    real, independently-committing sessions: a small subtree can produce
    either behaviour depending on the query plan, and neither this test nor
    the fix should depend on which one the optimizer picks on a given run.

    Either way, if this cascade's Document-lock query starts running before
    the creator's flush completes, the flush can block on it -- while the
    creator is still holding the destination folder's own lock from
    ``ensure_facility_folder``. This cascade's later, implicit need for that
    same folder lock (the final ``db.delete(folder)``, at commit) then
    blocks right back on the creator. Two-way deadlock, and reordering only
    the Document/reference-table pair (FAC-32's fix) does not touch it,
    because whatever traps the creator is a side effect of this cascade's
    Document query itself, taken *before* this cascade ever reaches an
    explicit folder lock or the reference table.

    Locking the destination folder(s) first closes it regardless of query
    plan: this cascade then either wins the folder race outright (nothing
    below has run yet, so it cannot be holding anything the creator needs)
    or loses it and blocks immediately -- before ever issuing the Document
    query that would otherwise trap the creator's flush. Proving that
    control-flow fact -- rather than the specific engine-level mechanism,
    which is plan-dependent -- is what this test asserts, the same
    engine-independence rationale as FAC-32's own test:
    ``_lock_subtree_documents`` (the extracted FAC-32 query) must never be
    reached while this cascade is still blocked on the FAC-34 folder lock.

    FAC-35 note: this test manually replicates the *pre-FAC-35* creator's
    lock sequence (Document, then DocumentFolder) by driving
    ``get_document_by_id``/``ensure_facility_folder`` directly rather than
    calling ``_validate_shared_document_reference`` -- the real function no
    longer takes locks in that order (it now locks the folder first, like
    this cascade). That does not make this test stale: it still proves
    ``delete_folder``'s own behaviour -- blocking on a folder any other
    session holds, before ever issuing a Document query -- independent of
    which order that other session acquired its own locks in.
    ``TestCascadeBlocksOnACreatorThatHoldsOnlyTheFolderSoFar`` below proves
    the same thing driven through the real, now-fixed creator function.
    """

    async def test_delete_folder_blocks_on_the_folder_lock_before_any_document_query(
        self, two_sessions
    ):
        creator, cascade = two_sessions
        ids = await _make_org_facility_document_with_folder(
            creator, f"fcvfd-folderlock-{uuid.uuid4().hex[:12]}"
        )
        org_id, facility_id, document_id, facility_type_id, status_id, folder_id = ids
        cascade_task = None
        try:
            docs_creator = DocumentsService(creator)
            await docs_creator.get_document_by_id(document_id, org_id, for_update=True)
            # Locks the destination folder via ensure_facility_folder's
            # "found" path -- exactly what _validate_shared_document_reference
            # does before it ever touches document.folder_id.
            await docs_creator.ensure_facility_folder(
                org_id, str(facility_id), "Station 1"
            )

            document_query_reached = asyncio.Event()
            cascade_service = DocumentsService(cascade)
            original_lock_documents = cascade_service._lock_subtree_documents

            async def _tracking_lock_documents(*args, **kwargs):
                document_query_reached.set()
                return await original_lock_documents(*args, **kwargs)

            with patch.object(
                cascade_service,
                "_lock_subtree_documents",
                _tracking_lock_documents,
            ):
                cascade_task = asyncio.create_task(
                    cascade_service.delete_folder(folder_id, org_id, current_user=None)
                )
                await asyncio.sleep(0.5)

                # The fix's whole point: delete_folder is still blocked, and
                # blocked *before* it ever issued the Document-lock query --
                # not merely blocked somewhere, which the pre-fix ordering
                # also produced (just via that query's own locking, whose
                # mechanism is plan-dependent -- see the class docstring).
                assert not cascade_task.done(), (
                    "delete_folder should still be blocked on the "
                    "already-locked destination DocumentFolder"
                )
                assert not document_query_reached.is_set(), (
                    "delete_folder issued its Document-lock query before "
                    "locking the destination DocumentFolder -- FAC-34's "
                    "lock order regressed"
                )

                # Release the folder lock; delete_folder should now run to
                # completion without deadlocking.
                await creator.commit()
                deleted = await asyncio.wait_for(cascade_task, timeout=10)
                assert deleted is True
                assert document_query_reached.is_set()
        finally:
            if cascade_task is not None and not cascade_task.done():
                cascade_task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await cascade_task
            await creator.rollback()
            await cascade.rollback()
            await _teardown_org(
                org_id, facility_id, document_id, facility_type_id, status_id
            )


class TestCreatorLocksTheFolderBeforeTheDocument:
    """FAC-35: the total-order fix that supersedes FAC-32/34's pairwise
    reorderings. FAC-34 fixed ``delete_folder``'s cascade to lock
    ``DocumentFolder`` before ``Document`` -- but never touched the creator
    path, which (at the time) locked ``Document`` first and
    ``DocumentFolder`` second, via ``ensure_facility_folder``. Two paths
    taking the same two locks in opposite orders is exactly the deadlock
    FAC-32 closed for the Document/reference-table pair, reopened here for
    the Document/DocumentFolder pair: a cascade that has already locked the
    destination folder, and a creator that has already locked the document
    being filed into it, can each be waiting on the resource the other
    holds.

    This class proves the creator side of the fix directly, driving the
    real ``_validate_shared_document_reference`` (not a manually
    reconstructed lock sequence) and asserting it blocks on a
    cascade-held ``DocumentFolder`` lock *before* it ever issues its
    ``Document`` lock query -- the mirror image of
    ``TestDeleteFolderLocksTheDestinationFolderBeforeAnyDocumentQuery``
    above, which proves the same thing for the cascade side.
    """

    async def test_creator_blocks_on_a_cascade_held_folder_before_locking_the_document(
        self, two_sessions
    ):
        cascade, creator = two_sessions
        ids = await _make_org_facility_document_with_folder(
            cascade, f"fcvfd-fac35-{uuid.uuid4().hex[:12]}"
        )
        org_id, facility_id, document_id, facility_type_id, status_id, folder_id = ids
        creator_task = None
        try:
            # Cascade side: lock the destination folder, exactly as
            # delete_folder's own _lock_subtree_folders does for a subtree
            # that includes it.
            await DocumentsService(cascade)._lock_subtree_folders({str(folder_id)})

            document_lock_reached = asyncio.Event()
            original_get_document_by_id = DocumentsService.get_document_by_id

            async def _tracking_get_document_by_id(self, *args, **kwargs):
                if kwargs.get("for_update"):
                    document_lock_reached.set()
                return await original_get_document_by_id(self, *args, **kwargs)

            creator_user = SimpleNamespace(organization_id=org_id)

            # Patched at the class level -- _validate_shared_document_reference
            # builds its own DocumentsService(db) internally, so there is no
            # instance to patch.object() before it exists. Only the creator
            # coroutine below ever calls this method while the patch is
            # active (the cascade side already finished its own locking
            # call above), so this does not run afoul of CLAUDE.md pitfall
            # #22 (two coroutines concurrently entering the same patch).
            with patch.object(
                DocumentsService, "get_document_by_id", _tracking_get_document_by_id
            ):
                creator_task = asyncio.create_task(
                    _validate_shared_document_reference(
                        creator,
                        f"document:{document_id}",
                        creator_user,
                        str(facility_id),
                    )
                )
                await asyncio.sleep(0.5)

                # The fix's whole point: the creator path is still blocked,
                # and blocked *before* it ever issued the Document lock
                # query -- not merely blocked somewhere, which the pre-fix
                # order also produced (just later, after the Document lock
                # had already been taken).
                assert not creator_task.done(), (
                    "_validate_shared_document_reference should still be "
                    "blocked on the cascade-held destination DocumentFolder"
                )
                assert not document_lock_reached.is_set(), (
                    "_validate_shared_document_reference locked the "
                    "Document row before the destination DocumentFolder -- "
                    "FAC-35's lock order regressed"
                )

                # Release the folder lock; the creator path should now run
                # to completion without deadlocking.
                await cascade.commit()
                await asyncio.wait_for(creator_task, timeout=10)
                assert document_lock_reached.is_set()
        finally:
            if creator_task is not None and not creator_task.done():
                creator_task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await creator_task
            await cascade.rollback()
            await creator.rollback()
            await _teardown_org(
                org_id, facility_id, document_id, facility_type_id, status_id
            )


class TestCascadeBlocksOnACreatorThatHoldsOnlyTheFolderSoFar:
    """FAC-35, the other direction -- and the one that has to be built as a
    genuinely paused interleaving, not a sequential "let the creator finish,
    then start the cascade" setup. A creator that has *already fully run*
    holds both locks by the time the cascade starts, regardless of which
    order it acquired them in -- so a test shaped that way cannot tell the
    fixed ordering apart from the broken one (confirmed empirically: an
    earlier version of this test, built that way and driven through the
    real pre-fix creator, passed against pre-fix code too, because
    ``delete_folder``'s own FAC-34 ordering was never in question here).

    What actually needs proving is the state that only exists *during* the
    post-fix creator's sequence and never during the pre-fix one: the
    creator holding the destination ``DocumentFolder`` lock while it has
    not yet even issued its own ``Document`` lock query. Pre-fix, the
    creator locks the ``Document`` row first, so this state never occurs --
    by the time it would hold the folder, it already holds the document
    too, at which point ``delete_folder`` racing in can be trapped by the
    Document lock while never having reached its own folder lock (the exact
    mechanism FAC-34 identified, from the other side). Post-fix, this state
    always exists, briefly, between ``ensure_facility_folder`` returning and
    ``get_document_by_id(for_update=True)`` being called -- paused here with
    a patched, event-gated ``get_document_by_id`` so the window is
    deterministic instead of a race against real query latency.
    """

    async def test_cascade_blocks_on_the_folder_while_the_creator_has_not_yet_locked_its_document(
        self, two_sessions
    ):
        creator, cascade = two_sessions
        ids = await _make_org_facility_document_with_folder(
            creator, f"fcvfd-fac35-{uuid.uuid4().hex[:12]}"
        )
        org_id, facility_id, document_id, facility_type_id, status_id, folder_id = ids
        creator_task = None
        cascade_task = None
        try:
            creator_user = SimpleNamespace(organization_id=org_id)

            # Pause the creator path the moment it is about to lock the
            # Document row (for_update=True) -- post-fix, this is strictly
            # after ensure_facility_folder has already locked the
            # destination DocumentFolder; pre-fix, this is the creator's
            # very first locking call, before it has touched any folder.
            about_to_lock_document = asyncio.Event()
            proceed_to_document_lock = asyncio.Event()
            original_get_document_by_id = DocumentsService.get_document_by_id

            async def _paused_get_document_by_id(self, *args, **kwargs):
                if kwargs.get("for_update"):
                    about_to_lock_document.set()
                    await proceed_to_document_lock.wait()
                return await original_get_document_by_id(self, *args, **kwargs)

            with patch.object(
                DocumentsService, "get_document_by_id", _paused_get_document_by_id
            ):
                creator_task = asyncio.create_task(
                    _validate_shared_document_reference(
                        creator,
                        f"document:{document_id}",
                        creator_user,
                        str(facility_id),
                    )
                )
                await asyncio.wait_for(about_to_lock_document.wait(), timeout=10)

                document_query_reached = asyncio.Event()
                cascade_service = DocumentsService(cascade)
                original_lock_documents = cascade_service._lock_subtree_documents

                async def _tracking_lock_documents(*args, **kwargs):
                    document_query_reached.set()
                    return await original_lock_documents(*args, **kwargs)

                with patch.object(
                    cascade_service,
                    "_lock_subtree_documents",
                    _tracking_lock_documents,
                ):
                    cascade_task = asyncio.create_task(
                        cascade_service.delete_folder(
                            folder_id, org_id, current_user=None
                        )
                    )
                    await asyncio.sleep(0.5)

                    # Post-fix: the creator holds only the destination
                    # DocumentFolder so far (paused before its own Document
                    # lock) -- delete_folder must still block on that folder
                    # and never reach its Document-lock query. Pre-fix, the
                    # creator holds no folder lock yet at this pause point
                    # (it pauses on its *first* locking call, before
                    # ensure_facility_folder ever runs) -- nothing blocks
                    # delete_folder here, and it runs straight through to
                    # (and past) the Document-lock query, which is exactly
                    # the assertion below catching the pre-fix order.
                    assert not cascade_task.done(), (
                        "delete_folder should still be blocked on the "
                        "creator-held destination DocumentFolder, even "
                        "though the creator has not yet locked its own "
                        "Document row"
                    )
                    assert not document_query_reached.is_set(), (
                        "delete_folder issued its Document-lock query while "
                        "racing a creator that -- post-fix -- holds only "
                        "the destination DocumentFolder lock so far -- "
                        "FAC-35's lock order regressed"
                    )

                    # Let the creator proceed to lock (and file) its
                    # document, then commit -- releasing both locks so the
                    # cascade can complete.
                    proceed_to_document_lock.set()
                    await asyncio.wait_for(creator_task, timeout=10)
                    await creator.commit()

                    deleted = await asyncio.wait_for(cascade_task, timeout=10)
                    assert deleted is True
                    assert document_query_reached.is_set()
        finally:
            if cascade_task is not None and not cascade_task.done():
                cascade_task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await cascade_task
            if creator_task is not None and not creator_task.done():
                creator_task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await creator_task
            await creator.rollback()
            await cascade.rollback()
            await _teardown_org(
                org_id, facility_id, document_id, facility_type_id, status_id
            )
