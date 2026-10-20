"""
Inventory input-validation edge cases found by driving the module end to end.

Each class pins one defect that reached the database (or a confusing error)
before the fix:

  - whitespace-only names were stored
  - numbers a column cannot hold passed validation and failed at flush
  - a duplicate asset tag / barcode (or a serial held by a retired item)
    surfaced as "An unexpected error occurred"
  - the assign endpoint acted on the body's item id and ignored the URL's
  - an assigned item could have its tracking mode flipped underneath it
  - a category could be made its own ancestor
"""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints.inventory import assign_item
from app.models.inventory import ItemCondition, ItemStatus, TrackingType
from app.schemas.inventory import (
    FLOAT32_MAX,
    INT32_MAX,
    MONEY_MAX,
    InventoryCategoryCreate,
    InventoryCategoryUpdate,
    InventoryItemBulkEntry,
    InventoryItemCreate,
    InventoryItemUpdate,
    ItemAssignmentCreate,
)
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.unit


# ============================================
# Schemas
# ============================================


class TestNameTrimming:
    @pytest.mark.parametrize(
        "build",
        [
            lambda n: InventoryItemCreate(name=n),
            lambda n: InventoryItemUpdate(name=n),
            lambda n: InventoryCategoryCreate(name=n, item_type="equipment"),
            lambda n: InventoryCategoryUpdate(name=n),
            lambda n: InventoryItemBulkEntry(name=n),
        ],
    )
    @pytest.mark.parametrize("blank", ["", " ", "   ", "\t", "\n "])
    def test_blank_name_rejected(self, build, blank):
        with pytest.raises(ValidationError):
            build(blank)

    def test_name_is_trimmed(self):
        assert InventoryItemCreate(name="  Halligan  ").name == "Halligan"
        assert InventoryItemUpdate(name="  Halligan  ").name == "Halligan"

    def test_max_length_applies_after_trim(self):
        assert len(InventoryItemCreate(name=" " + "n" * 255 + " ").name) == 255
        with pytest.raises(ValidationError):
            InventoryItemCreate(name="n" * 256)

    def test_update_without_name_leaves_it_unset(self):
        assert "name" not in InventoryItemUpdate().model_dump(exclude_unset=True)


class TestColumnBounds:
    """The maximum is accepted and one past it is not, for create and update."""

    @pytest.mark.parametrize(
        ("field", "ok", "too_big"),
        [
            ("quantity", INT32_MAX, INT32_MAX + 1),
            ("reorder_point", INT32_MAX, INT32_MAX + 1),
            ("expected_lifetime_years", INT32_MAX, INT32_MAX + 1),
            ("inspection_interval_days", INT32_MAX, INT32_MAX + 1),
            ("purchase_price", MONEY_MAX, MONEY_MAX + Decimal("0.01")),
            ("current_value", MONEY_MAX, MONEY_MAX + Decimal("0.01")),
            ("replacement_cost", MONEY_MAX, MONEY_MAX + Decimal("0.01")),
            ("weight", FLOAT32_MAX, 1e308),
        ],
    )
    @pytest.mark.parametrize("schema", [InventoryItemCreate, InventoryItemUpdate])
    def test_item_field_bounds(self, schema, field, ok, too_big):
        extra = {"name": "x"} if schema is InventoryItemCreate else {}
        schema(**extra, **{field: ok})
        with pytest.raises(ValidationError):
            schema(**extra, **{field: too_big})

    def test_infinite_weight_rejected(self):
        with pytest.raises(ValidationError):
            InventoryItemCreate(name="x", weight=float("inf"))

    @pytest.mark.parametrize(
        ("schema", "extra"),
        [
            (InventoryCategoryCreate, {"name": "c", "item_type": "equipment"}),
            (InventoryCategoryUpdate, {}),
        ],
    )
    def test_category_low_stock_threshold_bound(self, schema, extra):
        schema(**extra, low_stock_threshold=INT32_MAX)
        with pytest.raises(ValidationError):
            schema(**extra, low_stock_threshold=INT32_MAX + 1)

    def test_bounds_match_the_stored_money_column(self):
        from app.models.inventory import InventoryItem

        column = InventoryItem.__table__.c.purchase_price.type
        largest = Decimal(10 ** (column.precision - column.scale)) - Decimal(
            1
        ) / Decimal(10**column.scale)
        assert MONEY_MAX == largest


class TestIdentifierNormalisation:
    @pytest.mark.parametrize("schema", [InventoryItemCreate, InventoryItemUpdate])
    @pytest.mark.parametrize("field", ["serial_number", "asset_tag", "barcode"])
    def test_blank_becomes_none_and_value_is_trimmed(self, schema, field):
        extra = {"name": "x"} if schema is InventoryItemCreate else {}
        assert getattr(schema(**extra, **{field: "   "}), field) is None
        assert getattr(schema(**extra, **{field: ""}), field) is None
        assert getattr(schema(**extra, **{field: " AB-1 "}), field) == "AB-1"

    def test_omitted_identifier_stays_unset_on_update(self):
        assert "asset_tag" not in InventoryItemUpdate(name="x").model_dump(
            exclude_unset=True
        )


# ============================================
# Service
# ============================================


class _SavepointCM:
    async def __aenter__(self):
        return None

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    db.begin_nested = MagicMock(side_effect=lambda: _SavepointCM())
    return db


@pytest.fixture
def service(mock_db):
    svc = InventoryService(mock_db)
    svc._next_sequential_barcode = AsyncMock(return_value="INV-000001")
    return svc


@pytest.fixture
def org_id():
    return str(uuid4())


def _count(n):
    result = MagicMock()
    result.scalar.return_value = n
    return result


def _make_item(**overrides) -> MagicMock:
    defaults = {
        "id": str(uuid4()),
        "organization_id": str(uuid4()),
        "name": "Test Item",
        "status": ItemStatus.AVAILABLE,
        "condition": ItemCondition.GOOD,
        "active": True,
        "tracking_type": TrackingType.INDIVIDUAL,
        "quantity": 1,
        "quantity_issued": 0,
        "assigned_to_user_id": None,
        "assigned_date": None,
        "serial_number": None,
        "asset_tag": None,
        "barcode": "INV-000001",
        "inspection_interval_days": None,
        "storage_location": None,
        "status_notes": None,
        "category_id": None,
    }
    defaults.update(overrides)
    item = MagicMock()
    for key, value in defaults.items():
        setattr(item, key, value)
    return item


class TestIdentifierUniqueness:
    async def test_names_the_clashing_identifier(self, service, mock_db, org_id):
        mock_db.execute.return_value = _count(1)
        err = await service._check_identifier_unique(
            "asset_tag", "Asset tag", "AT-1", org_id
        )
        assert err == (
            "Asset tag 'AT-1' is already in use by another item in this organization"
        )

    async def test_unused_identifier_passes(self, service, mock_db, org_id):
        mock_db.execute.return_value = _count(0)
        assert (
            await service._check_identifier_unique("barcode", "Barcode", "B-1", org_id)
            is None
        )

    @pytest.mark.parametrize("blank", [None, ""])
    async def test_blank_skips_the_query(self, service, mock_db, org_id, blank):
        assert (
            await service._check_identifier_unique(
                "asset_tag", "Asset tag", blank, org_id
            )
            is None
        )
        mock_db.execute.assert_not_awaited()

    async def test_retired_items_are_counted(self, service, mock_db, org_id):
        """The uq_item_org_* constraints span every row, so the pre-check must
        too: filtering to active items let a retired item's serial reach the
        constraint and come back as an unexplained failure."""
        mock_db.execute.return_value = _count(0)
        await service._check_serial_number_unique("SN-1", org_id)
        sql = str(mock_db.execute.await_args.args[0])
        assert "active" not in sql

    async def test_update_excludes_the_item_itself(self, service, mock_db, org_id):
        mock_db.execute.return_value = _count(0)
        await service._check_identifier_unique(
            "barcode", "Barcode", "B-1", org_id, exclude_item_id=uuid4()
        )
        assert "inventory_items.id !=" in str(mock_db.execute.await_args.args[0])

    @pytest.mark.parametrize(
        ("column", "label"),
        [("asset_tag", "Asset tag"), ("barcode", "Barcode")],
    )
    async def test_create_rejects_a_duplicate(
        self, service, mock_db, org_id, column, label
    ):
        service._validate_category_requirements = AsyncMock(return_value=None)
        service._assert_item_fks_in_org = AsyncMock()
        service._check_serial_number_unique = AsyncMock(return_value=None)
        mock_db.execute.return_value = _count(1)

        item, err = await service.create_item(
            org_id, {"name": "Radio", column: "DUP"}, str(uuid4())
        )

        assert item is None
        assert err == (
            f"{label} 'DUP' is already in use by another item in this organization"
        )
        mock_db.add.assert_not_called()

    async def test_create_without_identifiers_does_not_query(
        self, service, mock_db, org_id
    ):
        service._validate_category_requirements = AsyncMock(return_value=None)
        service._assert_item_fks_in_org = AsyncMock()
        service._check_serial_number_unique = AsyncMock(return_value=None)
        service._check_identifier_unique = AsyncMock(return_value=None)

        item, err = await service.create_item(org_id, {"name": "Radio"}, str(uuid4()))

        assert err is None
        assert item is not None
        # An absent barcode is auto-assigned later; only supplied values are checked.
        for call in service._check_identifier_unique.await_args_list:
            assert call.args[2] is None

    @pytest.mark.parametrize("column", ["asset_tag", "barcode"])
    async def test_update_rejects_a_duplicate(self, service, mock_db, org_id, column):
        item = _make_item(**{column: "OLD"})
        service.get_item_by_id = AsyncMock(return_value=item)
        service._get_item_locked = AsyncMock(return_value=item)
        mock_db.execute.return_value = _count(1)

        result, err = await service.update_item(
            UUID(item.id), org_id, {column: "TAKEN"}
        )

        assert result is None
        assert "already in use" in (err or "")

    @pytest.mark.parametrize("column", ["asset_tag", "barcode"])
    async def test_update_to_the_same_value_skips_the_check(
        self, service, mock_db, org_id, column
    ):
        item = _make_item(**{column: "SAME"})
        service.get_item_by_id = AsyncMock(return_value=item)
        service._get_item_locked = AsyncMock(return_value=item)
        service._assert_item_fks_in_org = AsyncMock()
        service._check_identifier_unique = AsyncMock(return_value="would clash")

        result, err = await service.update_item(UUID(item.id), org_id, {column: "SAME"})

        assert err is None
        assert result is item
        service._check_identifier_unique.assert_not_awaited()


class TestTrackingTypeChange:
    async def _update(self, service, item, new_type):
        service.get_item_by_id = AsyncMock(return_value=item)
        service._get_item_locked = AsyncMock(return_value=item)
        service._assert_item_fks_in_org = AsyncMock()
        return await service.update_item(
            UUID(item.id), UUID(item.organization_id), {"tracking_type": new_type}
        )

    async def test_blocked_while_assigned(self, service):
        item = _make_item(status=ItemStatus.ASSIGNED, assigned_to_user_id=str(uuid4()))
        result, err = await self._update(service, item, "pool")
        assert result is None
        assert "Tracking type cannot be changed" in (err or "")

    async def test_blocked_while_stock_is_issued(self, service):
        item = _make_item(tracking_type=TrackingType.POOL, quantity_issued=3)
        result, err = await self._update(service, item, "individual")
        assert result is None
        assert "Tracking type cannot be changed" in (err or "")

    async def test_allowed_when_idle(self, service):
        item = _make_item()
        result, err = await self._update(service, item, "pool")
        assert err is None
        assert result is item

    async def test_resending_the_current_mode_is_not_a_change(self, service):
        """The edit form sends every field, so an assigned item's unchanged
        tracking type arrives on every save and must not be refused."""
        item = _make_item(status=ItemStatus.ASSIGNED, assigned_to_user_id=str(uuid4()))
        result, err = await self._update(service, item, "individual")
        assert err is None
        assert result is item

    async def test_row_is_locked_when_tracking_type_changes(self, service):
        item = _make_item()
        await self._update(service, item, "pool")
        service._get_item_locked.assert_awaited()


class TestCategoryCycles:
    @staticmethod
    def _parents(mock_db, chain):
        """db.execute answers each parent lookup from `chain`, in order."""
        results = []
        for parent in chain:
            r = MagicMock()
            r.scalar_one_or_none.return_value = parent
            results.append(r)
        mock_db.execute.side_effect = results

    async def test_self_parent_rejected(self, service, mock_db, org_id):
        cid = str(uuid4())
        with pytest.raises(ValueError, match="under itself"):
            await service._assert_not_under_itself(cid, cid, org_id)
        mock_db.execute.assert_not_awaited()

    async def test_descendant_parent_rejected(self, service, mock_db, org_id):
        top, mid, leaf = (str(uuid4()) for _ in range(3))
        # leaf -> mid -> top: making top a child of leaf closes the loop.
        self._parents(mock_db, [mid, top])
        with pytest.raises(ValueError, match="own subcategories"):
            await service._assert_not_under_itself(top, leaf, org_id)

    async def test_unrelated_parent_allowed(self, service, mock_db, org_id):
        category, parent, root = (str(uuid4()) for _ in range(3))
        self._parents(mock_db, [root, None])
        await service._assert_not_under_itself(category, parent, org_id)

    async def test_an_already_stored_loop_does_not_hang(self, service, mock_db, org_id):
        a, b, c = (str(uuid4()) for _ in range(3))
        # a <-> b already loop; c is not part of it.
        self._parents(mock_db, [b, a])
        await service._assert_not_under_itself(c, a, org_id)

    async def test_update_category_applies_the_guard(
        self, service, mock_db, org_id, monkeypatch
    ):
        category = SimpleNamespace(id=str(uuid4()), name="c")
        service.get_category_by_id = AsyncMock(return_value=category)
        service._assert_not_under_itself = AsyncMock(
            side_effect=ValueError("A category cannot be placed under itself")
        )
        monkeypatch.setattr("app.services.inventory_service.assert_in_org", AsyncMock())

        result, err = await service.update_category(
            UUID(category.id), org_id, {"parent_category_id": str(uuid4())}
        )

        assert result is None
        assert "under itself" in (err or "")
        mock_db.rollback.assert_awaited()


# ============================================
# Endpoint
# ============================================


class TestAssignEndpointItemId:
    async def test_mismatched_body_item_id_is_refused(self):
        url_item, body_item = uuid4(), uuid4()
        db = AsyncMock()
        user = SimpleNamespace(id=uuid4(), organization_id=uuid4(), username="chief")

        with pytest.raises(HTTPException) as caught:
            await assign_item(
                item_id=url_item,
                assignment_data=ItemAssignmentCreate(
                    item_id=body_item, user_id=uuid4()
                ),
                db=db,
                current_user=user,
            )

        assert caught.value.status_code == 400
        assert "does not match" in caught.value.detail
        db.execute.assert_not_awaited()
