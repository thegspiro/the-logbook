"""AP-13 finding 1 (AP-9 in the doc): making
``CheckTemplateCompartment.children``'s cascade genuinely effective (AP-8,
``test_apparatus_check_template_compartment_cascade.py``) exposed a dormant
bug in ``EquipmentCheckService.clone_template``, masked until now by the
previously inverted (no-op) cascade.

``clone_template`` walked each source compartment's ``.children`` to clone a
nested template. ``get_template`` only eager-loads (``selectinload``) each
compartment's ``.items``, never ``.children`` -- with ``children`` now a real
relationship, touching it outside the awaited context raises
``MissingGreenlet`` under ``AsyncSession``, so cloning any template with a
nested compartment 500s. Confirmed live below, pre-fix, before being fixed by
cloning from the already-loaded flat ``source.compartments`` collection
instead of walking ``.children``.

A second, independent bug found in the same code while fixing the first:
the outer loop in ``clone_template`` iterated the template's flat
``compartments`` collection (every compartment, root or nested) and called
``_clone_compartment(..., parent_id=None)`` for each one, while
``_clone_compartment`` itself also recursed into ``.children`` -- so every
nested compartment was cloned twice (once wrongly promoted to a root, once
correctly nested). The regression test below asserts the exact post-clone
compartment count to cover a reintroduction of either bug.
"""

import uuid

import pytest

from app.models.apparatus import (
    Apparatus,
    ApparatusStatus,
    ApparatusType,
    CheckTemplateCompartment,
    EquipmentCheckTemplate,
)
from app.models.user import Organization
from app.services.equipment_check_service import EquipmentCheckService

pytestmark = [pytest.mark.integration]


async def _org(db_session, name="Org") -> Organization:
    org = Organization(
        id=str(uuid.uuid4()), name=name, slug=f"{name.lower()}-{uuid.uuid4().hex[:8]}"
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _apparatus(db_session, org: Organization) -> Apparatus:
    apparatus_type = ApparatusType(
        id=str(uuid.uuid4()), organization_id=org.id, name="Engine", code="ENG"
    )
    apparatus_status = ApparatusStatus(
        id=str(uuid.uuid4()), organization_id=org.id, name="In Service", code="IS"
    )
    db_session.add(apparatus_type)
    db_session.add(apparatus_status)
    await db_session.flush()

    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number="Engine 1",
        apparatus_type_id=apparatus_type.id,
        status_id=apparatus_status.id,
    )
    db_session.add(apparatus)
    await db_session.flush()
    return apparatus


class TestCloneTemplatePreservesNestedCompartments:
    """Cloning a template with nested compartments must not 500, and must
    not duplicate the nested compartment."""

    async def test_clone_template_with_nested_compartment_succeeds(self, db_session):
        org = await _org(db_session, "Clone Org")
        apparatus = await _apparatus(db_session, org)

        template = EquipmentCheckTemplate(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Source template",
            check_timing="start_of_shift",
        )
        db_session.add(template)
        await db_session.flush()

        root = CheckTemplateCompartment(
            id=str(uuid.uuid4()), template_id=template.id, name="Cabinet"
        )
        db_session.add(root)
        await db_session.flush()
        child = CheckTemplateCompartment(
            id=str(uuid.uuid4()),
            template_id=template.id,
            name="Drawer",
            parent_compartment_id=root.id,
        )
        db_session.add(child)
        await db_session.commit()

        service = EquipmentCheckService(db_session)
        # Pre-fix, this raises sqlalchemy.exc.MissingGreenlet -- the source
        # of the clone endpoint's 500 for any template with nested
        # compartments.
        cloned = await service.clone_template(
            template.id, org.id, apparatus.id, created_by=None
        )

        assert cloned is not None
        # Exactly one root and one child -- not the previous
        # every-compartment-as-a-root loop's duplicate clone of the nested
        # compartment (once as a wrongly-promoted root, once via the old
        # recursive .children walk).
        assert len(cloned.compartments) == 2
        cloned_root = next(
            c for c in cloned.compartments if c.parent_compartment_id is None
        )
        cloned_child = next(
            c for c in cloned.compartments if c.parent_compartment_id is not None
        )
        assert cloned_root.name == "Cabinet"
        assert cloned_child.name == "Drawer"
        assert cloned_child.parent_compartment_id == cloned_root.id
        # The clone is a distinct row, not the source re-parented.
        assert cloned_root.id != root.id
        assert cloned_child.id != child.id


class TestCloneTemplateRejectsDisconnectedCompartments:
    """AP-16 (Codex, on top of AP-14): a compartment whose
    parent_compartment_id points outside the source template (a dangling
    cross-template reference, simulating a row persisted before AP-10's
    create-time validation shipped) must not be silently dropped from the
    clone."""

    async def test_clone_aborts_rather_than_silently_omit_a_disconnected_compartment(
        self, db_session
    ):
        org = await _org(db_session, "Clone Org")
        apparatus = await _apparatus(db_session, org)

        template = EquipmentCheckTemplate(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Source template",
            check_timing="start_of_shift",
        )
        other_template = EquipmentCheckTemplate(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Unrelated template",
            check_timing="start_of_shift",
        )
        db_session.add_all([template, other_template])
        await db_session.flush()

        root = CheckTemplateCompartment(
            id=str(uuid.uuid4()), template_id=template.id, name="Cabinet"
        )
        # A compartment from a *different* template -- the dangling link
        # AP-10's validation now prevents on write, simulated here as a row
        # that already exists.
        foreign_parent = CheckTemplateCompartment(
            id=str(uuid.uuid4()),
            template_id=other_template.id,
            name="Foreign parent",
        )
        db_session.add_all([root, foreign_parent])
        await db_session.flush()
        # Disconnected: its parent_compartment_id names a row outside
        # `template`, so it is unreachable from the clone's root-down walk.
        disconnected = CheckTemplateCompartment(
            id=str(uuid.uuid4()),
            template_id=template.id,
            name="Disconnected drawer",
            parent_compartment_id=foreign_parent.id,
        )
        db_session.add(disconnected)
        await db_session.commit()

        service = EquipmentCheckService(db_session)
        with pytest.raises(ValueError, match="disconnected"):
            await service.clone_template(
                template.id, org.id, apparatus.id, created_by=None
            )

        # Nothing from the aborted clone was committed -- no new template
        # exists with "Cabinet" as a child, partial or otherwise.
        source = await service.get_template(template.id, org.id)
        assert source is not None
        assert len(source.compartments) == 2
