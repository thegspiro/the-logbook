"""
INV-4 (app-review B3 pass 4): the inventory create/update methods that persist a
client-supplied FK id (category parent, item location/storage/variant-group/
assignee, maintenance performed_by, write-off clearance, return
assignment/issuance/checkout, reorder item/category, equipment-kit line items)
now validate that id against the caller's org via `assert_in_org` before storing
it — closing the dangling/mis-attributed cross-tenant FK class (XC-1).

DB-free: the mocked `db.execute` drives `is_in_org`'s single lookup, so a
`scalar_one_or_none()` of None means "foreign/nonexistent" and any value means
"in-org". Mirrors the apparatus AP2-1 test style.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.inventory_service import InventoryService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    db.flush = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return InventoryService(mock_db)


@pytest.fixture
def org_id():
    return str(uuid4())


def _result(value):
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    return r


class TestItemFkScoping:
    """_assert_item_fks_in_org — used by create_item and update_item."""

    async def test_foreign_location_rejected(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_result(None)]
        with pytest.raises(ValueError, match="location"):
            await service._assert_item_fks_in_org({"location_id": str(uuid4())}, org_id)

    async def test_foreign_assignee_rejected(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_result(None)]
        with pytest.raises(ValueError, match="assignee"):
            await service._assert_item_fks_in_org(
                {"assigned_to_user_id": str(uuid4())}, org_id
            )

    async def test_all_in_org_passes(self, service, mock_db, org_id):
        # location, storage_area, variant_group, assignee — each resolves in-org.
        mock_db.execute.side_effect = [_result("x")] * 4
        await service._assert_item_fks_in_org(
            {
                "location_id": str(uuid4()),
                "storage_area_id": str(uuid4()),
                "variant_group_id": str(uuid4()),
                "assigned_to_user_id": str(uuid4()),
            },
            org_id,
        )
        assert mock_db.execute.await_count == 4

    async def test_absent_keys_run_no_query(self, service, mock_db, org_id):
        # A partial update that mentions no FK field must not query — and must not
        # validate an unmentioned FK as if it were being cleared.
        await service._assert_item_fks_in_org({"name": "Helmet"}, org_id)
        mock_db.execute.assert_not_called()

    async def test_explicit_none_allowed(self, service, mock_db, org_id):
        # Clearing an optional FK (location_id=None) is allowed and short-circuits
        # before any query (is_in_org fails closed on a falsy id, allow_none lets
        # it through).
        await service._assert_item_fks_in_org({"location_id": None}, org_id)
        mock_db.execute.assert_not_called()


class TestReorderFkScoping:
    """_assert_reorder_fks_in_org — used by create/update_reorder_request."""

    async def test_foreign_item_rejected(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_result(None)]
        with pytest.raises(ValueError, match="item"):
            await service._assert_reorder_fks_in_org({"item_id": str(uuid4())}, org_id)

    async def test_foreign_category_rejected(self, service, mock_db, org_id):
        # item_id in-org (1st lookup), category_id foreign (2nd lookup).
        mock_db.execute.side_effect = [_result("x"), _result(None)]
        with pytest.raises(ValueError, match="category"):
            await service._assert_reorder_fks_in_org(
                {"item_id": str(uuid4()), "category_id": str(uuid4())}, org_id
            )

    async def test_partial_checks_only_present_key(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_result("x")]
        await service._assert_reorder_fks_in_org({"item_id": str(uuid4())}, org_id)
        assert mock_db.execute.await_count == 1


class TestCreateReturnRequestFkScoping:
    """create_return_request validates the cited assignment/issuance/checkout."""

    async def test_foreign_assignment_rejected(self, service, mock_db, org_id):
        item = MagicMock()
        # 1: item fetch (in-org). 2: duplicate-request check (none). 3:
        # assert_in_org(ItemAssignment) lookup returns nothing -> foreign.
        mock_db.execute.side_effect = [
            _result(item),
            _result(None),
            _result(None),
        ]
        with pytest.raises(ValueError, match="assignment"):
            await service.create_return_request(
                organization_id=org_id,
                requester_id=str(uuid4()),
                return_type="full",
                item_id=str(uuid4()),
                assignment_id=str(uuid4()),
            )


class TestCreateCategoryParentScoping:
    """create_category rejects a foreign parent_category_id."""

    async def test_foreign_parent_rejected(self, service, mock_db, org_id):
        # create_category is wrapped in try/except -> (None, error) tuple.
        mock_db.execute.side_effect = [_result(None)]
        result, error = await service.create_category(
            org_id,
            {"name": "Turnout Gear", "parent_category_id": str(uuid4())},
            str(uuid4()),
        )
        assert result is None
        assert error is not None
        assert "parent category" in error
