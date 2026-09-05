"""Integration tests for the member-facing requestable catalog.

The flat item list is unusable as a request form once a garment is stocked in
seven sizes: it becomes seven near-identical rows, and a member who does not
know the department's name for a thing gets nothing back at all. These pin the
three behaviours that fix: products grouped with their sizes, a search that
reaches the category and variant-group names, and out-of-stock variants left
in so an unmet need can be recorded.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
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
        {"id": org_id, "name": "Catalog Dept", "slug": f"cat-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Reyes', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"pat{user_id[:6]}",
            "em": f"pat{user_id[:6]}@test.com",
        },
    )
    await db_session.flush()
    user = await db_session.get(User, user_id)
    return org_id, user


async def _uniform_variants(svc, org_id, user_id, *, quantities):
    """A polo stocked in S/M/L, with per-size on-hand counts."""
    cat, _ = await svc.create_category(
        organization_id=uuid.UUID(org_id),
        category_data={"name": "Uniform Shirts", "item_type": "uniform"},
        created_by=uuid.UUID(user_id),
    )
    items, group_id = await svc.create_size_variants(
        organization_id=uuid.UUID(org_id),
        created_by=uuid.UUID(user_id),
        base_name="Long Sleeve",
        sizes=list(quantities),
        colors=["Navy"],
        create_variant_group=True,
        category_id=cat.id,
        tracking_type="pool",
        quantity_per_variant=0,
    )
    by_size = {}
    for item in items:
        size = item.standard_size.value if item.standard_size else item.size
        item.quantity = quantities[size]
        by_size[size] = item
    await svc.db.flush()
    return cat, group_id, by_size


class TestRequestableCatalogGrouping:

    @pytest.mark.asyncio
    async def test_size_variants_collapse_into_one_product(
        self, db_session, org_and_member
    ):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _uniform_variants(
            svc, org_id, str(user.id), quantities={"s": 2, "m": 3, "l": 0}
        )

        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user
        )

        assert len(products) == 1
        product = products[0]
        assert product["name"] == "Long Sleeve"
        assert product["has_sizes"] is True
        assert [v["size"] for v in product["variants"]] == ["s", "m", "l"]
        assert product["total_available"] == 5

    @pytest.mark.asyncio
    async def test_out_of_stock_size_is_still_offered(self, db_session, org_and_member):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _uniform_variants(
            svc, org_id, str(user.id), quantities={"m": 4, "xxl": 0}
        )

        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user
        )

        sizes = {v["size"]: v["available"] for v in products[0]["variants"]}
        # The unstocked size is the whole point: a request against it is how
        # the quartermaster finds out the department needs to buy one.
        assert sizes == {"m": 4, "xxl": 0}

    @pytest.mark.asyncio
    async def test_serialized_units_of_one_product_collapse_to_a_count(
        self, db_session, org_and_member
    ):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        cat, _ = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={"name": "Radios", "item_type": "equipment"},
            created_by=uuid.UUID(user.id),
        )
        for index, item_status in enumerate(["available", "available", "lost"]):
            await svc.create_item(
                organization_id=uuid.UUID(org_id),
                item_data={
                    "name": "Portable Radio",
                    "serial_number": f"SN-{index}",
                    "condition": "good",
                    "status": item_status,
                    "tracking_type": "individual",
                    "quantity": 1,
                    "category_id": cat.id,
                },
                created_by=uuid.UUID(user.id),
            )

        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user
        )

        assert len(products) == 1
        assert products[0]["name"] == "Portable Radio"
        assert len(products[0]["variants"]) == 1
        assert products[0]["total_available"] == 2


class TestRequestableCatalogSearch:

    @pytest.mark.asyncio
    async def test_search_matches_the_category_name(self, db_session, org_and_member):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _uniform_variants(svc, org_id, str(user.id), quantities={"m": 1})

        # "shirt" appears nowhere in the item name -- the variant generator
        # names these from the style. The category is where the word lives.
        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user, search="shirt"
        )

        assert [p["name"] for p in products] == ["Long Sleeve"]

    @pytest.mark.asyncio
    async def test_search_wildcards_are_escaped(self, db_session, org_and_member):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _uniform_variants(svc, org_id, str(user.id), quantities={"m": 1})

        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user, search="%"
        )

        assert products == []


class TestRequestableCatalogSizeDefaults:

    @pytest.mark.asyncio
    async def test_member_size_preselects_a_stocked_variant(
        self, db_session, org_and_member
    ):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _uniform_variants(svc, org_id, str(user.id), quantities={"s": 1, "l": 1})
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org_id),
            data={"shirt_size": "Large"},
        )

        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user
        )

        # "Large" and the stored code "l" are the same size; the alias table is
        # what lets a member's own spelling reach the department's stock.
        assert products[0]["size_field"] == "shirt"
        assert products[0]["member_size"] == "Large"
        assert products[0]["suggested_size"] == "l"

    @pytest.mark.asyncio
    async def test_unstocked_member_size_is_still_reported(
        self, db_session, org_and_member
    ):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _uniform_variants(svc, org_id, str(user.id), quantities={"s": 1, "m": 1})
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org_id),
            data={"shirt_size": "xxxl"},
        )

        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user
        )

        assert products[0]["member_size"] == "xxxl"
        assert products[0]["suggested_size"] is None


class TestRequestableCatalogRestrictions:

    @pytest.mark.asyncio
    async def test_rank_restricted_gear_is_withheld(self, db_session, org_and_member):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        cat, _ = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={"name": "Command", "item_type": "equipment"},
            created_by=uuid.UUID(user.id),
        )
        item, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Command Vehicle Keys",
                "condition": "good",
                "status": "available",
                "tracking_type": "individual",
                "quantity": 1,
                "category_id": cat.id,
            },
            created_by=uuid.UUID(user.id),
        )
        assert err is None
        item.min_rank_order = 1
        await db_session.flush()

        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user
        )

        # The member holds no rank, so they clear no rank floor. Filtering here
        # rather than only at submit keeps the modal from listing gear the
        # member is then refused.
        assert products == []
