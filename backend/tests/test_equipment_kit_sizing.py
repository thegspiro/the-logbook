"""Integration tests for sizing a gear kit to the member it is issued to.

A kit is a template issued to many members, so a line names a product ("Blauer
Jacket") and the size is settled per member at issue time: from the member's
recorded size by default, overridable by the quartermaster within the same
product. Before this, the line's "Size" flag was stored and never read, and
every member received whichever size the kit had been built with.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import ItemIssuance
from app.services.inventory_service import InventoryService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_member(db_session: AsyncSession):
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Kit Dept", "slug": f"kit-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Sam', 'Ortiz', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"sam{user_id[:6]}",
            "em": f"sam{user_id[:6]}@test.com",
        },
    )
    await db_session.flush()
    return org_id, user_id


async def _jackets(svc: InventoryService, org_id: str, user_id: str):
    """A jacket stocked in M/L/XL, five of each, keyed by size code."""
    cat, _ = await svc.create_category(
        organization_id=uuid.UUID(org_id),
        category_data={"name": "Outerwear", "item_type": "uniform"},
        created_by=uuid.UUID(user_id),
    )
    items, _group_id, _skipped = await svc.create_size_variants(
        organization_id=uuid.UUID(org_id),
        created_by=uuid.UUID(user_id),
        base_name="Blauer Jacket",
        sizes=["m", "l", "xl"],
        colors=["Red"],
        create_variant_group=True,
        category_id=cat.id,
        tracking_type="pool",
        quantity_per_variant=5,
    )
    await svc.db.flush()
    return {
        (item.standard_size.value if item.standard_size else item.size): item
        for item in items
    }


async def _kit(svc, org_id, user_id, item, *, size_selectable=True):
    kit, err = await svc.create_equipment_kit(
        organization_id=uuid.UUID(org_id),
        data={
            "name": "Recruit Kit",
            "line_items": [
                {
                    "item_id": item.id,
                    "item_name": "Blauer Jacket",
                    "quantity": 1,
                    "size_selectable": size_selectable,
                }
            ],
        },
        created_by=uuid.UUID(user_id),
    )
    assert err is None
    assert kit is not None
    # Reloaded with its lines eagerly, as every service read does.
    return await svc.get_equipment_kit_by_id(uuid.UUID(kit.id), uuid.UUID(org_id))


async def _issued_item_ids(db: AsyncSession, user_id: str) -> list[str]:
    rows = await db.execute(
        select(ItemIssuance.item_id).where(ItemIssuance.user_id == user_id)
    )
    return list(rows.scalars().all())


class TestKitProductOptions:

    @pytest.mark.asyncio
    async def test_sizes_collapse_into_one_product(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        jackets = await _jackets(svc, org_id, user_id)

        options = await svc.get_kit_product_options(uuid.UUID(org_id))

        assert len(options) == 1
        product = options[0]
        assert product["name"] == "Blauer Jacket"
        assert product["has_sizes"] is True
        assert [v["size_label"] for v in product["variants"]] == ["M", "L", "XL"]
        assert {v["item_id"] for v in product["variants"]} == {
            j.id for j in jackets.values()
        }


class TestKitIssuePlan:

    @pytest.mark.asyncio
    async def test_line_defaults_to_the_members_size(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        jackets = await _jackets(svc, org_id, user_id)
        kit = await _kit(svc, org_id, user_id, jackets["m"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            data={"jacket_size": "XL"},
        )

        plan, err = await svc.get_kit_issue_plan(
            uuid.UUID(kit.id), uuid.UUID(user_id), uuid.UUID(org_id)
        )

        assert err is None

        assert plan is not None
        line = plan["lines"][0]
        assert line["member_size"] == "XL"
        assert line["selected_item_id"] == jackets["xl"].id
        assert len(line["variants"]) == 3

    @pytest.mark.asyncio
    async def test_no_size_on_file_leaves_the_choice_open(
        self, db_session, org_and_member
    ):
        # Defaulting to the size the kit was built with would hand a wrong
        # jacket over silently; asking is the safe answer.
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        jackets = await _jackets(svc, org_id, user_id)
        kit = await _kit(svc, org_id, user_id, jackets["m"])

        plan, _ = await svc.get_kit_issue_plan(
            uuid.UUID(kit.id), uuid.UUID(user_id), uuid.UUID(org_id)
        )

        assert plan is not None
        assert plan["lines"][0]["member_size"] is None
        assert plan["lines"][0]["selected_item_id"] is None

    @pytest.mark.asyncio
    async def test_fixed_size_line_keeps_its_row(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        jackets = await _jackets(svc, org_id, user_id)
        kit = await _kit(svc, org_id, user_id, jackets["l"], size_selectable=False)
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            data={"jacket_size": "XL"},
        )

        plan, _ = await svc.get_kit_issue_plan(
            uuid.UUID(kit.id), uuid.UUID(user_id), uuid.UUID(org_id)
        )

        assert plan is not None
        assert plan["lines"][0]["selected_item_id"] == jackets["l"].id


class TestIssueKitSizing:

    @pytest.mark.asyncio
    async def test_issues_the_members_size(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        jackets = await _jackets(svc, org_id, user_id)
        kit = await _kit(svc, org_id, user_id, jackets["m"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            data={"jacket_size": "L"},
        )

        issued, err = await svc.issue_kit_to_member(
            kit_id=uuid.UUID(kit.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
        )

        assert err is None

        assert issued is not None
        assert await _issued_item_ids(db_session, user_id) == [jackets["l"].id]

    @pytest.mark.asyncio
    async def test_quartermaster_override_wins(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        jackets = await _jackets(svc, org_id, user_id)
        kit = await _kit(svc, org_id, user_id, jackets["m"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            data={"jacket_size": "L"},
        )
        line_id = kit.line_items[0].id

        issued, err = await svc.issue_kit_to_member(
            kit_id=uuid.UUID(kit.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            selections={line_id: jackets["xl"].id},
        )

        assert err is None

        assert issued is not None
        assert await _issued_item_ids(db_session, user_id) == [jackets["xl"].id]

    @pytest.mark.asyncio
    async def test_override_outside_the_product_is_refused(
        self, db_session, org_and_member
    ):
        # The override changes the size, never what is issued: a row from a
        # different product must not ride in on a size selection.
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        jackets = await _jackets(svc, org_id, user_id)
        kit = await _kit(svc, org_id, user_id, jackets["m"])
        other, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Thermal Imager",
                "condition": "good",
                "status": "available",
                "tracking_type": "pool",
                "quantity": 1,
            },
            created_by=uuid.UUID(user_id),
        )
        assert err is None
        assert other is not None

        issued, err = await svc.issue_kit_to_member(
            kit_id=uuid.UUID(kit.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            selections={kit.line_items[0].id: other.id},
        )

        assert issued is None
        assert err is not None
        assert "not a variant" in err
        assert await _issued_item_ids(db_session, user_id) == []

    @pytest.mark.asyncio
    async def test_override_on_a_fixed_size_line_is_refused(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        jackets = await _jackets(svc, org_id, user_id)
        kit = await _kit(svc, org_id, user_id, jackets["m"], size_selectable=False)

        issued, err = await svc.issue_kit_to_member(
            kit_id=uuid.UUID(kit.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            selections={kit.line_items[0].id: jackets["xl"].id},
        )

        assert issued is None
        assert err is not None
        assert "fixed size" in err
