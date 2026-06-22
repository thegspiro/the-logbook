"""
Inventory Impact Planner Unit Tests

Tests for the impact-planner logic on InventoryService using a mocked
database session (no live DB required, mirroring test_inventory_service.py):

  - _format_needed_size rendering for each garment/size field
  - analyze_impact aggregation: counts, contact gating, size breakdown,
    and "already holds a comparable item" detection
  - get_impact_planner_options shape
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

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
        # u2 already holds an item in the related category
        assign_rows = [(u2, "Old Jacket")]
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
