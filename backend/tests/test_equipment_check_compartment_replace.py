"""Replacing a template's contents is one transaction, against a real database.

The builder's three bulk-replacement paths — vehicle preset, JSON import, CSV
import — each promise to discard everything currently on the template and load
the new set in its place. Both halves have to travel together.

Discarding on its own was the first fix and not enough: it commits an empty
template while the replacement exists only in the browser, so a closed tab or
a failed save in between costs the department the checklist it had, with the
screen still showing contents nothing has persisted. (Before that it was one
DELETE per compartment, which could not even discard atomically.)

So these cover the halves that make it safe to rely on: the swap happens as
one unit, and nothing is destroyed until every replacement the caller sent has
been accepted.
"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.inventory import InventoryItem
from app.models.user import Organization
from app.services.equipment_check_service import EquipmentCheckService

pytestmark = [pytest.mark.integration]


async def _org(db_session, name="Replace Department") -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"ecr-{uuid.uuid4().hex[:8]}",
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


def _entry(name, items=None, **extra):
    return {
        "name": name,
        "container_type": "compartment",
        "is_header": False,
        "is_sealed": False,
        "items": items or [],
        **extra,
    }


async def _names(db_session, template) -> list:
    result = await db_session.execute(
        select(CheckTemplateCompartment.name)
        .where(CheckTemplateCompartment.template_id == template.id)
        .order_by(CheckTemplateCompartment.sort_order)
    )
    return list(result.scalars().all())


async def _compartment_count(db_session, template) -> int:
    result = await db_session.execute(
        select(func.count(CheckTemplateCompartment.id)).where(
            CheckTemplateCompartment.template_id == template.id
        )
    )
    return result.scalar() or 0


class TestReplaceCompartments:
    async def test_the_old_contents_go_and_the_new_ones_arrive_together(
        self, db_session
    ):
        org = await _org(db_session)
        template = await _template(db_session, org)
        cab = await _compartment(db_session, template, "Cab", 0)
        pump = await _compartment(db_session, template, "Pump panel", 1)

        service = EquipmentCheckService(db_session)
        result = await service.replace_compartments(
            template.id,
            org.id,
            [
                _entry("Front bumper", [{"name": "Hydrant wrench"}]),
                _entry("Hose bed", [{"name": "Attack line"}, {"name": "Nozzle"}]),
            ],
        )

        assert result is not None
        discarded, created = result
        assert sorted(name for _, name in discarded) == ["Cab", "Pump panel"]
        assert [comp.name for comp in created] == ["Front bumper", "Hose bed"]
        # Order comes from the list the caller sent, not from a sort_order the
        # entries never set — a preset describes a sequence.
        assert await _names(db_session, template) == ["Front bumper", "Hose bed"]
        assert [len(comp.items) for comp in created] == [1, 2]

        orphans = await db_session.execute(
            select(func.count(CheckTemplateItem.id)).where(
                CheckTemplateItem.compartment_id.in_([cab.id, pump.id])
            )
        )
        assert orphans.scalar() == 0

    async def test_an_empty_replacement_clears_the_template(self, db_session):
        """The CSV and JSON paths can legitimately import nothing."""
        org = await _org(db_session)
        template = await _template(db_session, org)
        await _compartment(db_session, template, "Cab", 0)

        service = EquipmentCheckService(db_session)
        result = await service.replace_compartments(template.id, org.id, [])

        assert result is not None
        discarded, created = result
        assert [name for _, name in discarded] == ["Cab"]
        assert created == []
        assert await _compartment_count(db_session, template) == 0

    async def test_a_rejected_item_leaves_the_old_contents_standing(self, db_session):
        """The reason both halves are one call.

        Validation runs before a single row is deleted, so a replacement the
        server will not accept costs the department nothing. Deleting first
        and discovering the bad reference afterwards would leave the template
        empty with the replacement nowhere.
        """
        org = await _org(db_session)
        other = await _org(db_session, "Somebody Else FD")
        template = await _template(db_session, org)
        await _compartment(db_session, template, "Cab", 0)

        foreign_item = InventoryItem(
            id=str(uuid.uuid4()),
            organization_id=other.id,
            name="Their spanner",
        )
        db_session.add(foreign_item)
        await db_session.flush()

        service = EquipmentCheckService(db_session)
        with pytest.raises(ValueError, match="Invalid inventory item"):
            await service.replace_compartments(
                template.id,
                org.id,
                [
                    _entry("Front bumper"),
                    _entry(
                        "Hose bed",
                        [{"name": "Attack line", "inventory_item_id": foreign_item.id}],
                    ),
                ],
            )

        assert await _names(db_session, template) == ["Cab"]

    async def test_a_parent_reference_is_refused_before_anything_is_deleted(
        self, db_session
    ):
        """Every compartment is being replaced, so a parent id could only name
        a row this same call is deleting."""
        org = await _org(db_session)
        template = await _template(db_session, org)
        cab = await _compartment(db_session, template, "Cab", 0)

        service = EquipmentCheckService(db_session)
        with pytest.raises(ValueError, match="cannot name a parent"):
            await service.replace_compartments(
                template.id,
                org.id,
                [_entry("Front bumper", parent_compartment_id=cab.id)],
            )

        assert await _names(db_session, template) == ["Cab"]

    async def test_another_org_cannot_replace_a_template(self, db_session):
        org = await _org(db_session)
        intruder = await _org(db_session, "Intruder FD")
        template = await _template(db_session, org)
        await _compartment(db_session, template, "Cab", 0)

        service = EquipmentCheckService(db_session)
        assert (
            await service.replace_compartments(
                template.id, intruder.id, [_entry("Front bumper")]
            )
            is None
        )
        assert await _names(db_session, template) == ["Cab"]
