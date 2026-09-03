"""AP-13 finding 2 (AP-10 in the doc): making
``CheckTemplateCompartment.children``'s cascade genuinely effective (AP-8,
``test_apparatus_check_template_compartment_cascade.py``) turns an
unvalidated ``parent_compartment_id`` on the create path into a genuine
multi-tenant isolation break (CLAUDE.md Pitfall #14c).

``create_template`` forwarded every request-supplied
``parent_compartment_id`` straight through ``_create_compartment`` with no
validation that the referenced parent belongs to the same template or
organization -- unlike ``add_compartment`` and ``update_compartment``, which
both already validate this. Since the cascade is now genuinely destructive,
an unvalidated cross-template (or cross-org) parent link lets deleting a
compartment in template A cascade-delete a compartment -- and all its items
-- that actually belongs to template B, potentially in a different
organization. Confirmed live below, pre-fix (both tests fail with a
``MissingGreenlet`` one level removed: the malformed row's write succeeds,
and the subsequent ``get_template`` refetch is what trips over the
unvalidated ``.children`` shape AP-9 also covers), before being fixed by
applying the same same-template/organization validation ``add_compartment``
already does to the create path.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.apparatus import CheckTemplateCompartment, EquipmentCheckTemplate
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


class TestCreateTemplateRejectsCrossTemplateParent:
    """create_template must validate parent_compartment_id in-template/
    in-org, matching add_compartment/update_compartment."""

    async def test_cross_org_parent_is_rejected(self, db_session):
        org_a = await _org(db_session, "Org A")
        org_b = await _org(db_session, "Org B")

        template_b = EquipmentCheckTemplate(
            id=str(uuid.uuid4()),
            organization_id=org_b.id,
            name="Org B template",
            check_timing="start_of_shift",
        )
        db_session.add(template_b)
        await db_session.flush()

        foreign_compartment = CheckTemplateCompartment(
            id=str(uuid.uuid4()), template_id=template_b.id, name="Org B compartment"
        )
        db_session.add(foreign_compartment)
        await db_session.commit()

        service = EquipmentCheckService(db_session)
        with pytest.raises(ValueError, match="same template"):
            await service.create_template(
                org_a.id,
                created_by=None,
                data={
                    "name": "Org A template",
                    "check_timing": "start_of_shift",
                    "compartments": [
                        {
                            "name": "Malicious child",
                            "parent_compartment_id": foreign_compartment.id,
                        }
                    ],
                },
            )

        # Nothing from the rejected request was persisted.
        result = await db_session.execute(
            select(CheckTemplateCompartment).where(
                CheckTemplateCompartment.name == "Malicious child"
            )
        )
        assert result.scalars().first() is None

    async def test_cross_template_same_org_parent_is_rejected(self, db_session):
        org = await _org(db_session, "Single Org")

        other_template = EquipmentCheckTemplate(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Other template",
            check_timing="start_of_shift",
        )
        db_session.add(other_template)
        await db_session.flush()

        other_compartment = CheckTemplateCompartment(
            id=str(uuid.uuid4()),
            template_id=other_template.id,
            name="Other compartment",
        )
        db_session.add(other_compartment)
        await db_session.commit()

        service = EquipmentCheckService(db_session)
        with pytest.raises(ValueError, match="same template"):
            await service.create_template(
                org.id,
                created_by=None,
                data={
                    "name": "New template",
                    "check_timing": "start_of_shift",
                    "compartments": [
                        {
                            "name": "Cross-template child",
                            "parent_compartment_id": other_compartment.id,
                        }
                    ],
                },
            )

    async def test_null_parent_is_still_allowed(self, db_session):
        """Sanity check the validation does not block the normal case."""
        org = await _org(db_session, "Normal Org")

        service = EquipmentCheckService(db_session)
        template = await service.create_template(
            org.id,
            created_by=None,
            data={
                "name": "Normal template",
                "check_timing": "start_of_shift",
                "compartments": [{"name": "Top-level compartment"}],
            },
        )
        assert len(template.compartments) == 1
        assert template.compartments[0].parent_compartment_id is None
