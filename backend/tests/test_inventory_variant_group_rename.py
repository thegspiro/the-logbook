"""Renaming a variant group carries the new product name onto its sizes.

The inventory list labels a folded product by the segment before the first
" — " of each member's own name, so a rename that stopped at the group row left
the list showing the old name. Marked ``integration`` because every test here
writes rows through ``db_session``.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import InventoryItem
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
        {"id": org_id, "name": "Rename Dept", "slug": f"ren-{org_id[:8]}"},
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


async def _product(svc, org_id, user_id, base_name="Short Sleeve", **kwargs):
    kwargs.setdefault("sizes", ["s", "m", "xxl"])
    kwargs.setdefault("colors", ["Navy"])
    items, group_id, _skipped = await svc.create_size_variants(
        organization_id=uuid.UUID(org_id),
        created_by=uuid.UUID(user_id),
        base_name=base_name,
        create_variant_group=True,
        **kwargs,
    )
    return items, group_id


async def _names(db: AsyncSession, group_id: str) -> list[str]:
    rows = await db.execute(
        select(InventoryItem.name)
        .where(InventoryItem.variant_group_id == group_id)
        .execution_options(populate_existing=True)
    )
    return sorted(rows.scalars())


class TestRenameCarriesOntoMembers:
    async def test_rename_replaces_only_the_product_segment(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        _, group_id = await _product(svc, org_id, user_id)

        group, error = await svc.update_variant_group(
            uuid.UUID(group_id), org_id, {"name": "Class B Short Sleeve"}
        )

        assert error is None
        assert group.name == "Class B Short Sleeve"
        assert await _names(db_session, group_id) == [
            "Class B Short Sleeve — M — Navy",
            "Class B Short Sleeve — S — Navy",
            "Class B Short Sleeve — XXL — Navy",
        ]

    async def test_name_is_trimmed_before_it_lands(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        _, group_id = await _product(svc, org_id, user_id, sizes=["m"])

        group, error = await svc.update_variant_group(
            uuid.UUID(group_id), org_id, {"name": "  Polo  "}
        )

        assert error is None
        assert group.name == "Polo"
        assert await _names(db_session, group_id) == ["Polo — M — Navy"]

    async def test_member_named_differently_is_left_alone(
        self, db_session: AsyncSession, org_and_user
    ):
        """A member filed under the group by hand, under its own name, was named
        on purpose; the rename must not overwrite it."""
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        items, group_id = await _product(svc, org_id, user_id, sizes=["m"])
        stray, _ = await _product(
            svc, org_id, user_id, base_name="Tie", sizes=["l"], colors=[]
        )
        stray[0].variant_group_id = group_id
        await db_session.flush()

        _, error = await svc.update_variant_group(
            uuid.UUID(group_id), org_id, {"name": "Polo"}
        )

        assert error is None
        assert await _names(db_session, group_id) == ["Polo — M — Navy", "Tie — L"]

    async def test_prefix_match_ignores_case(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        items, group_id = await _product(svc, org_id, user_id, sizes=["m"])
        items[0].name = "short sleeve — M — Navy"
        await db_session.flush()

        _, error = await svc.update_variant_group(
            uuid.UUID(group_id), org_id, {"name": "Polo"}
        )

        assert error is None
        assert await _names(db_session, group_id) == ["Polo — M — Navy"]

    async def test_overlong_result_rejects_without_renaming_anything(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        _, group_id = await _product(svc, org_id, user_id)
        before = await _names(db_session, group_id)

        group, error = await svc.update_variant_group(
            uuid.UUID(group_id), org_id, {"name": "X" * 250}
        )

        assert group is None
        assert "255" in (error or "")
        assert await _names(db_session, group_id) == before

    async def test_update_without_a_name_leaves_item_names(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        _, group_id = await _product(svc, org_id, user_id)
        before = await _names(db_session, group_id)

        _, error = await svc.update_variant_group(
            uuid.UUID(group_id), org_id, {"description": "Summer uniform"}
        )

        assert error is None
        assert await _names(db_session, group_id) == before

    async def test_generator_reuses_the_renamed_group(
        self, db_session: AsyncSession, org_and_user
    ):
        """Adding a size under the new name lands in the same product, which is
        why the members must follow the group rather than keep the old name."""
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        _, group_id = await _product(svc, org_id, user_id, sizes=["m"])
        await svc.update_variant_group(uuid.UUID(group_id), org_id, {"name": "Polo"})

        added, reused_group_id = await _product(
            svc, org_id, user_id, base_name="Polo", sizes=["m", "l"]
        )

        assert reused_group_id == group_id
        assert [i.name for i in added] == ["Polo — L — Navy"]

    async def test_other_org_cannot_rename(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        svc = InventoryService(db_session)
        _, group_id = await _product(svc, org_id, user_id, sizes=["m"])

        group, error = await svc.update_variant_group(
            uuid.UUID(group_id), _uid(), {"name": "Hijacked"}
        )

        assert group is None
        assert error == "Variant group not found"
        assert await _names(db_session, group_id) == ["Short Sleeve — M — Navy"]
