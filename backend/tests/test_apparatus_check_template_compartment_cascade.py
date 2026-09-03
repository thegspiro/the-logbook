"""AP-8: ``CheckTemplateCompartment.children`` had the same inverted
self-referential shape FAC-16 found and fixed on ``DocumentFolder.children``
(``docs/security-review/FAC-12-facilities.md``, flagged there as a sibling
instance out of scope for that feature) -- ``remote_side`` declared on the
plural ``children`` relationship instead of on its singular ``parent``
backref.

Reproduced live against a real database, not inferred from reading the model:
a three-level compartment hierarchy (root -> child -> grandchild), deleted at
the root exactly the way ``EquipmentCheckService.delete_compartment`` does it
(``await self.db.delete(compartment)``, a pure ORM cascade with no
DB-level ``ON DELETE CASCADE`` on ``parent_compartment_id`` -- that FK is
``ondelete="SET NULL"``, so the database itself would only null the column,
never delete the row; the ORM's own ``cascade="all, delete-orphan"`` is the
only thing that is supposed to remove the descendants).
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.apparatus import CheckTemplateCompartment, EquipmentCheckTemplate
from app.models.user import Organization

pytestmark = [pytest.mark.integration]


async def _template(db_session, name="Cascade Department") -> EquipmentCheckTemplate:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"ap-cascade-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()

    template = EquipmentCheckTemplate(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Engine 1 Start-of-Shift",
        check_timing="start_of_shift",
    )
    db_session.add(template)
    await db_session.flush()
    return template


class TestCompartmentDeleteCascadesToDescendants:
    """Positive control, mirroring
    ``TestFolderMutationRespectsOwnFolderAcl::test_a_same_org_subtree_still_deletes_normally``
    for the folder tree: deleting the root of a same-tenant subtree must
    remove every descendant, not orphan them.
    """

    async def test_deleting_root_compartment_removes_the_whole_subtree(
        self, db_session
    ):
        template = await _template(db_session)

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
        await db_session.flush()

        grandchild = CheckTemplateCompartment(
            id=str(uuid.uuid4()),
            template_id=template.id,
            name="Pouch",
            parent_compartment_id=child.id,
        )
        db_session.add(grandchild)
        await db_session.flush()

        root_id, child_id, grandchild_id = root.id, child.id, grandchild.id

        # The exact operation EquipmentCheckService.delete_compartment
        # performs: an ORM-level delete, relying on the relationship's own
        # cascade="all, delete-orphan" to remove descendants -- there is no
        # DB-level ON DELETE CASCADE on parent_compartment_id to fall back on
        # (it is ondelete="SET NULL").
        await db_session.delete(root)
        await db_session.commit()

        for row_id in (root_id, child_id, grandchild_id):
            result = await db_session.execute(
                select(CheckTemplateCompartment).where(
                    CheckTemplateCompartment.id == row_id
                )
            )
            assert (
                result.scalar_one_or_none() is None
            ), f"compartment {row_id} survived the cascade delete of its ancestor"
