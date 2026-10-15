"""The canonical shape of an item's "also called" names.

``inventory_items.also_called`` is untyped JSON, so the shape is settled on every
write path (CLAUDE.md pitfall #20): ``None``, or a list of trimmed, distinct,
non-empty strings, bounded in count and length.
"""

import pytest

from app.schemas.inventory import (
    InventoryItemCreate,
    InventoryItemResponse,
    InventoryItemUpdate,
)
from app.utils.item_aliases import (
    MAX_ALIAS_LENGTH,
    MAX_ALIASES,
    normalize_aliases,
)

pytestmark = pytest.mark.unit


class TestNormalizeAliases:
    def test_none_stays_none(self):
        assert normalize_aliases(None) is None

    def test_an_empty_list_settles_to_none(self):
        assert normalize_aliases([]) is None

    def test_blank_entries_are_dropped(self):
        assert normalize_aliases(["", "   ", "BVM"]) == ["BVM"]
        assert normalize_aliases(["", "  "]) is None

    def test_whitespace_is_trimmed_and_collapsed(self):
        assert normalize_aliases(["  Ambu   bag "]) == ["Ambu bag"]

    def test_spellings_that_normalize_alike_are_one_alias(self):
        assert normalize_aliases(["BVM", " bvm ", "Bvm"]) == ["BVM"]

    def test_order_is_kept(self):
        assert normalize_aliases(["B", "A", "C"]) == ["B", "A", "C"]

    def test_an_alias_equal_to_the_items_own_name_is_dropped(self):
        assert normalize_aliases(["Bag Valve Mask", "BVM"], "bag valve mask") == ["BVM"]

    def test_too_many_aliases_are_refused_not_truncated(self):
        with pytest.raises(ValueError, match="at most"):
            normalize_aliases([f"name {i}" for i in range(MAX_ALIASES + 1)])

    def test_the_limit_itself_is_allowed(self):
        values = [f"name {i}" for i in range(MAX_ALIASES)]
        assert normalize_aliases(values) == values

    def test_an_overlong_alias_is_refused_not_truncated(self):
        with pytest.raises(ValueError, match="characters"):
            normalize_aliases(["x" * (MAX_ALIAS_LENGTH + 1)])

    def test_a_non_text_entry_is_refused(self):
        with pytest.raises(ValueError, match="text"):
            normalize_aliases(["BVM", 7])  # type: ignore[list-item]


class TestItemSchemas:
    def test_create_settles_the_list(self):
        item = InventoryItemCreate(
            name="Bag Valve Mask",
            item_type="medical",
            also_called=["BVM", " bvm ", ""],
        )
        assert item.also_called == ["BVM"]

    def test_create_without_aliases_has_none(self):
        item = InventoryItemCreate(name="Gauze", item_type="medical")
        assert item.also_called is None

    def test_update_settles_the_list(self):
        update = InventoryItemUpdate(also_called=[" Ambu bag ", "Ambu Bag"])
        assert update.model_dump(exclude_unset=True) == {"also_called": ["Ambu bag"]}

    def test_update_that_omits_aliases_leaves_them_alone(self):
        assert "also_called" not in InventoryItemUpdate(name="x").model_dump(
            exclude_unset=True
        )

    def test_update_clears_with_an_empty_list_or_null(self):
        # An explicit value is "set", so the clear reaches apply_updates as None.
        for cleared in ([], None):
            dumped = InventoryItemUpdate(also_called=cleared).model_dump(
                exclude_unset=True
            )
            assert dumped == {"also_called": None}

    def test_create_refuses_too_many(self):
        with pytest.raises(ValueError, match="at most"):
            InventoryItemCreate(
                name="Gauze",
                item_type="medical",
                also_called=[f"n{i}" for i in range(MAX_ALIASES + 1)],
            )

    def test_the_response_exposes_the_field(self):
        assert "also_called" in InventoryItemResponse.model_fields
