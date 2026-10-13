"""The department-wide catalog link report, and applying it across templates.

The per-template match tool asks "which catalog item is 4x4 gauze" once per
rig. The report groups every unlinked position in the department by name so
the answer is given once and lands on every template that carries the line.
"""

import uuid

import pytest
from sqlalchemy import select, text

from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
    TemplateChangeLog,
)
from app.models.inventory import InventoryItem
from app.models.user import Organization
from app.services.equipment_check_service import EquipmentCheckService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db_session, name="Org") -> Organization:
    org = Organization(
        id=_uid(), name=name, slug=f"{name.lower()}-{uuid.uuid4().hex[:8]}"
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org_id: str) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Pat', 'Officer', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u{user_id[:8]}",
            "em": f"{user_id[:8]}@test.com",
        },
    )
    await db_session.flush()
    return user_id


async def _template(db_session, org_id, name, items, *, active=True):
    """A template with one compartment holding ``items`` as (name, type, link)."""
    template = EquipmentCheckTemplate(
        id=_uid(),
        organization_id=org_id,
        name=name,
        check_timing="start_of_shift",
        is_active=active,
    )
    db_session.add(template)
    await db_session.flush()
    compartment = CheckTemplateCompartment(
        id=_uid(), template_id=template.id, name="Jump Bag"
    )
    db_session.add(compartment)
    await db_session.flush()
    created = []
    for order, (item_name, check_type, link) in enumerate(items):
        item = CheckTemplateItem(
            id=_uid(),
            compartment_id=compartment.id,
            name=item_name,
            check_type=check_type,
            sort_order=order,
            inventory_item_id=link,
        )
        db_session.add(item)
        created.append(item)
    await db_session.flush()
    return template, created


async def _catalog(db_session, org_id, name) -> InventoryItem:
    item = InventoryItem(id=_uid(), organization_id=org_id, name=name, active=True)
    db_session.add(item)
    await db_session.flush()
    return item


class TestLinkReport:
    async def test_one_name_on_many_templates_is_one_group(self, db_session):
        org = await _org(db_session)
        await _catalog(db_session, org.id, "Gauze Pads 4x4")
        await _template(
            db_session, org.id, "Medic 1", [("Gauze Pads 4x4", "count", None)]
        )
        await _template(
            db_session,
            org.id,
            "Medic 2",
            [("gauze pads, 4x4", "count", None)],
            active=False,
        )

        report = await EquipmentCheckService(db_session).get_link_report(org.id)

        assert len(report["groups"]) == 1
        group = report["groups"][0]
        assert group["position_count"] == 2
        assert group["template_count"] == 2
        assert {p["template_active"] for p in group["positions"]} == {True, False}
        assert group["suggestions"][0]["confidence"] == "exact"

    async def test_the_most_common_spelling_names_the_group(self, db_session):
        org = await _org(db_session)
        for rig in ("E1", "E2"):
            await _template(
                db_session, org.id, rig, [("Trauma Shears", "function", None)]
            )
        await _template(db_session, org.id, "E3", [("trauma shears", "function", None)])

        report = await EquipmentCheckService(db_session).get_link_report(org.id)

        assert report["groups"][0]["name"] == "Trauma Shears"

    async def test_coverage_counts_linked_and_skips_headers(self, db_session):
        org = await _org(db_session)
        cat = await _catalog(db_session, org.id, "OPA Kit")
        await _template(
            db_session,
            org.id,
            "Medic 1",
            [
                ("Airway", "header", None),
                ("OPA Kit", "count", cat.id),
                ("NPA Kit", "count", None),
            ],
        )

        report = await EquipmentCheckService(db_session).get_link_report(org.id)

        assert report["coverage"] == {"linkable": 2, "linked": 1, "unlinked": 1}
        assert [g["name"] for g in report["groups"]] == ["NPA Kit"]
        assert report["template_count"] == 1

    async def test_names_with_no_catalog_match_come_last(self, db_session):
        org = await _org(db_session)
        await _catalog(db_session, org.id, "Gauze Pads 4x4")
        await _template(
            db_session,
            org.id,
            "Medic 1",
            [
                ("Check tire pressure", "function", None),
                ("Gauze Pads 4x4", "count", None),
            ],
        )

        report = await EquipmentCheckService(db_session).get_link_report(org.id)

        assert [g["name"] for g in report["groups"]] == [
            "Gauze Pads 4x4",
            "Check tire pressure",
        ]
        assert report["groups"][1]["suggestions"] == []

    async def test_another_departments_templates_and_catalog_are_not_seen(
        self, db_session
    ):
        org = await _org(db_session, "Ours")
        other = await _org(db_session, "Theirs")
        await _catalog(db_session, other.id, "Gauze Pads 4x4")
        await _template(db_session, other.id, "Their rig", [("Splint", "count", None)])
        await _template(
            db_session, org.id, "Our rig", [("Gauze Pads 4x4", "count", None)]
        )

        report = await EquipmentCheckService(db_session).get_link_report(org.id)

        assert [g["name"] for g in report["groups"]] == ["Gauze Pads 4x4"]
        assert report["groups"][0]["suggestions"] == []


class TestLinkAcrossTemplates:
    async def test_links_every_position_and_logs_each_template(self, db_session):
        org = await _org(db_session)
        user_id = await _user(db_session, org.id)
        cat = await _catalog(db_session, org.id, "Gauze Pads 4x4")
        t1, (a,) = await _template(
            db_session, org.id, "Medic 1", [("Gauze", "count", None)]
        )
        t2, (b,) = await _template(
            db_session, org.id, "Medic 2", [("Gauze", "count", None)]
        )

        result = await EquipmentCheckService(
            db_session
        ).link_inventory_items_across_templates(
            org.id, {a.id: cat.id, b.id: cat.id}, user_id=user_id, user_name="Pat"
        )

        assert result == {"linked": 2, "skipped": 0}
        assert a.inventory_item_id == cat.id
        assert b.inventory_item_id == cat.id
        logged = await db_session.execute(
            select(TemplateChangeLog.template_id).where(
                TemplateChangeLog.entity_id.in_([a.id, b.id])
            )
        )
        assert set(logged.scalars().all()) == {t1.id, t2.id}

    async def test_a_position_linked_meanwhile_is_skipped_not_overwritten(
        self, db_session
    ):
        org = await _org(db_session)
        user_id = await _user(db_session, org.id)
        chosen = await _catalog(db_session, org.id, "Gauze Pads 4x4 Sterile")
        offered = await _catalog(db_session, org.id, "Gauze Pads 4x4")
        _, (item,) = await _template(
            db_session, org.id, "Medic 1", [("Gauze", "count", chosen.id)]
        )

        result = await EquipmentCheckService(
            db_session
        ).link_inventory_items_across_templates(
            org.id, {item.id: offered.id}, user_id=user_id, user_name="Pat"
        )

        assert result == {"linked": 0, "skipped": 1}
        assert item.inventory_item_id == chosen.id

    async def test_another_departments_inventory_item_is_refused(self, db_session):
        org = await _org(db_session, "Ours")
        other = await _org(db_session, "Theirs")
        user_id = await _user(db_session, org.id)
        foreign = await _catalog(db_session, other.id, "Gauze")
        _, (item,) = await _template(
            db_session, org.id, "Medic 1", [("Gauze", "count", None)]
        )

        with pytest.raises(ValueError, match="not in your inventory"):
            await EquipmentCheckService(
                db_session
            ).link_inventory_items_across_templates(
                org.id, {item.id: foreign.id}, user_id=user_id, user_name="Pat"
            )
        assert item.inventory_item_id is None

    async def test_another_departments_checklist_item_is_refused(self, db_session):
        org = await _org(db_session, "Ours")
        other = await _org(db_session, "Theirs")
        user_id = await _user(db_session, org.id)
        ours = await _catalog(db_session, org.id, "Gauze")
        _, (theirs,) = await _template(
            db_session, other.id, "Their rig", [("Gauze", "count", None)]
        )

        with pytest.raises(ValueError, match="not found"):
            await EquipmentCheckService(
                db_session
            ).link_inventory_items_across_templates(
                org.id, {theirs.id: ours.id}, user_id=user_id, user_name="Pat"
            )
        assert theirs.inventory_item_id is None
