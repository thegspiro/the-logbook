"""AP-12 (Codex, on top of AP-8): ``EquipmentCheckService.delete_compartment``
is a read-then-cascade racing a concurrent reparent of a descendant
compartment, and the exact race FAC-40 already fixed once in this codebase
(``documents_service.delete_folder`` / ``DocumentFolder``, see
``tests/test_facility_document_reference_race.py``,
``TestDeleteFolderExplicitlyDeletesTheLockedDocuments``).

Under InnoDB's default REPEATABLE READ, a plain SELECT answers from the
snapshot taken at the transaction's *first* read. ``delete_compartment``'s
own first read (``_get_compartment``) establishes that snapshot, and --
before AP-12 -- the ORM's ``cascade="all, delete-orphan"`` on
``CheckTemplateCompartment.children`` lazy-loaded the subtree off that same
stale snapshot when ``db.delete(compartment)`` ran. A concurrent, already
-committed reparent of a descendant between the snapshot and the delete cuts
both ways:

* A child moved OUT of the subtree is still in the stale ``children``
  collection and gets destroyed anyway, even though it now belongs to a
  different, still-live compartment.
* A child moved IN is absent from the stale collection, survives the
  cascade, and -- because ``parent_compartment_id`` is ``ondelete="SET
  NULL"``, not ``CASCADE`` -- is left behind as a live, orphaned root once
  the database nulls its dangling FK.

Fixed by ``_lock_compartment_subtree``: a level-by-level ``FOR UPDATE`` walk
that always sees latest committed state (a locking read ignores the
snapshot) and locks every row it finds, so a concurrent reparent targeting an
already-locked row blocks until this transaction finishes rather than racing
it. ``delete_compartment`` then deletes the subtree as one explicit bulk
statement against that authoritative id set, and
``CheckTemplateCompartment.children``/``.items`` are ``passive_deletes=True``
so the ORM's own cascade never independently re-derives (and potentially
disagrees with) that set.

These tests use two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so can
never demonstrate cross-transaction visibility) to force the exact
interleaving. Every row created is torn down explicitly at the end.
"""

import uuid

import pytest
from sqlalchemy import select

from app.core.database import database_manager
from app.models.apparatus import CheckTemplateCompartment, EquipmentCheckTemplate
from app.models.user import Organization
from app.services.equipment_check_service import EquipmentCheckService

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


async def _teardown(org_id, compartment_ids):
    factory = database_manager.session_factory
    cleanup = factory()
    try:
        if compartment_ids:
            await cleanup.execute(
                CheckTemplateCompartment.__table__.delete().where(
                    CheckTemplateCompartment.id.in_(compartment_ids)
                )
            )
        await cleanup.execute(
            EquipmentCheckTemplate.__table__.delete().where(
                EquipmentCheckTemplate.organization_id == org_id
            )
        )
        await cleanup.execute(
            Organization.__table__.delete().where(Organization.id == org_id)
        )
        await cleanup.commit()
    finally:
        await cleanup.close()


class TestDeleteCompartmentExplicitlyLocksTheSubtree:
    """AP-12: a descendant reparented mid-transaction must be handled
    correctly regardless of which direction it moved.
    """

    async def test_child_reparented_out_mid_transaction_survives(self, two_sessions):
        deleter, mover = two_sessions
        slug = f"ap-race-out-{uuid.uuid4().hex[:12]}"
        org = Organization(name="Race Test VFD", slug=slug)
        deleter.add(org)
        await deleter.flush()
        template = EquipmentCheckTemplate(
            organization_id=org.id,
            name="Engine 1 Start-of-Shift",
            check_timing="start_of_shift",
        )
        deleter.add(template)
        await deleter.flush()
        root = CheckTemplateCompartment(template_id=template.id, name="Cabinet")
        other_root = CheckTemplateCompartment(
            template_id=template.id, name="Other Cabinet"
        )
        deleter.add_all([root, other_root])
        await deleter.flush()
        child = CheckTemplateCompartment(
            template_id=template.id,
            name="Drawer",
            parent_compartment_id=root.id,
        )
        deleter.add(child)
        await deleter.commit()
        org_id, root_id, other_root_id, child_id = (
            org.id,
            root.id,
            other_root.id,
            child.id,
        )
        try:
            service = EquipmentCheckService(deleter)
            # Establishes the deleter's REPEATABLE READ snapshot -- exactly
            # what delete_compartment's own first read (_get_compartment)
            # does -- *before* the child is reparented out of the subtree.
            compartment = await service._get_compartment(root_id, org_id)
            assert compartment is not None

            # A second, real, independently-committing session moves the
            # child out from under root, onto a different, still-live
            # compartment, after that snapshot.
            result = await mover.execute(
                select(CheckTemplateCompartment).where(
                    CheckTemplateCompartment.id == child_id
                )
            )
            moved = result.scalar_one()
            moved.parent_compartment_id = other_root_id
            await mover.commit()

            deleted = await service.delete_compartment(root_id, org_id)
            assert deleted is True

            verifier = database_manager.session_factory()
            try:
                survivor = await verifier.get(CheckTemplateCompartment, child_id)
                assert survivor is not None, (
                    "a compartment reparented out of the deleted subtree "
                    "mid-transaction was destroyed anyway -- AP-12 regressed"
                )
                assert survivor.parent_compartment_id == other_root_id
            finally:
                await verifier.close()
        finally:
            await deleter.rollback()
            await mover.rollback()
            await _teardown(org_id, [root_id, other_root_id, child_id])

    async def test_child_reparented_in_mid_transaction_is_deleted_not_orphaned(
        self, two_sessions
    ):
        deleter, mover = two_sessions
        slug = f"ap-race-in-{uuid.uuid4().hex[:12]}"
        org = Organization(name="Race Test VFD", slug=slug)
        deleter.add(org)
        await deleter.flush()
        template = EquipmentCheckTemplate(
            organization_id=org.id,
            name="Engine 1 Start-of-Shift",
            check_timing="start_of_shift",
        )
        deleter.add(template)
        await deleter.flush()
        root = CheckTemplateCompartment(template_id=template.id, name="Cabinet")
        # Starts as an unrelated, top-level compartment -- outside the
        # subtree at the moment the deleter's snapshot is taken.
        outsider = CheckTemplateCompartment(template_id=template.id, name="Loose Pouch")
        deleter.add_all([root, outsider])
        await deleter.commit()
        org_id, root_id, outsider_id = org.id, root.id, outsider.id
        try:
            service = EquipmentCheckService(deleter)
            compartment = await service._get_compartment(root_id, org_id)
            assert compartment is not None

            # A second, real, independently-committing session reparents the
            # outsider into the subtree being deleted, after that snapshot.
            result = await mover.execute(
                select(CheckTemplateCompartment).where(
                    CheckTemplateCompartment.id == outsider_id
                )
            )
            moved = result.scalar_one()
            moved.parent_compartment_id = root_id
            await mover.commit()

            deleted = await service.delete_compartment(root_id, org_id)
            assert deleted is True

            verifier = database_manager.session_factory()
            try:
                survivor = await verifier.get(CheckTemplateCompartment, outsider_id)
                assert survivor is None, (
                    "a compartment reparented into the deleted subtree "
                    "mid-transaction survived as an orphaned root -- "
                    "AP-12 regressed"
                )
            finally:
                await verifier.close()
        finally:
            await deleter.rollback()
            await mover.rollback()
            await _teardown(org_id, [root_id, outsider_id])
