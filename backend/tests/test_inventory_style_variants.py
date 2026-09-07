"""Variant generation and filtering under the garment style axes.

Marked ``integration`` deliberately: the CI matrix runs the integration and
contract legs against MySQL 8.0 *and* MariaDB 10.11, and the list filter here
leans on ``JSON_CONTAINS``. A unit-marked test would prove nothing about the
MariaDB leg, which is the half whose JSON support was worth confirming.
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
async def org_and_user(db_session: AsyncSession):
    org_id, user_id = _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Style Dept", "slug": f"sty-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Sam', 'Diaz', :em, 'hashed', 'active')"
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


async def _variants(svc, org_id, user_id, **kwargs):
    kwargs.setdefault("base_name", "Dept Polo")
    kwargs.setdefault("sizes", ["m"])
    kwargs.setdefault("create_variant_group", False)
    items, group_id, _skipped = await svc.create_size_variants(
        organization_id=uuid.UUID(org_id),
        created_by=uuid.UUID(user_id),
        **kwargs,
    )
    return items, group_id


class TestCombinationGeneration:
    async def test_one_pick_per_axis_creates_one_item(
        self, db_session: AsyncSession, org_and_user
    ):
        """The reported bug, end to end.

        Long Sleeve + Men's + Polo is one men's long-sleeve polo. This created
        three separate pool items before the axes existed.
        """
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)

        items, _ = await _variants(
            svc, org_id, user_id, styles=["long_sleeve", "mens", "polo"]
        )

        assert len(items) == 1
        item = items[0]
        assert item.style_attributes == ["long_sleeve", "mens", "polo"]
        assert item.style.value == "polo"

    async def test_the_generated_name_reads_as_one_garment(
        self, db_session: AsyncSession, org_and_user
    ):
        """One trailing segment, in English order — not one segment per
        attribute, which would read "… — Long Sleeve — Men's — Polo"."""
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)

        items, _ = await _variants(
            svc,
            org_id,
            user_id,
            styles=["long_sleeve", "mens", "polo"],
            colors=["Navy"],
        )

        assert items[0].name == "Dept Polo — M — Navy — Men's Long Sleeve Polo"

    async def test_two_picks_within_an_axis_still_multiply(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)

        items, _ = await _variants(
            svc, org_id, user_id, styles=["long_sleeve", "mens", "womens", "polo"]
        )

        assert len(items) == 2
        assert {tuple(i.style_attributes) for i in items} == {
            ("long_sleeve", "mens", "polo"),
            ("long_sleeve", "womens", "polo"),
        }

    async def test_sizes_colors_and_axes_all_multiply_together(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)

        items, _ = await _variants(
            svc,
            org_id,
            user_id,
            sizes=["m", "l"],
            colors=["Navy", "White"],
            styles=["short_sleeve", "long_sleeve", "polo"],
        )

        assert len(items) == 8

    async def test_no_styles_still_creates_one_item_per_size(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)

        items, _ = await _variants(svc, org_id, user_id, sizes=["m", "l"])

        assert len(items) == 2
        assert all(i.style is None and i.style_attributes is None for i in items)


class TestListFiltering:
    async def test_filtering_by_sleeve_finds_a_polo(
        self, db_session: AsyncSession, org_and_user
    ):
        """The point of the attribute column.

        A men's long-sleeve polo stores primary ``style = "polo"``, so a filter
        comparing the scalar column alone would miss it under "Long Sleeve".
        """
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        await _variants(svc, org_id, user_id, styles=["long_sleeve", "mens", "polo"])
        await db_session.flush()

        found, total = await svc.get_items(
            organization_id=uuid.UUID(org_id), style="long_sleeve"
        )

        assert total == 1
        assert found[0].style_attributes == ["long_sleeve", "mens", "polo"]

    @pytest.mark.parametrize("probe", ["polo", "mens", "long_sleeve"])
    async def test_every_attribute_finds_the_item(
        self, db_session: AsyncSession, org_and_user, probe
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        await _variants(svc, org_id, user_id, styles=["long_sleeve", "mens", "polo"])
        await db_session.flush()

        _found, total = await svc.get_items(
            organization_id=uuid.UUID(org_id), style=probe
        )
        assert total == 1

    async def test_an_unselected_attribute_matches_nothing(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        await _variants(svc, org_id, user_id, styles=["long_sleeve", "mens", "polo"])
        await db_session.flush()

        _found, total = await svc.get_items(
            organization_id=uuid.UUID(org_id), style="womens"
        )
        assert total == 0

    async def test_a_row_the_backfill_never_reached_is_still_found(
        self, db_session: AsyncSession, org_and_user
    ):
        """`alembic upgrade head` alone does not produce a working schema
        (CLAUDE.md pitfall #26): an installation whose column arrived through
        startup's repair has it present with every row NULL. The scalar half of
        the filter is what covers those, and it is not redundant.
        """
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        item, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Legacy Shirt", "style": "v_neck"},
            created_by=uuid.UUID(user_id),
        )
        assert err is None
        await db_session.execute(
            text("UPDATE inventory_items SET style_attributes = NULL WHERE id = :id"),
            {"id": item.id},
        )
        await db_session.flush()

        _found, total = await svc.get_items(
            organization_id=uuid.UUID(org_id), style="v_neck"
        )
        assert total == 1


class TestVariantIdentity:
    async def test_a_mens_and_a_womens_polo_are_two_variants(
        self, db_session: AsyncSession, org_and_user
    ):
        """Both carry primary ``style = "polo"``. Keying the catalog on that
        alone would collapse them into one line, sum their stock, and let a
        request raised against one be filled from the other.
        """
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)

        items, _ = await _variants(
            svc, org_id, user_id, styles=["long_sleeve", "mens", "womens", "polo"]
        )

        assert {i.style.value for i in items} == {"polo"}
        assert len({InventoryService._variant_key(i) for i in items}) == 2

    async def test_identity_is_unchanged_for_a_legacy_single_style_row(
        self, db_session: AsyncSession, org_and_user
    ):
        """The backfill writes ``[style]``, so the joined key equals the old
        single value and no pre-existing row regroups."""
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        item, _err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Legacy Shirt", "style": "v_neck"},
            created_by=uuid.UUID(user_id),
        )

        assert InventoryService._variant_key(item)[2] == "v_neck"


class TestWritePathsKeepTheColumnsPaired:
    async def test_creating_with_only_a_scalar_style_fills_the_list(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)

        item, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Legacy Shirt", "style": "polo"},
            created_by=uuid.UUID(user_id),
        )

        assert err is None
        assert item.style_attributes == ["polo"]

    async def test_creating_with_a_list_derives_the_primary(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)

        item, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Dept Polo",
                "style_attributes": ["polo", "mens", "long_sleeve"],
            },
            created_by=uuid.UUID(user_id),
        )

        assert err is None
        assert item.style.value == "polo"
        assert item.style_attributes == ["long_sleeve", "mens", "polo"]

    async def test_an_unrelated_patch_does_not_clear_the_style(
        self, db_session: AsyncSession, org_and_user
    ):
        """Update payloads are dumped with ``exclude_unset``, so an omitted key
        means "leave this alone". Writing style unconditionally here would turn
        a rename into a silent style wipe (CLAUDE.md pitfall #1).
        """
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        item, _err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Dept Polo",
                "style_attributes": ["long_sleeve", "mens", "polo"],
            },
            created_by=uuid.UUID(user_id),
        )

        updated, err = await svc.update_item(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org_id),
            update_data={"name": "Dept Polo (renamed)"},
        )

        assert err is None
        assert updated.style.value == "polo"
        assert updated.style_attributes == ["long_sleeve", "mens", "polo"]

    async def test_clearing_the_style_explicitly_clears_both_columns(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        item, _err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Dept Polo",
                "style_attributes": ["long_sleeve", "mens", "polo"],
            },
            created_by=uuid.UUID(user_id),
        )

        updated, err = await svc.update_item(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org_id),
            update_data={"style_attributes": None},
        )

        assert err is None
        assert updated.style is None
        assert updated.style_attributes is None


class TestIdempotentGeneration:
    """Re-running the generator adds what is missing instead of duplicating.

    Before this, a second run created a whole second set under a second group
    with the same name. `_product_key` keys on the group, so the member saw two
    identically-named products with the stock split between them, and
    fulfilment — which narrows by variant_group_id — could not answer a request
    raised against one from the other's shelf.
    """

    async def test_an_identical_rerun_creates_nothing(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        first, group_id, _ = await svc.create_size_variants(
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
            base_name="Dept Polo",
            sizes=["m", "l"],
            styles=["polo"],
        )
        assert len(first) == 2

        second, second_group, skipped = await svc.create_size_variants(
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
            base_name="Dept Polo",
            sizes=["m", "l"],
            styles=["polo"],
        )

        assert second == []
        assert skipped == 2
        assert second_group == group_id

    async def test_a_rerun_adds_only_the_missing_size(
        self, db_session: AsyncSession, org_and_user
    ):
        """The 'add 3XL to the polo we already stock' route, which had no path
        at all before — the generator was the only way in and it duplicated."""
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        _first, group_id, _ = await svc.create_size_variants(
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
            base_name="Dept Polo",
            sizes=["m", "l"],
            styles=["polo"],
        )

        added, same_group, skipped = await svc.create_size_variants(
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
            base_name="Dept Polo",
            sizes=["m", "l", "xxxl"],
            styles=["polo"],
        )

        assert [i.standard_size.value for i in added] == ["xxxl"]
        assert skipped == 2
        assert same_group == group_id

    async def test_a_differing_style_is_a_new_variant_not_a_duplicate(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        await svc.create_size_variants(
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
            base_name="Dept Polo",
            sizes=["m"],
            styles=["mens", "polo"],
        )

        added, _group, skipped = await svc.create_size_variants(
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
            base_name="Dept Polo",
            sizes=["m"],
            styles=["womens", "polo"],
        )

        assert len(added) == 1
        assert added[0].style_attributes == ["womens", "polo"]
        assert skipped == 0

    async def test_the_name_match_ignores_case(
        self, db_session: AsyncSession, org_and_user
    ):
        """Group names are not unique and nobody retypes a name identically."""
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        _items, group_id, _ = await svc.create_size_variants(
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
            base_name="Dept Polo",
            sizes=["m"],
            styles=["polo"],
        )

        _added, same_group, skipped = await svc.create_size_variants(
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
            base_name="dept polo",
            sizes=["m"],
            styles=["polo"],
        )

        assert same_group == group_id
        assert skipped == 1

    async def test_the_member_catalog_shows_one_product_after_a_rerun(
        self, db_session: AsyncSession, org_and_user
    ):
        """The damage this prevents, asserted where it was visible."""
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        cat, _ = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={"name": "Uniform Shirts", "item_type": "uniform"},
            created_by=uuid.UUID(user_id),
        )
        for _ in range(2):
            await svc.create_size_variants(
                organization_id=uuid.UUID(org_id),
                created_by=uuid.UUID(user_id),
                base_name="Dept Polo",
                sizes=["m"],
                styles=["polo"],
                category_id=cat.id,
                quantity_per_variant=5,
            )
        await db_session.flush()

        user = await db_session.get(User, user_id)
        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user
        )

        polos = [p for p in products if p["name"] == "Dept Polo"]
        assert len(polos) == 1
        assert polos[0]["total_available"] == 5
