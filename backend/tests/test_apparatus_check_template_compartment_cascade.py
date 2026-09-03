"""AP-8: ``CheckTemplateCompartment.children`` had the same inverted
self-referential shape FAC-16 found and fixed on ``DocumentFolder.children``
(``docs/security-review/FAC-12-facilities.md``, flagged there as a sibling
instance out of scope for that feature) -- ``remote_side`` declared on the
plural ``children`` relationship instead of on its singular ``parent``
backref.

Reproduced live against a real database, not inferred from reading the model:
a three-level compartment hierarchy (root -> child -> grandchild), deleted at
the root exactly the way ``EquipmentCheckService.delete_compartment`` does it.

AP-12 (Codex, on top of AP-8) changed what that "exact way" is: the service
no longer relies on a bare ``await self.db.delete(compartment)`` and the
ORM's own ``children`` cascade (which lazy-loads off a possibly-stale
REPEATABLE READ snapshot -- see
``tests/test_apparatus_check_template_compartment_race.py``). It now locks
the subtree with a fresh, level-by-level ``FOR UPDATE`` walk
(``_lock_compartment_subtree``) and deletes it as one explicit bulk
statement against that authoritative id set.
``CheckTemplateCompartment.children`` also gained ``passive_deletes=True``
as part of that fix, which means a *bare* ``session.delete(compartment)`` --
this test's original approach -- no longer cascades to descendants at all:
with passive_deletes on, the ORM defers entirely to the database's own
``ondelete`` action, and ``parent_compartment_id`` is ``ondelete="SET
NULL"``, not ``CASCADE``, so a bare ORM delete now only orphans the subtree.
Exercising the actual service method (rather than a hand-rolled ORM delete)
is therefore not just closer to production, it is now the only way this
positive control can pass at all.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.apparatus import CheckTemplateCompartment, EquipmentCheckTemplate
from app.models.user import Organization
from app.services.equipment_check_service import EquipmentCheckService

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
        organization_id = template.organization_id

        # The actual service method, not a hand-rolled ORM delete: AP-12
        # moved the descendant-removal mechanism off the ORM's own
        # (possibly stale) ``children`` cascade and onto an explicit,
        # locked bulk delete -- see this file's module docstring.
        deleted = await EquipmentCheckService(db_session).delete_compartment(
            root_id, organization_id
        )
        assert deleted is True

        for row_id in (root_id, child_id, grandchild_id):
            result = await db_session.execute(
                select(CheckTemplateCompartment).where(
                    CheckTemplateCompartment.id == row_id
                )
            )
            assert (
                result.scalar_one_or_none() is None
            ), f"compartment {row_id} survived the cascade delete of its ancestor"
