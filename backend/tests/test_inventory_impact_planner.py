"""
Inventory Impact Planner Unit Tests

Tests for the impact-planner logic on InventoryService using a mocked
database session (no live DB required, mirroring test_inventory_service.py):

  - _format_needed_size rendering for each garment/size field
  - analyze_impact aggregation: counts, contact gating, size breakdown,
    and "already holds a comparable item" detection
  - get_impact_planner_options shape
"""

from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.inventory import ItemStatus, TrackingType
from app.services.inventory_service import InventoryService


# ============================================
# Fixtures / helpers
# ============================================

@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return InventoryService(mock_db)


def _scalars_result(items):
    """A db.execute() result whose .scalars().all() yields *items*."""
    res = MagicMock()
    res.scalars.return_value.all.return_value = items
    return res


def _rows_result(rows):
    """A db.execute() result whose .all() yields *rows* (tuples)."""
    res = MagicMock()
    res.all.return_value = rows
    return res


def _user(uid, first, last, **kwargs):
    return SimpleNamespace(
        id=uid,
        first_name=first,
        last_name=last,
        full_name=f"{first} {last}".strip(),
        membership_number=kwargs.get("membership_number"),
        rank=kwargs.get("rank"),
        station=kwargs.get("station"),
        status=kwargs.get("status", "active"),
        membership_type=kwargs.get("membership_type", "active"),
        email=kwargs.get("email"),
        phone=kwargs.get("phone"),
        mobile=kwargs.get("mobile"),
    )


def _stock_item(
    size=None,
    standard_size=None,
    pool=False,
    quantity=0,
    issued=0,
    status=ItemStatus.AVAILABLE,
    replacement_cost=None,
    purchase_price=None,
):
    return SimpleNamespace(
        tracking_type=TrackingType.POOL if pool else TrackingType.INDIVIDUAL,
        quantity=quantity,
        quantity_issued=issued,
        status=status,
        standard_size=standard_size,
        size=size,
        replacement_cost=replacement_cost,
        purchase_price=purchase_price,
    )


def _prefs(uid, **kwargs):
    base = {
        "user_id": uid,
        "shirt_size": None,
        "shirt_style": None,
        "pant_waist": None,
        "pant_inseam": None,
        "jacket_size": None,
        "boot_size": None,
        "boot_width": None,
        "glove_size": None,
        "hat_size": None,
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


# ============================================
# _format_needed_size
# ============================================

class TestFormatNeededSize:

    def test_none_prefs_or_field(self):
        assert InventoryService._format_needed_size(None, "shirt") is None
        assert InventoryService._format_needed_size(_prefs("u"), None) is None

    def test_simple_fields(self):
        p = _prefs(
            "u", shirt_size="M", jacket_size="L", glove_size="9", hat_size="7.25"
        )
        assert InventoryService._format_needed_size(p, "shirt") == "M"
        assert InventoryService._format_needed_size(p, "jacket") == "L"
        assert InventoryService._format_needed_size(p, "glove") == "9"
        assert InventoryService._format_needed_size(p, "hat") == "7.25"

    def test_boot_with_and_without_width(self):
        assert (
            InventoryService._format_needed_size(
                _prefs("u", boot_size="10", boot_width="Wide"), "boot"
            )
            == "10 (Wide)"
        )
        assert (
            InventoryService._format_needed_size(
                _prefs("u", boot_size="10"), "boot"
            )
            == "10"
        )
        assert (
            InventoryService._format_needed_size(_prefs("u"), "boot") is None
        )

    def test_pant_combinations(self):
        assert (
            InventoryService._format_needed_size(
                _prefs("u", pant_waist="34", pant_inseam="32"), "pant"
            )
            == "34 x 32"
        )
        assert (
            InventoryService._format_needed_size(
                _prefs("u", pant_waist="34"), "pant"
            )
            == "34"
        )
        assert (
            InventoryService._format_needed_size(_prefs("u"), "pant") is None
        )

    def test_missing_value_returns_none(self):
        assert (
            InventoryService._format_needed_size(_prefs("u"), "shirt") is None
        )


# ============================================
# analyze_impact
# ============================================

class TestAnalyzeImpact:

    @pytest.mark.asyncio
    async def test_aggregates_sizes_and_related_holdings(self, service, mock_db):
        org_id = str(uuid4())
        cat_id = str(uuid4())
        u1, u2, u3 = "u1", "u2", "u3"
        users = [
            _user(u1, "Amy", "Adams", rank="firefighter", station="S1"),
            _user(u2, "Bob", "Baker", rank="firefighter", station="S1"),
            _user(u3, "Cy", "Clark", rank="captain", station="S2"),
        ]
        # u1 -> M, u2 -> L, u3 -> no size on file
        prefs = [_prefs(u1, shirt_size="M"), _prefs(u2, shirt_size="L")]
        # u2 already holds a (serviceable) item in the related category.
        # Rows: (user_id, name, condition, retirement_date, retired_by_age)
        assign_rows = [(u2, "Old Jacket", "good", None, None)]
        issue_rows = []

        mock_db.execute.side_effect = [
            _scalars_result(users),
            _scalars_result(prefs),
            _rows_result(assign_rows),
            _rows_result(issue_rows),
        ]

        result = await service.analyze_impact(
            organization_id=org_id,
            filters={
                "statuses": ["active"],
                "related_category_id": cat_id,
                "size_field": "shirt",
            },
            include_contact=False,
        )

        assert result["total_members"] == 3
        assert result["members_with_related_item"] == 1
        assert result["members_needing_item"] == 2
        # u3 needs the item but has no size on file
        assert result["members_missing_sizes"] == 1
        assert result["size_field"] == "shirt"

        # "Unknown" bucket sorts last; real sizes are alphabetical.
        breakdown = {b["size"]: b for b in result["size_breakdown"]}
        assert breakdown["M"] == {"size": "M", "total": 1, "needing": 1}
        assert breakdown["L"] == {"size": "L", "total": 1, "needing": 0}
        assert breakdown["Unknown"] == {
            "size": "Unknown",
            "total": 1,
            "needing": 1,
        }
        assert result["size_breakdown"][-1]["size"] == "Unknown"

        members = {m["user_id"]: m for m in result["members"]}
        assert members[u1]["needed_size"] == "M"
        assert members[u1]["has_related_item"] is False
        assert members[u2]["has_related_item"] is True
        assert members[u2]["related_item_names"] == ["Old Jacket"]
        assert members[u3]["has_size_on_file"] is False

    @pytest.mark.asyncio
    async def test_contact_fields_gated(self, service, mock_db):
        org_id = str(uuid4())
        users = [_user("u1", "Amy", "Adams", email="amy@x.org", phone="555-1")]

        # include_contact=False -> no size_field, no related category:
        # only the users query runs.
        mock_db.execute.side_effect = [_scalars_result(users)]
        result = await service.analyze_impact(
            organization_id=org_id, filters={}, include_contact=False
        )
        assert result["members"][0]["email"] is None
        assert result["members"][0]["phone"] is None

        mock_db.execute.side_effect = [_scalars_result(users)]
        result = await service.analyze_impact(
            organization_id=org_id, filters={}, include_contact=True
        )
        assert result["members"][0]["email"] == "amy@x.org"
        assert result["members"][0]["phone"] == "555-1"

    @pytest.mark.asyncio
    async def test_phone_falls_back_to_mobile(self, service, mock_db):
        org_id = str(uuid4())
        users = [_user("u1", "Amy", "Adams", phone=None, mobile="555-9")]
        mock_db.execute.side_effect = [_scalars_result(users)]
        result = await service.analyze_impact(
            organization_id=org_id, filters={}, include_contact=True
        )
        assert result["members"][0]["phone"] == "555-9"

    @pytest.mark.asyncio
    async def test_no_size_field_skips_breakdown(self, service, mock_db):
        org_id = str(uuid4())
        users = [_user("u1", "Amy", "Adams")]
        mock_db.execute.side_effect = [_scalars_result(users)]
        result = await service.analyze_impact(
            organization_id=org_id, filters={}, include_contact=False
        )
        assert result["size_breakdown"] == []
        assert result["members_missing_sizes"] == 0
        assert result["size_field"] is None


# ============================================
# Stock-aware shortfall
# ============================================

class TestNormalizeSizeKey:

    def test_alias_canonicalisation(self):
        assert InventoryService._normalize_size_key("3XL") == "xxxl"
        assert InventoryService._normalize_size_key("XXXL") == "xxxl"
        assert InventoryService._normalize_size_key("Medium") == "m"
        assert InventoryService._normalize_size_key("M") == "m"

    def test_drops_parenthetical_and_collapses_space(self):
        assert InventoryService._normalize_size_key("10 (Wide)") == "10"
        assert InventoryService._normalize_size_key("  34  x 32 ") == "34 x 32"

    def test_empty(self):
        assert InventoryService._normalize_size_key(None) == ""


class TestItemStockSizeValue:

    def test_prefers_standard_size_skips_custom(self):
        # 'custom' sentinel falls through to the free-text size
        assert (
            InventoryService._item_stock_size_value(
                _stock_item(size="34W", standard_size="custom")
            )
            == "34W"
        )
        assert (
            InventoryService._item_stock_size_value(
                _stock_item(size="ignored", standard_size="l")
            )
            == "l"
        )
        assert (
            InventoryService._item_stock_size_value(_stock_item(size="M"))
            == "M"
        )


class TestStockAndCostBySize:

    @pytest.mark.asyncio
    async def test_pool_and_individual_counts(self, service, mock_db):
        items = [
            # pool: 3 on hand, 1 issued -> 2 available "M"
            _stock_item(standard_size="m", pool=True, quantity=3, issued=1),
            # individual available "M" -> +1
            _stock_item(size="M", status=ItemStatus.AVAILABLE),
            # individual assigned -> not counted toward stock
            _stock_item(size="M", status=ItemStatus.ASSIGNED),
            # individual available "L"
            _stock_item(standard_size="l", status=ItemStatus.AVAILABLE),
        ]
        mock_db.execute.side_effect = [_scalars_result(items)]
        stock, _unit, _avg = await service._get_stock_and_cost_by_size(
            "org", "cat"
        )
        assert stock == {"m": 3, "l": 1}

    @pytest.mark.asyncio
    async def test_cost_averaging_and_fallback(self, service, mock_db):
        items = [
            # two priced "M" items -> mean 110.0; replacement_cost preferred
            _stock_item(standard_size="m", replacement_cost=100, purchase_price=50),
            _stock_item(standard_size="m", replacement_cost=120),
            # "L" item priced via purchase_price fallback
            _stock_item(standard_size="l", purchase_price=200),
            # unpriced item is ignored for cost
            _stock_item(standard_size="xl"),
        ]
        mock_db.execute.side_effect = [_scalars_result(items)]
        _stock, unit_cost, avg = await service._get_stock_and_cost_by_size(
            "org", "cat"
        )
        assert unit_cost["m"] == 110.0
        assert unit_cost["l"] == 200.0
        assert "xl" not in unit_cost
        # category mean across the three priced items
        assert avg == round((100 + 120 + 200) / 3, 2)


class TestAnalyzeImpactStockAware:

    @pytest.mark.asyncio
    async def test_shortfall_nets_demand_against_stock(self, service, mock_db):
        org_id = str(uuid4())
        users = [
            _user("u1", "Amy", "Adams"),
            _user("u2", "Bob", "Baker"),
            _user("u3", "Cy", "Clark"),
        ]
        prefs = [_prefs("u1", shirt_size="M"), _prefs("u2", shirt_size="M")]
        # 2 "M" available on hand; "Unknown" (u3) cannot be matched
        stock_items = [
            _stock_item(standard_size="m", pool=True, quantity=2, issued=0),
        ]
        mock_db.execute.side_effect = [
            _scalars_result(users),       # users
            _scalars_result(prefs),       # size prefs
            _scalars_result(stock_items),  # stock lookup
        ]

        result = await service.analyze_impact(
            organization_id=org_id,
            filters={
                "size_field": "shirt",
                "stock_category_id": str(uuid4()),
            },
            include_contact=False,
        )

        assert result["stock_checked"] is True
        breakdown = {b["size"]: b for b in result["size_breakdown"]}
        # 2 need M, 2 on hand -> buy 0
        assert breakdown["M"]["on_hand"] == 2
        assert breakdown["M"]["shortfall"] == 0
        # 1 needs unknown size, 0 matchable on hand -> buy 1
        assert breakdown["Unknown"]["on_hand"] == 0
        assert breakdown["Unknown"]["shortfall"] == 1
        assert result["total_to_purchase"] == 1

    @pytest.mark.asyncio
    async def test_cost_estimate_from_priced_stock(self, service, mock_db):
        org_id = str(uuid4())
        users = [_user("u1", "Amy", "Adams"), _user("u2", "Bob", "Baker")]
        prefs = [_prefs("u1", shirt_size="M"), _prefs("u2", shirt_size="M")]
        # No M on hand, priced at $180 each -> buy 2, cost 360
        stock_items = [
            _stock_item(standard_size="m", pool=True, quantity=0, replacement_cost=180),
        ]
        mock_db.execute.side_effect = [
            _scalars_result(users),
            _scalars_result(prefs),
            _scalars_result(stock_items),
        ]
        result = await service.analyze_impact(
            organization_id=org_id,
            filters={"size_field": "shirt", "stock_category_id": str(uuid4())},
            include_contact=False,
        )
        assert result["cost_estimated"] is True
        assert result["estimated_total_cost"] == 360.0
        m = next(b for b in result["size_breakdown"] if b["size"] == "M")
        assert m["unit_cost"] == 180.0
        assert m["estimated_cost"] == 360.0

    @pytest.mark.asyncio
    async def test_no_prices_leaves_cost_unset(self, service, mock_db):
        org_id = str(uuid4())
        users = [_user("u1", "Amy", "Adams")]
        prefs = [_prefs("u1", shirt_size="M")]
        stock_items = [_stock_item(standard_size="m", pool=True, quantity=0)]
        mock_db.execute.side_effect = [
            _scalars_result(users),
            _scalars_result(prefs),
            _scalars_result(stock_items),
        ]
        result = await service.analyze_impact(
            organization_id=org_id,
            filters={"size_field": "shirt", "stock_category_id": str(uuid4())},
            include_contact=False,
        )
        assert result["cost_estimated"] is False
        assert result["estimated_total_cost"] is None

    @pytest.mark.asyncio
    async def test_no_stock_category_leaves_fields_unset(self, service, mock_db):
        org_id = str(uuid4())
        users = [_user("u1", "Amy", "Adams")]
        prefs = [_prefs("u1", shirt_size="M")]
        mock_db.execute.side_effect = [
            _scalars_result(users),
            _scalars_result(prefs),
        ]
        result = await service.analyze_impact(
            organization_id=org_id,
            filters={"size_field": "shirt"},
            include_contact=False,
        )
        assert result["stock_checked"] is False
        assert result["total_to_purchase"] is None
        assert result["size_breakdown"][0].get("on_hand") is None


# ============================================
# Replacement-aware targeting
# ============================================

class TestReplacementAware:

    @pytest.mark.asyncio
    async def test_worn_and_expired_count_as_needing(self, service, mock_db):
        org_id = str(uuid4())
        cat_id = str(uuid4())
        users = [
            _user("u1", "Amy", "Adams"),   # worn item -> needs replacement
            _user("u2", "Bob", "Baker"),   # good item -> covered
            _user("u3", "Cy", "Clark"),    # expired item -> needs replacement
            _user("u4", "Di", "Dunn"),     # holds nothing -> needs item
        ]
        past = date.today() - timedelta(days=1)
        # (user_id, name, condition, retirement_date, retired_by_age)
        assign_rows = [
            ("u1", "Worn Coat", "damaged", None, None),
            ("u2", "Good Coat", "good", None, None),
            ("u3", "Aged Coat", "good", past, None),
        ]
        issue_rows = []
        mock_db.execute.side_effect = [
            _scalars_result(users),
            _rows_result(assign_rows),
            _rows_result(issue_rows),
        ]

        result = await service.analyze_impact(
            organization_id=org_id,
            filters={
                "related_category_id": cat_id,
                "replacement_aware": True,
            },
            include_contact=False,
        )

        assert result["replacement_aware"] is True
        # only u2 holds a serviceable item
        assert result["members_with_related_item"] == 1
        assert result["members_needing_item"] == 3
        # u1 (worn) + u3 (expired) hold something but need replacing
        assert result["members_needing_replacement"] == 2

        members = {m["user_id"]: m for m in result["members"]}
        assert members["u1"]["needs_replacement"] is True
        assert members["u1"]["has_related_item"] is False
        assert members["u2"]["has_related_item"] is True
        assert members["u2"]["needs_replacement"] is False
        assert members["u3"]["needs_replacement"] is True
        assert members["u4"]["needs_replacement"] is False

    @pytest.mark.asyncio
    async def test_disabled_treats_worn_as_covered(self, service, mock_db):
        org_id = str(uuid4())
        cat_id = str(uuid4())
        users = [_user("u1", "Amy", "Adams")]
        assign_rows = [("u1", "Worn Coat", "damaged", None, None)]
        mock_db.execute.side_effect = [
            _scalars_result(users),
            _rows_result(assign_rows),
            _rows_result([]),
        ]
        result = await service.analyze_impact(
            organization_id=org_id,
            filters={"related_category_id": cat_id},
            include_contact=False,
        )
        # Default behaviour: holding anything counts as covered.
        assert result["members_with_related_item"] == 1
        assert result["members_needing_replacement"] == 0
        assert result["members"][0]["has_related_item"] is True
        assert result["members"][0]["needs_replacement"] is False


# ============================================
# create_reorder_from_plan
# ============================================

class TestCreateReorderFromPlan:

    @pytest.mark.asyncio
    async def test_creates_one_reorder_per_size_with_shortfall(
        self, service, mock_db
    ):
        org_id = str(uuid4())
        cat_id = str(uuid4())
        users = [
            _user("u1", "Amy", "Adams"),
            _user("u2", "Bob", "Baker"),
            _user("u3", "Cy", "Clark"),
            _user("u4", "Di", "Dunn"),
        ]
        # u1,u2 -> M ; u3 -> L ; u4 -> no size (Unknown)
        prefs = [
            _prefs("u1", shirt_size="M"),
            _prefs("u2", shirt_size="M"),
            _prefs("u3", shirt_size="L"),
        ]
        # 1 M on hand (priced $90) -> M shortfall 1 ; 0 L on hand -> L shortfall 1
        stock_items = [
            _stock_item(standard_size="m", pool=True, quantity=1, replacement_cost=90),
        ]

        # analyze_impact issues: users, prefs, stock. Then the reorder method
        # fetches the category (db.scalar) and refreshes created rows.
        mock_db.execute.side_effect = [
            _scalars_result(users),
            _scalars_result(prefs),
            _scalars_result(stock_items),
        ]
        mock_db.scalar = AsyncMock(return_value=SimpleNamespace(name="Jackets"))
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock()

        result = await service.create_reorder_from_plan(
            organization_id=org_id,
            filters={"size_field": "shirt", "stock_category_id": cat_id},
            reorder_meta={"urgency": "high", "vendor": "Acme"},
            requested_by="admin",
        )

        # M (shortfall 1) and L (shortfall 1); Unknown skipped
        assert result["created_count"] == 2
        assert result["total_quantity"] == 2
        assert result["skipped_unknown_size"] == 1
        names = {r["item_name"] for r in result["reorder_requests"]}
        assert names == {"Jackets — M", "Jackets — L"}
        # Reorder rows were added with the chosen vendor/urgency
        added = {r.item_name: r for r in
                 (c.args[0] for c in mock_db.add.call_args_list)}
        assert all(r.vendor == "Acme" and r.urgency == "high"
                   for r in added.values())
        assert all(r.category_id == cat_id for r in added.values())
        # The cost estimate flows onto the reorders: M from its own price,
        # L from the category-average fallback (no L-specific price).
        assert added["Jackets — M"].estimated_unit_cost == 90.0
        assert added["Jackets — L"].estimated_unit_cost == 90.0

    @pytest.mark.asyncio
    async def test_requires_stock_category(self, service, mock_db):
        org_id = str(uuid4())
        users = [_user("u1", "Amy", "Adams")]
        prefs = [_prefs("u1", shirt_size="M")]
        # No stock_category_id -> stock_checked is False -> ValueError
        mock_db.execute.side_effect = [
            _scalars_result(users),
            _scalars_result(prefs),
        ]
        with pytest.raises(ValueError):
            await service.create_reorder_from_plan(
                organization_id=org_id,
                filters={"size_field": "shirt"},
                reorder_meta={},
                requested_by="admin",
            )


# ============================================
# bulk_issue_from_plan
# ============================================

class TestBulkIssueFromPlan:

    @pytest.mark.asyncio
    async def test_issues_to_needing_members_and_skips(self, service, mock_db):
        org_id = str(uuid4())
        cat_id = str(uuid4())
        users = [
            _user("u1", "Amy", "Adams"),   # M, will be issued
            _user("u2", "Bob", "Baker"),   # already has -> not a target
            _user("u3", "Cy", "Clark"),    # no size -> skipped
            _user("u4", "Di", "Dunn"),     # L, no L stock -> skipped
        ]
        prefs = [
            _prefs("u1", shirt_size="M"),
            _prefs("u2", shirt_size="M"),
            _prefs("u4", shirt_size="L"),
        ]
        assign_rows = [("u2", "Dept Polo M", "good", None, None)]
        # analyze_impact: users, prefs, assign, issue
        # bulk: pool items lookup (1 execute)
        pool_items = [
            _stock_item(standard_size="m", pool=True, quantity=5),
        ]
        for it in pool_items:
            it.id = "item-m"
            it.name = "Dept Polo M"
        mock_db.execute.side_effect = [
            _scalars_result(users),          # analyze: users
            _scalars_result(prefs),          # analyze: size prefs
            _rows_result(assign_rows),       # analyze: related assignments
            _rows_result([]),                # analyze: related issuances
            _scalars_result([]),             # analyze: stock+cost lookup
            _scalars_result(pool_items),     # bulk: available pool items
        ]
        # issue_from_pool is exercised separately; stub it here.
        service.issue_from_pool = AsyncMock(
            return_value=(SimpleNamespace(id="iss-1"), None)
        )

        result = await service.bulk_issue_from_plan(
            organization_id=org_id,
            filters={
                "related_category_id": cat_id,
                "size_field": "shirt",
                "stock_category_id": cat_id,
            },
            issued_by="admin",
        )

        assert result["issued_count"] == 1
        assert result["issued"][0]["user_id"] == "u1"
        assert result["issued"][0]["size"] == "M"
        service.issue_from_pool.assert_awaited_once()

        reasons = {s["user_id"]: s["reason"] for s in result["skipped"]}
        # u2 already covered (not skipped, just not a target); u3 no size; u4 no stock
        assert "u2" not in reasons
        assert reasons["u3"] == "No size on file"
        assert "No L stock" in reasons["u4"]

    @pytest.mark.asyncio
    async def test_requires_size_and_stock(self, service, mock_db):
        with pytest.raises(ValueError):
            await service.bulk_issue_from_plan(
                organization_id=str(uuid4()),
                filters={"size_field": "shirt"},  # missing stock_category_id
                issued_by="admin",
            )


# ============================================
# Saved plans (CRUD)
# ============================================

class TestSavedPlans:

    @pytest.mark.asyncio
    async def test_create_plan(self, service, mock_db):
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock()
        plan = await service.create_impact_plan(
            organization_id="org",
            data={
                "name": "Annual refresh",
                "description": "Class A shirts",
                "filters": {"size_field": "shirt", "statuses": ["active"]},
            },
            created_by="admin",
        )
        assert plan.name == "Annual refresh"
        assert plan.organization_id == "org"
        assert plan.created_by == "admin"
        assert plan.filters == {"size_field": "shirt", "statuses": ["active"]}
        mock_db.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_update_plan_not_found(self, service, mock_db):
        mock_db.scalar = AsyncMock(return_value=None)
        plan, error = await service.update_impact_plan(
            "missing", "org", {"name": "x"}
        )
        assert plan is None
        assert error == "Impact plan not found"

    @pytest.mark.asyncio
    async def test_update_plan_applies_changes(self, service, mock_db):
        existing = SimpleNamespace(
            id="p1", organization_id="org", name="Old",
            description=None, filters={},
        )
        mock_db.scalar = AsyncMock(return_value=existing)
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock()
        plan, error = await service.update_impact_plan(
            "p1", "org", {"name": "New", "filters": {"size_field": "boot"}}
        )
        assert error is None
        assert plan.name == "New"
        assert plan.filters == {"size_field": "boot"}

    @pytest.mark.asyncio
    async def test_delete_plan(self, service, mock_db):
        existing = SimpleNamespace(id="p1", organization_id="org")
        mock_db.scalar = AsyncMock(return_value=existing)
        mock_db.delete = AsyncMock()
        mock_db.flush = AsyncMock()
        assert await service.delete_impact_plan("p1", "org") is True
        mock_db.delete.assert_awaited_once_with(existing)

    @pytest.mark.asyncio
    async def test_delete_plan_not_found(self, service, mock_db):
        mock_db.scalar = AsyncMock(return_value=None)
        assert await service.delete_impact_plan("missing", "org") is False


# ============================================
# PDF rendering
# ============================================

class TestImpactPlanPdf:

    def _data(self, **overrides):
        data = {
            "total_members": 2,
            "members_needing_item": 1,
            "members_with_related_item": 1,
            "members_needing_replacement": 0,
            "members_missing_sizes": 0,
            "replacement_aware": False,
            "size_field": None,
            "stock_checked": False,
            "total_to_purchase": None,
            "cost_estimated": False,
            "estimated_total_cost": None,
            "size_breakdown": [],
            "members": [
                {
                    "full_name": "Amy Adams", "membership_number": "001",
                    "rank": "firefighter", "station": "S1", "needed_size": None,
                    "has_related_item": False, "needs_replacement": False,
                    "email": None, "phone": None,
                },
            ],
        }
        data.update(overrides)
        return data

    def test_minimal_plan_renders_pdf(self):
        from app.utils.impact_plan_pdf import render_impact_plan_pdf

        buf = render_impact_plan_pdf(
            self._data(),
            {"org_name": "Test FD", "generated_at": datetime(2026, 6, 22, 12, 0),
             "parameters": [], "show_size": False, "show_existing": False,
             "show_contact": False},
        )
        out = buf.getvalue()
        assert out[:4] == b"%PDF"
        assert len(out) > 800

    def test_full_plan_renders_pdf(self):
        from app.utils.impact_plan_pdf import render_impact_plan_pdf

        data = self._data(
            size_field="jacket",
            stock_checked=True,
            total_to_purchase=2,
            cost_estimated=True,
            estimated_total_cost=360.0,
            replacement_aware=True,
            members_needing_replacement=1,
            size_breakdown=[
                {"size": "M", "needing": 2, "on_hand": 0, "shortfall": 2,
                 "unit_cost": 180.0, "estimated_cost": 360.0},
                {"size": "Unknown", "needing": 1, "on_hand": 0, "shortfall": 1,
                 "unit_cost": 180.0, "estimated_cost": 180.0},
            ],
            members=[
                {"full_name": "Amy Adams", "membership_number": "001",
                 "rank": "ff", "station": "S1", "needed_size": "M",
                 "has_related_item": False, "needs_replacement": True,
                 "email": "amy@x.org", "phone": "555"},
            ],
        )
        buf = render_impact_plan_pdf(
            data,
            {"org_name": "Test FD", "generated_at": datetime(2026, 6, 22, 12, 0),
             "parameters": ["Size: Jacket", "Replacement-aware"],
             "show_size": True, "show_existing": True, "show_contact": True},
        )
        assert buf.getvalue()[:4] == b"%PDF"


# ============================================
# get_impact_planner_options
# ============================================

class TestImpactPlannerOptions:

    @pytest.mark.asyncio
    async def test_options_shape(self, service, mock_db):
        org_id = str(uuid4())
        ranks = [
            SimpleNamespace(rank_code="captain", display_name="Captain"),
        ]
        distinct_ranks = ["captain", "probie"]  # "probie" not in operational ranks
        stations = ["Station 1", None, "Station 2"]
        positions = [SimpleNamespace(id="p1", name="Quartermaster")]
        categories = [
            SimpleNamespace(id="c1", name="Jackets", item_type="uniform"),
        ]

        mock_db.execute.side_effect = [
            _scalars_result(ranks),
            _scalars_result(distinct_ranks),
            _scalars_result(stations),
            _scalars_result(positions),
            _scalars_result(categories),
        ]

        opts = await service.get_impact_planner_options(organization_id=org_id)

        assert {o["value"] for o in opts["size_fields"]} == {
            "shirt",
            "pant",
            "jacket",
            "boot",
            "glove",
            "hat",
        }
        # operational rank + the extra free-text rank both surface
        rank_values = {r["value"] for r in opts["ranks"]}
        assert "captain" in rank_values
        assert "probie" in rank_values
        # None station filtered out
        assert opts["stations"] == ["Station 1", "Station 2"]
        assert opts["positions"] == [{"id": "p1", "name": "Quartermaster"}]
        assert opts["categories"][0]["name"] == "Jackets"
        # status / membership-type enums are non-empty
        assert len(opts["statuses"]) > 0
        assert len(opts["membership_types"]) > 0
