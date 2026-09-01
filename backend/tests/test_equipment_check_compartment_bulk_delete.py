"""Clearing a template's contents is one transaction, against a real database.

The builder's three bulk-replacement paths — vehicle preset, JSON import, CSV
import — each promise to discard everything currently on the template before
loading the new set. Driving that as one DELETE per compartment commits each
one separately: a failure on the third leaves the first two gone from the
server with no way back, while the builder still shows all of them.

So the deletion is a single call. These cover the two halves that make it safe
to rely on: it removes every named compartment, and it removes *none* of them
when an id does not belong to the template.
"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.user import Organization
from app.services.equipment_check_service import EquipmentCheckService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Bulk Delete Department",
        slug=f"ecbd-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _template(db_session, org, name="Engine 1 — Daily") -> EquipmentCheckTemplate:
    template = EquipmentCheckTemplate(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        check_timing="start_of_shift",
    )
    db_session.add(template)
    await db_session.flush()
    return template


async def _compartment(db_session, template, name, sort_order=0):
    comp = CheckTemplateCompartment(
        id=str(uuid.uuid4()),
        template_id=template.id,
        name=name,
        sort_order=sort_order,
    )
    db_session.add(comp)
    await db_session.flush()
    db_session.add(
        CheckTemplateItem(
            id=str(uuid.uuid4()),
            compartment_id=comp.id,
            name=f"{name} item",
            sort_order=0,
            check_type="function",
        )
    )
    await db_session.flush()
    return comp


async def _compartment_count(db_session, template) -> int:
    result = await db_session.execute(
        select(func.count(CheckTemplateCompartment.id)).where(
            CheckTemplateCompartment.template_id == template.id
        )
    )
    return result.scalar() or 0


class TestDeleteCompartmentsBulk:
    async def test_removes_every_named_compartment_and_its_items(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        cab = await _compartment(db_session, template, "Cab", 0)
        pump = await _compartment(db_session, template, "Pump panel", 1)

        service = EquipmentCheckService(db_session)
        deleted = await service.delete_compartments_bulk(
            template.id, org.id, [cab.id, pump.id]
        )

        assert sorted(deleted) == sorted([cab.id, pump.id])
        assert await _compartment_count(db_session, template) == 0
        items = await db_session.execute(
            select(func.count(CheckTemplateItem.id)).where(
                CheckTemplateItem.compartment_id.in_([cab.id, pump.id])
            )
        )
        assert items.scalar() == 0

    async def test_a_retry_after_a_lost_response_succeeds(self, db_session):
        """The server commits, the response never arrives, the builder reports
        failure — and it still holds every old compartment id. Rejecting an id
        that no longer exists made the retry fail too, and the only way out
        was a reload that revealed the template had been emptied.
        """
        org = await _org(db_session)
        template = await _template(db_session, org)
        cab = await _compartment(db_session, template, "Cab", 0)

        service = EquipmentCheckService(db_session)
        assert await service.delete_compartments_bulk(template.id, org.id, [cab.id])

        # The same request again, as the builder would send it.
        assert (
            await service.delete_compartments_bulk(template.id, org.id, [cab.id]) == []
        )
        assert await _compartment_count(db_session, template) == 0

    async def test_a_foreign_id_deletes_nothing_at_all(self, db_session):
        """The whole point of the single call: all or none.

        A per-compartment loop would already have committed the valid deletes
        before reaching the id it cannot accept. Distinct from an id that
        resolves to nothing, which is treated as already deleted: this one
        names something real on another template.
        """
        org = await _org(db_session)
        template = await _template(db_session, org)
        other = await _template(db_session, org, "Ladder — Daily")
        cab = await _compartment(db_session, template, "Cab", 0)
        elsewhere = await _compartment(db_session, other, "Turntable", 0)

        service = EquipmentCheckService(db_session)
        with pytest.raises(ValueError, match="belong to the specified template"):
            await service.delete_compartments_bulk(
                template.id, org.id, [cab.id, elsewhere.id]
            )

        assert await _compartment_count(db_session, template) == 1
        assert await _compartment_count(db_session, other) == 1

    async def test_another_org_cannot_clear_a_template(self, db_session):
        org = await _org(db_session)
        intruder = await _org(db_session)
        template = await _template(db_session, org)
        cab = await _compartment(db_session, template, "Cab", 0)

        service = EquipmentCheckService(db_session)
        assert (
            await service.delete_compartments_bulk(template.id, intruder.id, [cab.id])
            is None
        )
        assert await _compartment_count(db_session, template) == 1

    async def test_a_duplicated_id_is_rejected_rather_than_counted_twice(
        self, db_session
    ):
        org = await _org(db_session)
        template = await _template(db_session, org)
        cab = await _compartment(db_session, template, "Cab", 0)

        service = EquipmentCheckService(db_session)
        with pytest.raises(ValueError, match="unique"):
            await service.delete_compartments_bulk(
                template.id, org.id, [cab.id, cab.id]
            )
        assert await _compartment_count(db_session, template) == 1
