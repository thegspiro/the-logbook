"""
The inventory CSV import refuses a row whose quantity or purchase price is
negative.

`InventoryItemResponse` requires both to be 0 or more. An import that wrote a
negative value saved the row, and from then on every item list that included it
failed validation with a 500, which took down the department's Items page
(workflow review W43-1).
"""

import pytest

from app.api.v1.endpoints.inventory import _coerce_csv_row

pytestmark = [pytest.mark.unit]


def _row(**values: str) -> dict:
    return {"name": "Trauma Shears", **values}


class TestNegativeValuesAreRefused:
    def test_negative_quantity_skips_the_row(self):
        item_data, _category, errors, fatal = _coerce_csv_row(
            _row(quantity="-3"), row_num=6
        )

        assert fatal is True
        assert "quantity" not in item_data
        assert errors == [{"row": 6, "error": "Quantity cannot be negative: '-3'"}]

    def test_negative_purchase_price_skips_the_row(self):
        _item, _category, errors, fatal = _coerce_csv_row(
            _row(purchase_price="-$12.50"), row_num=4
        )

        assert fatal is True
        assert errors == [
            {"row": 4, "error": "Purchase price cannot be negative: '-$12.50'"}
        ]


class TestValidValuesStillImport:
    def test_zero_and_positive_quantities_are_kept(self):
        zero, _c, zero_errors, zero_fatal = _coerce_csv_row(
            _row(quantity="0"), row_num=2
        )
        five, _c, five_errors, five_fatal = _coerce_csv_row(
            _row(quantity="5"), row_num=3
        )

        assert (zero["quantity"], zero_errors, zero_fatal) == (0, [], False)
        assert (five["quantity"], five_errors, five_fatal) == (5, [], False)

    def test_a_formatted_price_is_parsed(self):
        item_data, _c, errors, fatal = _coerce_csv_row(
            _row(purchase_price="$1,249.99"), row_num=2
        )

        assert (item_data["purchase_price"], errors, fatal) == (1249.99, [], False)

    def test_unparseable_quantity_is_reported_but_not_fatal(self):
        # Unchanged behaviour: the row imports with the default quantity and
        # the reader is told which value was ignored.
        item_data, _c, errors, fatal = _coerce_csv_row(_row(quantity="lots"), row_num=7)

        assert fatal is False
        assert "quantity" not in item_data
        assert errors == [{"row": 7, "error": "Invalid quantity value: 'lots'"}]
