"""
Getting checklist positions wired to the inventory catalog.

Expiration, lot and restock tracking all hang off ``inventory_item_id``. A
position without it is invisible to the supply side, so how easily that link
gets made decides whether any of the tracking works in practice. These cover
the name matcher that proposes links, the bulk apply that writes them, and the
bulk catalog create that gives them something to point at.

Mocked sessions — no DB — so they run in the sandbox.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.apparatus import CheckTemplateItem
from app.services.equipment_check_service import EquipmentCheckService
from app.services.inventory_service import InventoryService
from app.utils.name_matching import (
    EXACT,
    STRONG,
    WEAK,
    best_matches,
    confidence_for,
    index_by_normalized,
    match_score,
    normalize_name,
)


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.fixture
def service(mock_db):
    return EquipmentCheckService(mock_db)


def _item(**kwargs) -> CheckTemplateItem:
    defaults = {
        "id": "ti-1",
        "compartment_id": "comp-1",
        "name": "4x4 Gauze",
        "check_type": "quantity",
    }
    defaults.update(kwargs)
    return CheckTemplateItem(**defaults)


# ---------------------------------------------------------------------------
# Name normalization and scoring
# ---------------------------------------------------------------------------


class TestNormalizeName:
    def test_case_and_punctuation_do_not_distinguish_two_names(self):
        assert normalize_name("Gauze Pads, 4x4") == normalize_name("gauze pads 4x4")

    def test_collapses_runs_of_whitespace(self):
        assert normalize_name("  Trauma   Shears  ") == "trauma shears"

    def test_empty_input_normalizes_to_empty(self):
        assert normalize_name("") == ""

    def test_punctuation_only_name_normalizes_to_empty(self):
        assert normalize_name("---") == ""


class TestMatchScore:
    def test_same_name_differently_typed_is_exact(self):
        assert match_score("4x4 Gauze", "4X4 GAUZE") == 1.0

    def test_punctuation_does_not_prevent_an_exact_match(self):
        # A drug concentration written with a colon is the same drug.
        assert match_score("Epinephrine 1:1000", "Epinephrine 1 1000") == 1.0

    def test_a_subset_of_tokens_scores_strong_but_never_exact(self):
        # "Oxygen Mask" is a subset of both the adult and the pediatric mask,
        # so this must stay below the score callers treat as safe to apply.
        score = match_score("Oxygen Mask", "Oxygen Mask Adult")
        assert score < 1.0
        assert confidence_for(score) == STRONG

    def test_siblings_that_differ_by_one_word_stay_weak(self):
        score = match_score("Oxygen Mask Adult", "Oxygen Mask Pediatric")
        assert confidence_for(score) == WEAK

    def test_one_shared_common_word_is_not_a_match(self):
        # "Bag" appears in half a rig's inventory; on its own it means nothing.
        assert match_score("Trauma Bag", "Bag Valve Mask") < 0.34

    def test_no_shared_tokens_scores_zero(self):
        assert match_score("Trauma Shears", "Oxygen Cylinder") == 0.0

    def test_empty_name_scores_zero(self):
        assert match_score("", "Trauma Shears") == 0.0

    def test_scoring_is_symmetric(self):
        a, b = "Gauze Pads 4x4", "Gauze Pads, 4x4 Sterile"
        assert match_score(a, b) == match_score(b, a)


class TestBestMatches:
    CATALOG = [
        ("inv-1", "Gauze Pads, 4x4 Sterile"),
        ("inv-2", "Gauze Pads, 2x2 Sterile"),
        ("inv-3", "Nitrile Gloves, Large"),
    ]

    def test_ranks_the_closer_name_first(self):
        results = best_matches("Gauze Pads 4x4 Sterile", self.CATALOG)
        assert results[0]["id"] == "inv-1"
        assert results[0]["confidence"] == EXACT

    def test_drops_candidates_below_the_suggestion_floor(self):
        results = best_matches("Oxygen Cylinder", self.CATALOG)
        assert results == []

    def test_honours_the_limit(self):
        results = best_matches("Gauze Pads Sterile", self.CATALOG, limit=1)
        assert len(results) == 1

    def test_equal_scores_break_on_name_so_the_order_is_stable(self):
        catalog = [("b", "Trauma Shears"), ("a", "Trauma Shears")]
        first = best_matches("Trauma Shears", catalog)
        second = best_matches("Trauma Shears", catalog)
        assert [r["id"] for r in first] == [r["id"] for r in second]

    def test_an_empty_catalog_yields_no_suggestions(self):
        assert best_matches("4x4 Gauze", []) == []


class TestIndexByNormalized:
    def test_indexes_on_the_normalized_form(self):
        index = index_by_normalized([("inv-1", "Gauze Pads, 4x4")])
        assert index[normalize_name("gauze pads 4x4")] == "inv-1"

    def test_first_id_wins_for_a_duplicated_name(self):
        index = index_by_normalized([("inv-1", "Shears"), ("inv-2", "shears")])
        assert index[normalize_name("Shears")] == "inv-1"

    def test_skips_names_that_normalize_to_nothing(self):
        assert index_by_normalized([("inv-1", "---")]) == {}


# ---------------------------------------------------------------------------
# Which positions can carry a link
# ---------------------------------------------------------------------------


class TestLinkableItems:
    async def _linkable(self, service, mock_db, items):
        scalars = MagicMock()
        scalars.all.return_value = items
        result = MagicMock()
        result.scalars.return_value = scalars
        mock_db.execute.return_value = result
        return await service._linkable_items("tmpl-1", "org-1")

    async def test_headers_are_captions_not_stock(self, service, mock_db):
        items = [_item(id="a"), _item(id="b", check_type="header", name="AIRWAY")]
        linkable = await self._linkable(service, mock_db, items)
        assert [i.id for i in linkable] == ["a"]

    async def test_a_blank_name_cannot_be_matched_against_anything(
        self, service, mock_db
    ):
        items = [_item(id="a"), _item(id="b", name="   ")]
        linkable = await self._linkable(service, mock_db, items)
        assert [i.id for i in linkable] == ["a"]


class TestLinkCoverage:
    async def test_counts_linked_against_linkable(self, service, mock_db):
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(
            return_value=[
                _item(id="a", inventory_item_id="inv-1"),
                _item(id="b"),
                _item(id="c"),
            ]
        )
        coverage = await service.get_link_coverage("tmpl-1", "org-1")
        assert coverage == {"linkable": 3, "linked": 1, "unlinked": 2}

    async def test_a_template_in_another_org_is_not_found(self, service, mock_db):
        service._get_template_row = AsyncMock(return_value=None)
        assert await service.get_link_coverage("tmpl-1", "org-1") is None


# ---------------------------------------------------------------------------
# Suggesting matches
# ---------------------------------------------------------------------------


class TestSuggestInventoryMatches:
    def _catalog(self, mock_db, rows):
        result = MagicMock()
        result.all.return_value = rows
        mock_db.execute.return_value = result

    async def test_proposes_a_catalog_item_for_each_unlinked_position(
        self, service, mock_db
    ):
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(
            return_value=[_item(id="a", name="4x4 Gauze")]
        )
        self._catalog(mock_db, [("inv-1", "Gauze Pads, 4x4 Sterile")])

        result = await service.suggest_inventory_matches("tmpl-1", "org-1")

        assert result["coverage"] == {"linkable": 1, "linked": 0, "unlinked": 1}
        assert result["matches"][0]["template_item_id"] == "a"
        assert result["matches"][0]["suggestions"][0]["id"] == "inv-1"

    async def test_already_linked_positions_are_left_out(self, service, mock_db):
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(
            return_value=[
                _item(id="a", inventory_item_id="inv-9"),
                _item(id="b", name="Trauma Shears"),
            ]
        )
        self._catalog(mock_db, [("inv-1", "Trauma Shears")])

        result = await service.suggest_inventory_matches("tmpl-1", "org-1")

        assert [m["template_item_id"] for m in result["matches"]] == ["b"]
        assert result["coverage"]["linked"] == 1

    async def test_a_fully_linked_template_skips_the_catalog_query(
        self, service, mock_db
    ):
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(
            return_value=[_item(id="a", inventory_item_id="inv-9")]
        )

        result = await service.suggest_inventory_matches("tmpl-1", "org-1")

        assert result["matches"] == []
        mock_db.execute.assert_not_called()

    async def test_a_position_with_no_plausible_match_reports_none(
        self, service, mock_db
    ):
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(
            return_value=[_item(id="a", name="Oxygen Cylinder")]
        )
        self._catalog(mock_db, [("inv-1", "Trauma Shears")])

        result = await service.suggest_inventory_matches("tmpl-1", "org-1")

        # Reported with an empty suggestion list rather than dropped: the
        # reviewer still needs to see it is unlinked.
        assert result["matches"][0]["suggestions"] == []

    async def test_suggesting_writes_nothing(self, service, mock_db):
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(
            return_value=[_item(id="a", name="Trauma Shears")]
        )
        self._catalog(mock_db, [("inv-1", "Trauma Shears")])

        await service.suggest_inventory_matches("tmpl-1", "org-1")

        mock_db.commit.assert_not_called()

    async def test_a_template_in_another_org_is_not_found(self, service, mock_db):
        service._get_template_row = AsyncMock(return_value=None)
        assert await service.suggest_inventory_matches("tmpl-1", "org-1") is None


# ---------------------------------------------------------------------------
# Applying links
# ---------------------------------------------------------------------------


class TestLinkInventoryItems:
    def _known_inventory(self, mock_db, ids):
        scalars = MagicMock()
        scalars.all.return_value = list(ids)
        result = MagicMock()
        result.scalars.return_value = scalars
        mock_db.execute.return_value = result

    async def test_writes_the_reviewed_links(self, service, mock_db):
        item = _item(id="a")
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(return_value=[item])
        self._known_inventory(mock_db, ["inv-1"])

        changed = await service.link_inventory_items("tmpl-1", "org-1", {"a": "inv-1"})

        assert changed == 1
        assert item.inventory_item_id == "inv-1"
        mock_db.commit.assert_awaited_once()

    async def test_an_explicit_null_unlinks(self, service, mock_db):
        item = _item(id="a", inventory_item_id="inv-1")
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(return_value=[item])

        changed = await service.link_inventory_items("tmpl-1", "org-1", {"a": None})

        # Undoing a wrong match has to be as cheap as making it.
        assert changed == 1
        assert item.inventory_item_id is None

    async def test_a_link_that_is_already_set_is_not_counted_as_a_change(
        self, service, mock_db
    ):
        item = _item(id="a", inventory_item_id="inv-1")
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(return_value=[item])
        self._known_inventory(mock_db, ["inv-1"])

        changed = await service.link_inventory_items("tmpl-1", "org-1", {"a": "inv-1"})

        assert changed == 0

    async def test_an_item_from_another_template_is_refused(self, service, mock_db):
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(return_value=[_item(id="a")])

        with pytest.raises(ValueError, match="not on this template"):
            await service.link_inventory_items(
                "tmpl-1", "org-1", {"someone-elses-item": "inv-1"}
            )

    async def test_an_inventory_item_from_another_org_is_refused(
        self, service, mock_db
    ):
        item = _item(id="a")
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(return_value=[item])
        # The org-scoped lookup comes back empty for the foreign id.
        self._known_inventory(mock_db, [])

        with pytest.raises(ValueError, match="not in your inventory"):
            await service.link_inventory_items(
                "tmpl-1", "org-1", {"a": "other-org-item"}
            )

        assert item.inventory_item_id is None

    async def test_nothing_is_written_when_one_id_is_rejected(self, service, mock_db):
        good, bad = _item(id="a"), _item(id="b")
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(return_value=[good, bad])
        self._known_inventory(mock_db, ["inv-1"])

        with pytest.raises(ValueError, match="not in your inventory"):
            await service.link_inventory_items(
                "tmpl-1", "org-1", {"a": "inv-1", "b": "other-org-item"}
            )

        # All or nothing: a half-applied pass leaves the reviewer unable to
        # tell which rows landed.
        assert good.inventory_item_id is None
        mock_db.commit.assert_not_called()

    async def test_the_inventory_lookup_is_org_scoped_in_sql(self, service, mock_db):
        service._get_template_row = AsyncMock(return_value=MagicMock())
        service._linkable_items = AsyncMock(return_value=[_item(id="a")])
        self._known_inventory(mock_db, ["inv-1"])

        await service.link_inventory_items("tmpl-1", "org-1", {"a": "inv-1"})

        # The rejection tests above prove the guard fires; this proves the
        # guard is asking the right question. Mocking db.execute means a query
        # that dropped its org filter would still return the ids the mock was
        # told to return, and every one of those tests would keep passing.
        statement = str(mock_db.execute.await_args.args[0])
        assert "inventory_items.organization_id" in statement

    async def test_an_empty_link_set_is_a_no_op(self, service, mock_db):
        assert await service.link_inventory_items("tmpl-1", "org-1", {}) == 0
        mock_db.commit.assert_not_called()

    async def test_a_template_in_another_org_is_not_found(self, service, mock_db):
        service._get_template_row = AsyncMock(return_value=None)
        assert (
            await service.link_inventory_items("tmpl-1", "org-1", {"a": "inv-1"})
            is None
        )


# ---------------------------------------------------------------------------
# Bulk catalog create
# ---------------------------------------------------------------------------


@pytest.fixture
def inventory_service(mock_db):
    service = InventoryService(mock_db)
    service._validate_category_requirements = AsyncMock(return_value=None)
    service._assert_item_fks_in_org = AsyncMock(return_value=None)
    service._next_sequential_barcode = AsyncMock(side_effect=_barcodes())
    return service


def _barcodes():
    n = 0
    while True:
        n += 1
        yield f"INV-{n:06d}"


def _existing_names(mock_db, names):
    scalars = MagicMock()
    scalars.all.return_value = list(names)
    result = MagicMock()
    result.scalars.return_value = scalars
    mock_db.execute.return_value = result


class TestCreateItemsBulk:
    async def test_creates_every_new_name(self, inventory_service, mock_db):
        _existing_names(mock_db, [])

        created, skipped = await inventory_service.create_items_bulk(
            "org-1",
            [{"name": "Trauma Shears"}, {"name": "Nasal Cannula"}],
            "user-1",
        )

        assert [i.name for i in created] == ["Trauma Shears", "Nasal Cannula"]
        assert skipped == []
        mock_db.commit.assert_awaited_once()

    async def test_a_name_already_on_file_is_skipped_not_rejected(
        self, inventory_service, mock_db
    ):
        _existing_names(mock_db, ["Trauma Shears"])

        created, skipped = await inventory_service.create_items_bulk(
            "org-1",
            [{"name": "trauma shears"}, {"name": "Nasal Cannula"}],
            "user-1",
        )

        # Re-pasting a list that grew by one line is the normal way this is
        # used; failing the batch for the lines that already landed would make
        # that the painful path.
        assert [i.name for i in created] == ["Nasal Cannula"]
        assert skipped == ["trauma shears"]

    async def test_a_name_repeated_within_the_paste_lands_once(
        self, inventory_service, mock_db
    ):
        _existing_names(mock_db, [])

        created, skipped = await inventory_service.create_items_bulk(
            "org-1",
            [{"name": "Trauma Shears"}, {"name": "Trauma  Shears"}],
            "user-1",
        )

        assert len(created) == 1
        assert skipped == ["Trauma  Shears"]

    async def test_names_are_trimmed_before_they_are_stored(
        self, inventory_service, mock_db
    ):
        _existing_names(mock_db, [])

        created, _ = await inventory_service.create_items_bulk(
            "org-1", [{"name": "  Trauma Shears  "}], "user-1"
        )

        assert created[0].name == "Trauma Shears"

    async def test_each_item_gets_its_own_barcode(self, inventory_service, mock_db):
        _existing_names(mock_db, [])

        created, _ = await inventory_service.create_items_bulk(
            "org-1", [{"name": "A"}, {"name": "B"}], "user-1"
        )

        assert len({i.barcode for i in created}) == 2

    async def test_a_supplied_barcode_is_left_alone(self, inventory_service, mock_db):
        _existing_names(mock_db, [])

        created, _ = await inventory_service.create_items_bulk(
            "org-1", [{"name": "A", "barcode": "MINE-1"}], "user-1"
        )

        assert created[0].barcode == "MINE-1"

    async def test_a_blank_name_fails_the_whole_batch(self, inventory_service, mock_db):
        _existing_names(mock_db, [])

        with pytest.raises(ValueError, match="needs a name"):
            await inventory_service.create_items_bulk(
                "org-1", [{"name": "Trauma Shears"}, {"name": "  "}], "user-1"
            )

        mock_db.commit.assert_not_called()

    async def test_a_category_violation_names_the_offending_row(
        self, inventory_service, mock_db
    ):
        _existing_names(mock_db, [])
        inventory_service._validate_category_requirements = AsyncMock(
            return_value="Category requires a size"
        )

        with pytest.raises(ValueError, match="Trauma Shears: Category requires"):
            await inventory_service.create_items_bulk(
                "org-1", [{"name": "Trauma Shears"}], "user-1"
            )

    async def test_a_pool_item_with_no_quantity_is_refused(
        self, inventory_service, mock_db
    ):
        _existing_names(mock_db, [])

        with pytest.raises(ValueError, match="quantity of 1 or more"):
            await inventory_service.create_items_bulk(
                "org-1",
                [{"name": "Gauze", "tracking_type": "pool", "quantity": 0}],
                "user-1",
            )

    async def test_a_foreign_category_id_fails_the_batch(
        self, inventory_service, mock_db
    ):
        _existing_names(mock_db, [])
        inventory_service._assert_item_fks_in_org = AsyncMock(
            side_effect=ValueError("Invalid category")
        )

        with pytest.raises(ValueError, match="Invalid category"):
            await inventory_service.create_items_bulk(
                "org-1", [{"name": "Gauze", "category_id": "other-org"}], "user-1"
            )

        mock_db.commit.assert_not_called()

    async def test_every_row_is_org_checked_not_just_the_first(
        self, inventory_service, mock_db
    ):
        _existing_names(mock_db, [])

        await inventory_service.create_items_bulk(
            "org-1",
            [{"name": "A", "category_id": "c1"}, {"name": "B", "category_id": "c2"}],
            "user-1",
        )

        assert inventory_service._assert_item_fks_in_org.await_count == 2

    async def test_an_empty_list_writes_nothing(self, inventory_service, mock_db):
        created, skipped = await inventory_service.create_items_bulk(
            "org-1", [], "user-1"
        )

        assert (created, skipped) == ([], [])
        mock_db.commit.assert_not_called()
