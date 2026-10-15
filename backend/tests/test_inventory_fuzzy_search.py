"""``search_items_fuzzy``: the catalog lookup behind the checklist picker.

The picker used to send the typed text as a substring search, so "4 x 4 gauze"
found nothing under "Gauze Pads, 4x4 Sterile" and an abbreviation found nothing
at all. Fuzzy mode appends near-name matches *below* the substring results — so
turning it on can only add to what a person already saw — and has to inherit
every bound the exact search has: the organization, the medical/gear domain the
caller is pinned to, and active-only.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    ItemType,
    TrackingType,
)
from app.models.user import Organization
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Fuzzy FD", slug=f"fuzzy-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.commit()
    return org


async def _category(db, org, item_type=ItemType.MEDICAL):
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"{item_type.value}-{uuid.uuid4().hex[:6]}",
        item_type=item_type,
    )
    db.add(category)
    await db.commit()
    return category


async def _item(db, org, category, name, also_called=None, active=True):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        category_id=category.id,
        name=name,
        also_called=also_called,
        tracking_type=TrackingType.POOL,
        quantity=5,
        active=active,
    )
    db.add(item)
    await db.commit()
    return item


def _names(items):
    return [item.name for item in items]


@pytest.fixture
async def world(db_session):
    org = await _org(db_session)
    medical = await _category(db_session, org, ItemType.MEDICAL)
    gear = await _category(db_session, org, ItemType.EQUIPMENT)
    await _item(db_session, org, medical, "Gauze Pads, 4x4 Sterile")
    await _item(db_session, org, medical, "Gauze Pads, 2x2 Sterile")
    await _item(db_session, org, medical, "Nitrile Gloves, Large")
    await _item(db_session, org, medical, "Glove Nitrile Small")
    await _item(db_session, org, medical, "Bag Valve Mask", also_called=["BVM"])
    await _item(db_session, org, medical, "Old Gauze 4x4", active=False)
    await _item(db_session, org, gear, "Gauze Wrap Holder 4x4")
    # Sorts ahead of the medical gauze and scores the same, so a search that
    # ranked it before filtering by domain would spend its slot on it.
    await _item(db_session, org, gear, "Gauze 4x4 Box")
    return org, medical, gear


class TestFuzzySearch:
    async def test_a_dimension_spaced_differently_still_finds_the_item(
        self, db_session, world
    ):
        org, *_ = world
        service = InventoryService(db_session)

        plain, _ = await service.get_items(
            organization_id=org.id, search="4 x 4 gauze", item_types=MEDICAL_ITEM_TYPES
        )
        items, total = await service.search_items_fuzzy(
            org.id, "4 x 4 gauze", item_types=MEDICAL_ITEM_TYPES
        )

        assert plain == []
        assert _names(items) == ["Gauze Pads, 4x4 Sterile"]
        assert total == 1

    async def test_an_alias_finds_the_item(self, db_session, world):
        org, *_ = world
        items, _ = await InventoryService(db_session).search_items_fuzzy(
            org.id, "BVM", item_types=MEDICAL_ITEM_TYPES
        )
        assert _names(items) == ["Bag Valve Mask"]

    async def test_substring_matches_come_first_and_fuzzy_ones_follow(
        self, db_session, world
    ):
        org, *_ = world
        items, total = await InventoryService(db_session).search_items_fuzzy(
            org.id, "Nitrile Glove", item_types=MEDICAL_ITEM_TYPES
        )

        # "Nitrile Gloves, Large" contains the text; "Glove Nitrile Small" only
        # resembles it, so it can only ever sit below.
        assert _names(items) == ["Nitrile Gloves, Large", "Glove Nitrile Small"]
        assert total == 2

    async def test_the_substring_results_are_unchanged_by_turning_fuzzy_on(
        self, db_session, world
    ):
        org, *_ = world
        service = InventoryService(db_session)

        plain, plain_total = await service.get_items(
            organization_id=org.id, search="Gauze Pads", item_types=MEDICAL_ITEM_TYPES
        )
        fuzzy, _ = await service.search_items_fuzzy(
            org.id, "Gauze Pads", item_types=MEDICAL_ITEM_TYPES
        )

        assert _names(fuzzy)[: len(plain)] == _names(plain)
        assert plain_total == len(plain)

    async def test_a_full_page_of_exact_matches_adds_nothing(self, db_session, world):
        org, *_ = world
        items, _ = await InventoryService(db_session).search_items_fuzzy(
            org.id, "Gauze Pads", limit=2, item_types=MEDICAL_ITEM_TYPES
        )
        assert len(items) == 2

    async def test_the_limit_bounds_the_fuzzy_results_too(self, db_session, world):
        org, *_ = world
        items, _ = await InventoryService(db_session).search_items_fuzzy(
            org.id, "Nitrile Glove", limit=1, item_types=MEDICAL_ITEM_TYPES
        )
        assert _names(items) == ["Nitrile Gloves, Large"]

    async def test_nothing_resembling_the_search_returns_nothing_extra(
        self, db_session, world
    ):
        org, *_ = world
        items, total = await InventoryService(db_session).search_items_fuzzy(
            org.id, "Spinal Immobilization", item_types=MEDICAL_ITEM_TYPES
        )
        assert (items, total) == ([], 0)

    async def test_retired_items_are_left_out_unless_asked_for(self, db_session, world):
        org, *_ = world
        service = InventoryService(db_session)

        active, _ = await service.search_items_fuzzy(
            org.id, "Gauze Old 4 x 4", item_types=MEDICAL_ITEM_TYPES
        )
        everything, _ = await service.search_items_fuzzy(
            org.id, "Gauze Old 4 x 4", item_types=MEDICAL_ITEM_TYPES, active_only=False
        )

        assert "Old Gauze 4x4" not in _names(active)
        assert "Old Gauze 4x4" in _names(everything)


class TestFuzzySearchStaysInsideItsBounds:
    async def test_a_medical_search_never_returns_gear(self, db_session, world):
        org, *_ = world
        items, _ = await InventoryService(db_session).search_items_fuzzy(
            org.id, "4 x 4 gauze wrap", item_types=MEDICAL_ITEM_TYPES
        )
        assert "Gauze Wrap Holder 4x4" not in _names(items)

    async def test_out_of_domain_items_do_not_crowd_out_in_domain_ones(
        self, db_session, world
    ):
        # Without the domain bound on the ranking step the gear box would take
        # the only slot, be dropped at load time, and leave the page empty.
        org, *_ = world
        items, _ = await InventoryService(db_session).search_items_fuzzy(
            org.id, "4 x 4 gauze", limit=1, item_types=MEDICAL_ITEM_TYPES
        )
        assert _names(items) == ["Gauze Pads, 4x4 Sterile"]

    async def test_a_gear_search_never_returns_medical_stock(self, db_session, world):
        org, *_ = world
        items, _ = await InventoryService(db_session).search_items_fuzzy(
            org.id, "4 x 4 gauze", exclude_item_types=MEDICAL_ITEM_TYPES
        )
        names = _names(items)
        assert "Gauze Pads, 4x4 Sterile" not in names
        assert {"Gauze Wrap Holder 4x4", "Gauze 4x4 Box"} <= set(names)

    async def test_another_organizations_items_are_never_returned(
        self, db_session, world
    ):
        org, *_ = world
        other = await _org(db_session)
        other_medical = await _category(db_session, other, ItemType.MEDICAL)
        await _item(
            db_session,
            other,
            other_medical,
            "Gauze Pads, 4x4 Sterile Theirs",
            also_called=["BVM"],
        )

        service = InventoryService(db_session)
        by_name, _ = await service.search_items_fuzzy(
            org.id, "4 x 4 gauze", item_types=MEDICAL_ITEM_TYPES
        )
        by_alias, _ = await service.search_items_fuzzy(
            org.id, "BVM", item_types=MEDICAL_ITEM_TYPES
        )

        assert all(item.organization_id == org.id for item in by_name + by_alias)
        assert "Gauze Pads, 4x4 Sterile Theirs" not in _names(by_name)


class TestFuzzySearchRefusesAnUnscopedScan:
    async def test_a_query_with_no_criteria_is_refused_not_run(
        self, db_session, world, monkeypatch
    ):
        # The candidate scan reuses the item query's criteria. If those ever
        # came back empty, running it would rank every organization's names.
        org, *_ = world
        service = InventoryService(db_session)
        monkeypatch.setattr(
            service, "_build_items_query", lambda *a, **k: select(InventoryItem)
        )

        with pytest.raises(RuntimeError, match="organization scope"):
            await service.search_items_fuzzy(org.id, "zzzz no such thing")


class TestGetItemsFuzzyFlag:
    async def test_the_flag_delegates_a_first_page_search(self, db_session, world):
        org, *_ = world
        items, _ = await InventoryService(db_session).get_items(
            organization_id=org.id,
            search="4 x 4 gauze",
            item_types=MEDICAL_ITEM_TYPES,
            fuzzy=True,
        )
        assert _names(items) == ["Gauze Pads, 4x4 Sterile"]

    async def test_without_the_flag_nothing_changes(self, db_session, world):
        org, *_ = world
        items, total = await InventoryService(db_session).get_items(
            organization_id=org.id, search="4 x 4 gauze", item_types=MEDICAL_ITEM_TYPES
        )
        assert (items, total) == ([], 0)

    async def test_a_later_page_is_the_plain_list(self, db_session, world):
        org, *_ = world
        items, _ = await InventoryService(db_session).get_items(
            organization_id=org.id,
            search="4 x 4 gauze",
            item_types=MEDICAL_ITEM_TYPES,
            fuzzy=True,
            skip=1,
        )
        assert items == []

    async def test_fuzzy_without_a_search_is_the_plain_list(self, db_session, world):
        org, *_ = world
        items, total = await InventoryService(db_session).get_items(
            organization_id=org.id, item_types=MEDICAL_ITEM_TYPES, fuzzy=True
        )
        assert total == 5
        assert len(items) == 5
