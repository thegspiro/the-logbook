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

        assert result == {"linked": 2, "skipped": 0, "skipped_positions": []}
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

        assert result["linked"] == 0
        assert result["skipped"] == 1
        assert item.inventory_item_id == chosen.id

    async def test_a_skipped_position_says_where_it_is_and_both_items(self, db_session):
        org = await _org(db_session)
        user_id = await _user(db_session, org.id)
        current = await _catalog(db_session, org.id, "Gauze Pads 4x4 Sterile")
        offered = await _catalog(db_session, org.id, "Gauze Pads 4x4")
        template, (taken, free) = await _template(
            db_session,
            org.id,
            "Medic 1",
            [("Gauze", "count", current.id), ("Gauze", "count", None)],
        )

        result = await EquipmentCheckService(
            db_session
        ).link_inventory_items_across_templates(
            org.id,
            {taken.id: offered.id, free.id: offered.id},
            user_id=user_id,
            user_name="Pat",
        )

        assert result["linked"] == 1
        assert result["skipped_positions"] == [
            {
                "template_item_id": taken.id,
                "item_name": "Gauze",
                "template_id": template.id,
                "template_name": "Medic 1",
                "compartment_name": "Jump Bag",
                "current_inventory_item_id": current.id,
                "current_inventory_item_name": "Gauze Pads 4x4 Sterile",
                "chosen_inventory_item_id": offered.id,
                "chosen_inventory_item_name": "Gauze Pads 4x4",
            }
        ]

    async def test_nothing_skipped_lists_nothing(self, db_session):
        org = await _org(db_session)
        user_id = await _user(db_session, org.id)
        cat = await _catalog(db_session, org.id, "Gauze")
        _, (item,) = await _template(
            db_session, org.id, "Medic 1", [("Gauze", "count", None)]
        )

        result = await EquipmentCheckService(
            db_session
        ).link_inventory_items_across_templates(
            org.id, {item.id: cat.id}, user_id=user_id, user_name="Pat"
        )

        assert result == {"linked": 1, "skipped": 0, "skipped_positions": []}

    async def test_a_current_link_outside_the_org_is_not_named(self, db_session):
        org = await _org(db_session, "Ours")
        other = await _org(db_session, "Theirs")
        user_id = await _user(db_session, org.id)
        foreign = await _catalog(db_session, other.id, "Their Gauze")
        ours = await _catalog(db_session, org.id, "Gauze")
        _, (item,) = await _template(
            db_session, org.id, "Medic 1", [("Gauze", "count", foreign.id)]
        )

        result = await EquipmentCheckService(
            db_session
        ).link_inventory_items_across_templates(
            org.id, {item.id: ours.id}, user_id=user_id, user_name="Pat"
        )

        (entry,) = result["skipped_positions"]
        assert entry["current_inventory_item_name"] is None
        assert entry["chosen_inventory_item_name"] == "Gauze"

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


class TestAutoLink:
    """The one-click pass: exact and strong matches, never a tie."""

    async def _run(self, db_session, org_id):
        user_id = await _user(db_session, org_id)
        return await EquipmentCheckService(db_session).auto_link_report(
            org_id, user_id=user_id, user_name="Pat Officer"
        )

    async def _link_of(self, db_session, item_id):
        return await db_session.scalar(
            select(CheckTemplateItem.inventory_item_id).where(
                CheckTemplateItem.id == item_id
            )
        )

    async def test_an_exact_match_is_linked_on_every_template(self, db_session):
        org = await _org(db_session)
        gauze = await _catalog(db_session, org.id, "Gauze Pads 4x4")
        _, (first,) = await _template(
            db_session, org.id, "Medic 1", [("Gauze Pads 4x4", "count", None)]
        )
        _, (second,) = await _template(
            db_session,
            org.id,
            "Medic 2",
            [("gauze pads, 4x4", "count", None)],
            active=False,
        )

        result = await self._run(db_session, org.id)

        assert result["linked"] == 2
        assert result["left_for_review"] == 0
        assert [g["confidence"] for g in result["groups"]] == ["exact"]
        assert await self._link_of(db_session, first.id) == gauze.id
        assert await self._link_of(db_session, second.id) == gauze.id

    async def test_a_strong_match_through_an_alias_is_linked(self, db_session):
        org = await _org(db_session)
        bvm = await _catalog(db_session, org.id, "Bag Valve Mask")
        bvm.also_called = ["BVM"]
        await db_session.flush()
        _, (line,) = await _template(
            db_session, org.id, "Medic 1", [("BVM", "count", None)]
        )

        result = await self._run(db_session, org.id)

        assert await self._link_of(db_session, line.id) == bvm.id
        (group,) = result["groups"]
        assert group["confidence"] == "strong"
        assert group["matched_alias"] == "BVM"

    async def test_a_tie_between_two_items_is_left_for_a_person(self, db_session):
        org = await _org(db_session)
        await _catalog(db_session, org.id, "Oxygen Mask Adult")
        await _catalog(db_session, org.id, "Oxygen Mask Pediatric")
        _, (line,) = await _template(
            db_session, org.id, "Medic 1", [("Oxygen Mask", "count", None)]
        )

        result = await self._run(db_session, org.id)

        assert result["linked"] == 0
        assert result["left_for_review"] == 1
        assert await self._link_of(db_session, line.id) is None

    async def test_weak_and_unmatched_names_are_left_alone(self, db_session):
        org = await _org(db_session)
        await _catalog(db_session, org.id, "Trauma Bag")
        _, lines = await _template(
            db_session,
            org.id,
            "Medic 1",
            [
                ("Bag Valve Mask", "count", None),
                ("Check tire pressure", "function", None),
            ],
        )

        result = await self._run(db_session, org.id)

        assert result["linked"] == 0
        assert result["left_for_review"] == 2
        for line in lines:
            assert await self._link_of(db_session, line.id) is None

    async def test_an_existing_link_is_never_replaced(self, db_session):
        org = await _org(db_session)
        gauze = await _catalog(db_session, org.id, "Gauze Pads 4x4")
        chosen = await _catalog(db_session, org.id, "Gauze, Bulk")
        _, (line,) = await _template(
            db_session, org.id, "Medic 1", [("Gauze Pads 4x4", "count", chosen.id)]
        )

        result = await self._run(db_session, org.id)

        assert result["linked"] == 0
        assert await self._link_of(db_session, line.id) == chosen.id
        assert gauze.id != chosen.id

    async def test_each_link_is_logged_as_automatic(self, db_session):
        org = await _org(db_session)
        await _catalog(db_session, org.id, "Gauze Pads 4x4")
        template, _ = await _template(
            db_session, org.id, "Medic 1", [("Gauze Pads 4x4", "count", None)]
        )

        await self._run(db_session, org.id)

        changes = (
            (
                await db_session.execute(
                    select(TemplateChangeLog.changes).where(
                        TemplateChangeLog.template_id == template.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [c["source"] for c in changes] == ["catalog_auto_link"]

    async def test_another_departments_catalog_is_never_linked(self, db_session):
        org = await _org(db_session, "Mine")
        other = await _org(db_session, "Theirs")
        await _catalog(db_session, other.id, "Gauze Pads 4x4")
        _, (line,) = await _template(
            db_session, org.id, "Medic 1", [("Gauze Pads 4x4", "count", None)]
        )

        result = await self._run(db_session, org.id)

        assert result["linked"] == 0
        assert await self._link_of(db_session, line.id) is None
