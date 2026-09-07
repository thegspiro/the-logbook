"""Tests for the per-member pinned shortlist on the inventory items list.

Runs against the real database rather than a mocked session: the behaviour at
stake -- contiguous positions, the outer join not inflating `total`, and the
cross-tenant refusal -- is all in what MySQL actually stores and returns, and a
mock would assert the query I wrote rather than the rows it produces.
"""

import uuid

import pytest
from sqlalchemy import text

from app.models.inventory import InventoryItemPin
from app.services.inventory_service import InventoryService


async def _make_user(db, org_id: str, label: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{label}-{user_id[:8]}",
            "fn": label.title(),
            "ln": "User",
            "em": f"{label}-{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return user_id


async def _make_org(db, name: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": name, "slug": f"{name}-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _make_item(db, org_id: str, name: str) -> str:
    item_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO inventory_items "
            "(id, organization_id, name, `condition`, status, tracking_type, "
            "quantity, quantity_issued, active) "
            "VALUES (:id, :org, :name, 'good', 'available', 'pool', "
            "5, 0, 1)"
        ),
        {"id": item_id, "org": org_id, "name": name},
    )
    await db.flush()
    return item_id


@pytest.fixture
async def org(db_session):
    return await _make_org(db_session, "pins-org")


@pytest.fixture
async def user(db_session, org):
    return await _make_user(db_session, org, "quartermaster")


@pytest.fixture
async def service(db_session):
    return InventoryService(db_session)


@pytest.fixture
async def items(db_session, org):
    """Four items named so alphabetical order is A, B, C, D."""
    return [
        await _make_item(db_session, org, name)
        for name in ("A Boots", "B Helmet", "C Polo", "D Trousers")
    ]


async def _positions(db, org_id, user_id, service):
    pins = await service.list_pins(uuid.UUID(org_id), uuid.UUID(user_id))
    return [(pin.item_id, pin.position) for pin in pins]


class TestPinning:
    async def test_first_pin_lands_at_position_zero(self, service, org, user, items):
        pin = await service.pin_item(
            uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0])
        )
        assert pin.position == 0
        assert pin.item_id == items[0]

    async def test_second_pin_appends_to_the_end(self, service, org, user, items):
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0]))
        second = await service.pin_item(
            uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[1])
        )
        assert second.position == 1

    async def test_repinning_is_idempotent(self, service, db_session, org, user, items):
        first = await service.pin_item(
            uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0])
        )
        again = await service.pin_item(
            uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0])
        )
        # The same row, not a duplicate and not a raised conflict: two tabs
        # pinning the same item is a normal thing for a person to do.
        assert again.id == first.id
        assert len(await service.list_pins(uuid.UUID(org), uuid.UUID(user))) == 1

    async def test_unpin_compacts_the_positions_left_behind(
        self, service, org, user, items
    ):
        for item_id in items[:3]:
            await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(item_id))

        removed = await service.unpin_item(
            uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[1])
        )
        assert removed is True

        # 0,1,2 minus the middle must become 0,1 -- not 0,2. "Move up" is a
        # swap with position - 1 and must never straddle a hole.
        assert await _positions(None, org, user, service) == [
            (items[0], 0),
            (items[2], 1),
        ]

    async def test_unpinning_something_not_pinned_reports_false(
        self, service, org, user, items
    ):
        assert (
            await service.unpin_item(
                uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0])
            )
            is False
        )

    async def test_pin_limit_is_enforced(self, service, db_session, org, user):
        many = [
            await _make_item(db_session, org, f"Item {i:02d}")
            for i in range(InventoryService.MAX_PINS + 1)
        ]
        for item_id in many[: InventoryService.MAX_PINS]:
            await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(item_id))

        with pytest.raises(ValueError, match="at most"):
            await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(many[-1]))


class TestTenancy:
    async def test_cannot_pin_another_organizations_item(
        self, service, db_session, org, user
    ):
        other_org = await _make_org(db_session, "other-dept")
        their_item = await _make_item(db_session, other_org, "Their Ladder")

        with pytest.raises(ValueError, match="Item not found"):
            await service.pin_item(
                uuid.UUID(org), uuid.UUID(user), uuid.UUID(their_item)
            )

        # And nothing was written -- a rejected pin must not leave a dangling
        # cross-tenant reference behind (CLAUDE.md pitfall #14c).
        result = await db_session.execute(
            text("SELECT COUNT(*) FROM inventory_item_pins WHERE item_id = :i"),
            {"i": their_item},
        )
        assert result.scalar() == 0

    async def test_one_members_pins_do_not_reach_another(
        self, service, db_session, org, user, items
    ):
        colleague = await _make_user(db_session, org, "colleague")
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[3]))

        theirs = await service.list_pins(uuid.UUID(org), uuid.UUID(colleague))
        assert theirs == []

        # And their list is untouched by the other member's pin.
        rows, _ = await service.get_items(
            organization_id=uuid.UUID(org),
            pinned_for_user_id=uuid.UUID(colleague),
        )
        assert [row.name for row in rows] == [
            "A Boots",
            "B Helmet",
            "C Polo",
            "D Trousers",
        ]
        assert all(row.pin_position is None for row in rows)


class TestReordering:
    async def test_reorder_rewrites_positions(self, service, org, user, items):
        for item_id in items[:3]:
            await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(item_id))

        await service.reorder_pins(
            uuid.UUID(org), uuid.UUID(user), [items[2], items[0], items[1]]
        )
        assert await _positions(None, org, user, service) == [
            (items[2], 0),
            (items[0], 1),
            (items[1], 2),
        ]

    async def test_partial_order_is_rejected(self, service, org, user, items):
        for item_id in items[:3]:
            await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(item_id))

        # A short list is indistinguishable from a stale tab dropping a pin
        # somebody added elsewhere a minute ago, so it is refused rather than
        # applied.
        with pytest.raises(ValueError, match="exactly the items"):
            await service.reorder_pins(
                uuid.UUID(org), uuid.UUID(user), [items[0], items[1]]
            )

    async def test_order_naming_an_unpinned_item_is_rejected(
        self, service, org, user, items
    ):
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0]))
        with pytest.raises(ValueError, match="exactly the items"):
            await service.reorder_pins(
                uuid.UUID(org), uuid.UUID(user), [items[0], items[1]]
            )

    async def test_duplicate_ids_are_rejected(self, service, org, user, items):
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0]))
        with pytest.raises(ValueError, match="duplicate"):
            await service.reorder_pins(
                uuid.UUID(org), uuid.UUID(user), [items[0], items[0]]
            )


class TestListHoisting:
    async def test_pinned_items_come_first_in_pin_order(
        self, service, org, user, items
    ):
        # Pin D then C, so pin order is the reverse of alphabetical order and
        # a passing assertion cannot be explained by the name sort.
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[3]))
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[2]))

        rows, _ = await service.get_items(
            organization_id=uuid.UUID(org), pinned_for_user_id=uuid.UUID(user)
        )
        assert [row.name for row in rows] == [
            "D Trousers",
            "C Polo",
            "A Boots",
            "B Helmet",
        ]
        assert [row.pin_position for row in rows] == [0, 1, None, None]

    async def test_pins_outrank_an_explicit_sort(self, service, org, user, items):
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0]))
        rows, _ = await service.get_items(
            organization_id=uuid.UUID(org),
            pinned_for_user_id=uuid.UUID(user),
            sort_by="name",
            sort_order="desc",
        )
        # Name-descending would put "D Trousers" first; the pin wins.
        assert rows[0].name == "A Boots"
        assert [row.name for row in rows[1:]] == [
            "D Trousers",
            "C Polo",
            "B Helmet",
        ]

    async def test_the_join_does_not_inflate_the_total(self, service, org, user, items):
        before_rows, before_total = await service.get_items(
            organization_id=uuid.UUID(org)
        )
        for item_id in items:
            await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(item_id))

        after_rows, after_total = await service.get_items(
            organization_id=uuid.UUID(org), pinned_for_user_id=uuid.UUID(user)
        )
        # uq_item_pin_user_item keeps the outer join 1:1. Without it every
        # pinned row would be counted twice and "Load More" would offer pages
        # that do not exist.
        assert after_total == before_total == 4
        assert len(after_rows) == len(before_rows) == 4

    async def test_ordering_is_unchanged_without_a_user(
        self, service, org, user, items
    ):
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[3]))
        rows, _ = await service.get_items(organization_id=uuid.UUID(org))
        # No pinned_for_user_id: no join, no hoist, and pin_position stamped
        # None on every row rather than left unset for the response schema.
        assert [row.name for row in rows] == [
            "A Boots",
            "B Helmet",
            "C Polo",
            "D Trousers",
        ]
        assert all(row.pin_position is None for row in rows)

    async def test_a_pinned_item_is_dropped_by_a_filter_that_excludes_it(
        self, service, db_session, org, user, items
    ):
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0]))
        await db_session.execute(
            text("UPDATE inventory_items SET status = 'retired' WHERE id = :i"),
            {"i": items[0]},
        )
        await db_session.flush()

        rows, total = await service.get_items(
            organization_id=uuid.UUID(org),
            pinned_for_user_id=uuid.UUID(user),
            status="available",
        )
        # A pin hoists an item within the result set; it does not smuggle it
        # past a filter the user applied.
        assert items[0] not in [row.id for row in rows]
        assert total == 3


class TestPinModel:
    async def test_a_pin_carries_its_organization(
        self, service, db_session, org, user, items
    ):
        await service.pin_item(uuid.UUID(org), uuid.UUID(user), uuid.UUID(items[0]))
        result = await db_session.execute(
            text(
                "SELECT organization_id FROM inventory_item_pins " "WHERE user_id = :u"
            ),
            {"u": user},
        )
        # Denormalized from the item so every read is org-scoped without
        # joining inventory_items.
        assert result.scalar() == org

    async def test_the_model_maps_the_table(self):
        assert InventoryItemPin.__tablename__ == "inventory_item_pins"
