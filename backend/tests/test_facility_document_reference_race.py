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

import uuid

import pytest
from sqlalchemy import select

from app.core.database import database_manager
from app.models.document import Document
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
    which the shared savepoint-based ``db_session`` fixture cannot do."""
    factory = database_manager.session_factory
    sessions = [factory(), factory()]
    try:
        yield sessions
    finally:
        for session in sessions:
            try:
                await session.rollback()
            except Exception:
                pass
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
