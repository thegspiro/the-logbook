"""Permanent deletion of a medical supply category.

The foreign key from an item to its category is ``SET NULL``, and an item with
no category reads as gear — so deleting a category out from under its supplies
would silently carry them off the medical page. These tests pin the three
things that prevent it: a category holding items is refused unless the caller
names a medical category to move them to, the move covers retired items too,
and neither id can name a category outside the medical domain or the caller's
organization.

The route tests mock the service, as ``test_medical_supplies_domain`` does; the
service tests run against the database, because the move, the locking and the
cascade behaviour cannot be observed through a mock.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.endpoints import medical_supplies as ms
from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    ItemType,
    TrackingType,
)
from app.models.user import Organization
from app.services.inventory_service import CategoryHasItemsError, InventoryService

ORG = "org-1"
MEDICAL_CAT = "11111111-1111-1111-1111-111111111111"
OTHER_MEDICAL_CAT = "55555555-5555-5555-5555-555555555555"
GEAR_CAT = "22222222-2222-2222-2222-222222222222"


def _user():
    user = MagicMock()
    user.id = "u-1"
    user.username = "supply"
    user.organization_id = ORG
    return user


@pytest.fixture
def svc():
    """A service that knows which ids are medical, with the audit silenced."""
    service = AsyncMock()
    service.category_in_domain = AsyncMock(
        side_effect=lambda cid, org, types: str(cid) in (MEDICAL_CAT, OTHER_MEDICAL_CAT)
    )
    service.delete_category_permanently = AsyncMock(
        return_value={
            "category_name": "Airway",
            "items_moved": 0,
            "moved_to_name": None,
        }
    )
    with patch.object(ms, "InventoryService", return_value=service), patch.object(
        ms, "log_audit_event", new=AsyncMock()
    ) as audit:
        service.audit = audit
        yield service


async def _delete(category_id, move_items_to=None):
    return await ms.delete_medical_category(
        category_id=uuid.UUID(category_id),
        move_items_to=uuid.UUID(move_items_to) if move_items_to else None,
        db=AsyncMock(),
        current_user=_user(),
    )


@pytest.mark.unit
class TestDeleteRoute:
    async def test_deletes_a_medical_category_and_audits_it(self, svc):
        result = await _delete(MEDICAL_CAT)

        svc.delete_category_permanently.assert_awaited_once_with(
            category_id=uuid.UUID(MEDICAL_CAT),
            organization_id=ORG,
            item_types=MEDICAL_ITEM_TYPES,
            move_items_to=None,
        )
        assert result["category_name"] == "Airway"
        event = svc.audit.await_args.kwargs
        assert event["event_type"] == "medical_category_deleted"
        assert event["event_data"]["category_id"] == MEDICAL_CAT

    async def test_a_gear_category_is_not_found_and_never_touched(self, svc):
        with pytest.raises(HTTPException) as exc:
            await _delete(GEAR_CAT)

        assert exc.value.status_code == 404
        svc.delete_category_permanently.assert_not_awaited()

    async def test_a_gear_category_cannot_be_the_move_target(self, svc):
        """Supplies moved into a uniform category would leave the medical page."""
        with pytest.raises(HTTPException) as exc:
            await _delete(MEDICAL_CAT, move_items_to=GEAR_CAT)

        assert exc.value.status_code == 404
        svc.delete_category_permanently.assert_not_awaited()

    async def test_the_move_target_is_passed_through_and_audited(self, svc):
        svc.delete_category_permanently.return_value = {
            "category_name": "Airway",
            "items_moved": 4,
            "moved_to_name": "Trauma",
        }

        result = await _delete(MEDICAL_CAT, move_items_to=OTHER_MEDICAL_CAT)

        assert result["items_moved"] == 4
        event = svc.audit.await_args.kwargs["event_data"]
        assert event["items_moved"] == 4
        assert event["moved_to_category_id"] == OTHER_MEDICAL_CAT

    async def test_items_with_nowhere_to_go_is_a_conflict(self, svc):
        svc.delete_category_permanently.side_effect = CategoryHasItemsError(3)

        with pytest.raises(HTTPException) as exc:
            await _delete(MEDICAL_CAT)

        assert exc.value.status_code == 409
        assert "3 supplies use this category" in exc.value.detail
        svc.audit.assert_not_awaited()

    async def test_any_other_refusal_is_a_bad_request(self, svc):
        svc.delete_category_permanently.side_effect = ValueError(
            "This category has subcategories."
        )

        with pytest.raises(HTTPException) as exc:
            await _delete(MEDICAL_CAT)

        assert exc.value.status_code == 400

    async def test_a_category_deleted_between_preflight_and_lock_is_not_found(
        self, svc
    ):
        svc.delete_category_permanently.side_effect = LookupError("Category not found")

        with pytest.raises(HTTPException) as exc:
            await _delete(MEDICAL_CAT)

        assert exc.value.status_code == 404
        svc.audit.assert_not_awaited()


@pytest.mark.unit
class TestCategoryHasItemsError:
    def test_message_counts_and_pluralises(self):
        assert str(CategoryHasItemsError(1)).startswith("1 supply uses this category")
        assert str(CategoryHasItemsError(2)).startswith("2 supplies use this category")

    def test_is_a_value_error_so_unaware_callers_still_get_a_400(self):
        assert isinstance(CategoryHasItemsError(1), ValueError)


# The helpers below commit rather than flush. A refused delete rolls back, as
# it must in production to release its row locks, and a rollback discards
# anything only flushed — including the fixtures. In this suite a commit just
# releases a savepoint; the outer transaction is still rolled back at teardown.


async def _org(db):
    org = Organization(name="Delete FD", slug=f"delete-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.commit()
    return org


async def _category(db, org, item_type=ItemType.MEDICAL, parent=None, name=None):
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name or f"cat-{uuid.uuid4().hex[:6]}",
        item_type=item_type,
        parent_category_id=parent.id if parent else None,
    )
    db.add(category)
    await db.commit()
    return category


async def _item(db, org, category, active=True):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        category_id=category.id,
        name=f"gauze-{uuid.uuid4().hex[:6]}",
        tracking_type=TrackingType.POOL,
        quantity=10,
        active=active,
    )
    db.add(item)
    await db.commit()
    return item


async def _exists(db, category_id) -> bool:
    return bool(
        await db.scalar(
            select(func.count(InventoryCategory.id)).where(
                InventoryCategory.id == category_id
            )
        )
    )


async def _category_of(db, item_id):
    return await db.scalar(
        select(InventoryItem.category_id).where(InventoryItem.id == item_id)
    )


@pytest.mark.integration
class TestDeleteCategoryPermanently:
    async def test_an_empty_category_is_deleted(self, db_session):
        org = await _org(db_session)
        category = await _category(db_session, org, name="Airway")

        result = await InventoryService(db_session).delete_category_permanently(
            category.id, org.id, MEDICAL_ITEM_TYPES
        )

        assert result == {
            "category_name": "Airway",
            "items_moved": 0,
            "moved_to_name": None,
        }
        assert not await _exists(db_session, category.id)

    async def test_items_are_moved_and_the_category_is_deleted(self, db_session):
        org = await _org(db_session)
        source = await _category(db_session, org)
        target = await _category(db_session, org, name="Trauma")
        first = await _item(db_session, org, source)
        second = await _item(db_session, org, source)

        result = await InventoryService(db_session).delete_category_permanently(
            source.id, org.id, MEDICAL_ITEM_TYPES, move_items_to=target.id
        )

        assert result["items_moved"] == 2
        assert result["moved_to_name"] == "Trauma"
        assert not await _exists(db_session, source.id)
        assert await _category_of(db_session, first.id) == target.id
        assert await _category_of(db_session, second.id) == target.id

    async def test_retired_items_move_too(self, db_session):
        """A retired supply keeps its history under its category.

        Counting only active items would leave it to the SET NULL foreign key,
        after which it reads as gear.
        """
        org = await _org(db_session)
        source = await _category(db_session, org)
        target = await _category(db_session, org)
        retired = await _item(db_session, org, source, active=False)

        result = await InventoryService(db_session).delete_category_permanently(
            source.id, org.id, MEDICAL_ITEM_TYPES, move_items_to=target.id
        )

        assert result["items_moved"] == 1
        assert await _category_of(db_session, retired.id) == target.id

    async def test_items_without_a_target_refuse_and_change_nothing(self, db_session):
        org = await _org(db_session)
        source = await _category(db_session, org)
        item = await _item(db_session, org, source)
        org_id, source_id, item_id = org.id, source.id, item.id

        with pytest.raises(CategoryHasItemsError) as exc:
            await InventoryService(db_session).delete_category_permanently(
                source_id, org_id, MEDICAL_ITEM_TYPES
            )

        assert exc.value.item_count == 1
        assert await _exists(db_session, source_id)
        assert await _category_of(db_session, item_id) == source_id

    async def test_a_category_with_subcategories_is_refused(self, db_session):
        org = await _org(db_session)
        parent = await _category(db_session, org)
        child = await _category(db_session, org, parent=parent)
        org_id, parent_id, child_id = org.id, parent.id, child.id

        with pytest.raises(ValueError, match="subcategories"):
            await InventoryService(db_session).delete_category_permanently(
                parent_id, org_id, MEDICAL_ITEM_TYPES
            )

        assert await _exists(db_session, parent_id)
        assert await _exists(db_session, child_id)

    async def test_a_category_cannot_be_moved_into_itself(self, db_session):
        org = await _org(db_session)
        category = await _category(db_session, org)

        with pytest.raises(ValueError, match="different category"):
            await InventoryService(db_session).delete_category_permanently(
                category.id, org.id, MEDICAL_ITEM_TYPES, move_items_to=category.id
            )

        assert await _exists(db_session, category.id)

    async def test_a_gear_target_is_refused(self, db_session):
        org = await _org(db_session)
        source = await _category(db_session, org)
        gear = await _category(db_session, org, item_type=ItemType.EQUIPMENT)
        item = await _item(db_session, org, source)
        org_id, source_id, gear_id, item_id = org.id, source.id, gear.id, item.id

        with pytest.raises(LookupError):
            await InventoryService(db_session).delete_category_permanently(
                source_id, org_id, MEDICAL_ITEM_TYPES, move_items_to=gear_id
            )

        assert await _exists(db_session, source_id)
        assert await _category_of(db_session, item_id) == source_id

    async def test_a_gear_category_is_not_deletable_here(self, db_session):
        org = await _org(db_session)
        gear = await _category(db_session, org, item_type=ItemType.EQUIPMENT)
        org_id, gear_id = org.id, gear.id

        with pytest.raises(LookupError):
            await InventoryService(db_session).delete_category_permanently(
                gear_id, org_id, MEDICAL_ITEM_TYPES
            )

        assert await _exists(db_session, gear_id)

    async def test_another_organizations_category_is_not_deletable(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        foreign = await _category(db_session, theirs)
        mine_id, foreign_id = mine.id, foreign.id

        with pytest.raises(LookupError):
            await InventoryService(db_session).delete_category_permanently(
                foreign_id, mine_id, MEDICAL_ITEM_TYPES
            )

        assert await _exists(db_session, foreign_id)

    async def test_another_organizations_category_is_not_a_move_target(
        self, db_session
    ):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        source = await _category(db_session, mine)
        foreign = await _category(db_session, theirs)
        item = await _item(db_session, mine, source)
        mine_id, source_id, foreign_id, item_id = (
            mine.id,
            source.id,
            foreign.id,
            item.id,
        )

        with pytest.raises(LookupError):
            await InventoryService(db_session).delete_category_permanently(
                source_id, mine_id, MEDICAL_ITEM_TYPES, move_items_to=foreign_id
            )

        assert await _category_of(db_session, item_id) == source_id
