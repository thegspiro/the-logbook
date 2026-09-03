"""AP-14 (Codex, on top of AP-12): ``_lock_compartment_subtree``'s locking
walk followed ``parent_compartment_id`` with no template (or organization)
boundary. ``add_compartment``/``update_compartment``/``create_template`` all
validate a *new or changed* ``parent_compartment_id`` is same-template and
same-org (AP-10) -- but that only prevents a cross-template link from being
written from now on. A row persisted before AP-10 shipped (simulated here by
writing it directly, the way a pre-AP-10 install's data would already look)
still carries a dangling cross-template ``parent_compartment_id``, and an
unscoped subtree walk would follow it: deleting a compartment in template A
would reach into -- and, via the bulk delete AP-12 added, permanently
destroy -- a compartment (and its items) belonging to template B, in this
org or another org entirely.

Mirrors ``documents_service.delete_folder``'s cross-org fail-closed check:
the fix aborts the whole delete (``ValueError`` -> 400 at the endpoint)
the moment the walk finds a descendant outside the owning template, rather
than silently sweeping it in or silently excluding it.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
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


async def _template(db_session, org_id, name="Template") -> EquipmentCheckTemplate:
    template = EquipmentCheckTemplate(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        check_timing="start_of_shift",
    )
    db_session.add(template)
    await db_session.flush()
    return template


class TestDeleteCompartmentRejectsCrossTemplateSubtree:
    async def test_cross_org_dangling_link_aborts_the_whole_delete(self, db_session):
        org_a = await _org(db_session, "Org A")
        org_b = await _org(db_session, "Org B")
        template_a = await _template(db_session, org_a.id, "Template A")
        template_b = await _template(db_session, org_b.id, "Template B")

        root = CheckTemplateCompartment(
            id=str(uuid.uuid4()), template_id=template_a.id, name="Root"
        )
        db_session.add(root)
        await db_session.flush()

        # Simulates a row persisted before AP-10's create-time validation
        # shipped: a different org's compartment dangling off this org's
        # root, written directly rather than through a validated write path.
        foreign = CheckTemplateCompartment(
            id=str(uuid.uuid4()),
            template_id=template_b.id,
            name="Org B compartment",
            parent_compartment_id=root.id,
        )
        db_session.add(foreign)
        await db_session.flush()
        foreign_item = CheckTemplateItem(
            id=str(uuid.uuid4()), compartment_id=foreign.id, name="Org B item"
        )
        db_session.add(foreign_item)
        await db_session.commit()
        root_id, foreign_id, foreign_item_id = root.id, foreign.id, foreign_item.id

        service = EquipmentCheckService(db_session)
        with pytest.raises(ValueError, match="cross-template"):
            await service.delete_compartment(root_id, org_a.id)
        await db_session.rollback()

        verifier = db_session
        for row_id, model in (
            (root_id, CheckTemplateCompartment),
            (foreign_id, CheckTemplateCompartment),
            (foreign_item_id, CheckTemplateItem),
        ):
            result = await verifier.execute(select(model).where(model.id == row_id))
            assert result.scalar_one_or_none() is not None, (
                f"{model.__name__} {row_id} was destroyed even though the "
                "delete should have aborted on the cross-template reference"
            )

    async def test_same_org_cross_template_dangling_link_aborts_the_whole_delete(
        self, db_session
    ):
        org = await _org(db_session, "Single Org")
        template_a = await _template(db_session, org.id, "Template A")
        template_b = await _template(db_session, org.id, "Template B")

        root = CheckTemplateCompartment(
            id=str(uuid.uuid4()), template_id=template_a.id, name="Root"
        )
        db_session.add(root)
        await db_session.flush()

        foreign = CheckTemplateCompartment(
            id=str(uuid.uuid4()),
            template_id=template_b.id,
            name="Template B compartment",
            parent_compartment_id=root.id,
        )
        db_session.add(foreign)
        await db_session.commit()
        root_id, foreign_id = root.id, foreign.id

        service = EquipmentCheckService(db_session)
        with pytest.raises(ValueError, match="cross-template"):
            await service.delete_compartment(root_id, org.id)
        await db_session.rollback()

        for row_id in (root_id, foreign_id):
            result = await db_session.execute(
                select(CheckTemplateCompartment).where(
                    CheckTemplateCompartment.id == row_id
                )
            )
            assert result.scalar_one_or_none() is not None, (
                f"compartment {row_id} was destroyed even though the delete "
                "should have aborted on the cross-template reference"
            )

    async def test_normal_same_template_subtree_still_deletes(self, db_session):
        """Sanity check the scoping does not block the ordinary case."""
        org = await _org(db_session, "Normal Org")
        template = await _template(db_session, org.id, "Normal Template")

        root = CheckTemplateCompartment(
            id=str(uuid.uuid4()), template_id=template.id, name="Root"
        )
        db_session.add(root)
        await db_session.flush()
        child = CheckTemplateCompartment(
            id=str(uuid.uuid4()),
            template_id=template.id,
            name="Child",
            parent_compartment_id=root.id,
        )
        db_session.add(child)
        await db_session.commit()
        root_id, child_id = root.id, child.id

        service = EquipmentCheckService(db_session)
        deleted = await service.delete_compartment(root_id, org.id)
        assert deleted is True

        for row_id in (root_id, child_id):
            result = await db_session.execute(
                select(CheckTemplateCompartment).where(
                    CheckTemplateCompartment.id == row_id
                )
            )
            assert result.scalar_one_or_none() is None
