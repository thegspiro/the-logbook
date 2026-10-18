"""Finance amounts are checked against what the column can hold.

Every finance money column is ``Numeric(12, 2)``, so the largest storable
amount is 9,999,999,999.99. A request schema that only said "two decimal
places" let a larger value through validation, and it then failed inside the
database as an unexplained 500. Each request amount now carries
``max_digits=12`` so the API refuses it with a 422 that names the problem.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas import finance as schemas

pytestmark = [pytest.mark.unit]

LARGEST = Decimal("9999999999.99")
TOO_LARGE = Decimal("10000000000.00")

# (schema, field, must be above zero)
AMOUNT_FIELDS = [
    ("BudgetCreate", "amount_budgeted", False),
    ("BudgetUpdate", "amount_budgeted", False),
    ("ApprovalChainStepCreate", "auto_approve_under", False),
    ("ApprovalChainStepUpdate", "auto_approve_under", False),
    ("ApprovalChainCreate", "min_amount", False),
    ("ApprovalChainCreate", "max_amount", False),
    ("ApprovalChainUpdate", "min_amount", False),
    ("ApprovalChainUpdate", "max_amount", False),
    ("PurchaseRequestCreate", "estimated_amount", True),
    ("PurchaseRequestUpdate", "estimated_amount", True),
    ("PurchaseRequestUpdate", "actual_amount", True),
    ("ExpenseLineItemCreate", "amount", True),
    ("CheckRequestCreate", "amount", True),
    ("CheckRequestUpdate", "amount", True),
    ("DuesScheduleCreate", "amount", True),
    ("DuesScheduleCreate", "late_fee_amount", False),
    ("DuesScheduleUpdate", "amount", True),
    ("DuesScheduleUpdate", "late_fee_amount", False),
    ("MemberDuesPayment", "amount_paid", True),
]

IDS = [f"{model}.{field}" for model, field, _ in AMOUNT_FIELDS]


def _validate(model_name: str, field: str, value: Decimal) -> None:
    """Run one field's own validation, without building the whole payload."""
    model = getattr(schemas, model_name)
    model.__pydantic_validator__.validate_assignment(
        model.model_construct(), field, value
    )


@pytest.mark.parametrize(("model", "field", "positive"), AMOUNT_FIELDS, ids=IDS)
def test_the_largest_storable_amount_is_accepted(model, field, positive):
    _validate(model, field, LARGEST)


@pytest.mark.parametrize(("model", "field", "positive"), AMOUNT_FIELDS, ids=IDS)
def test_an_amount_the_column_cannot_hold_is_refused_with_a_clear_error(
    model, field, positive
):
    with pytest.raises(ValidationError) as caught:
        _validate(model, field, TOO_LARGE)

    assert "digits" in str(caught.value)


@pytest.mark.parametrize(
    ("model", "field", "positive"),
    [row for row in AMOUNT_FIELDS if row[2]],
    ids=[i for i, row in zip(IDS, AMOUNT_FIELDS) if row[2]],
)
def test_one_cent_is_the_smallest_amount_and_zero_is_refused(model, field, positive):
    _validate(model, field, Decimal("0.01"))

    with pytest.raises(ValidationError):
        _validate(model, field, Decimal("0"))
