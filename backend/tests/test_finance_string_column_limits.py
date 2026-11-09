"""Finance request strings are held to the width of the column they fill.

A dues payment's method and transaction reference and an export mapping's
QuickBooks account number had no max_length, so an over-long value reached the
database and failed there as a 500 instead of being refused as a 422 the form
can put on its field (forms review F-2; batch 17 took the form's maxLength from
the column width for want of one in the schema).
"""

import pytest
from pydantic import ValidationError

from app.schemas.finance import (
    ExportMappingCreate,
    ExportMappingUpdate,
    MemberDuesPayment,
)

pytestmark = pytest.mark.unit

_MAPPING = {
    "mapping_type": "expense",
    "internal_category": "Apparatus",
    "qb_account_name": "Vehicles",
}

CASES = [
    (MemberDuesPayment, {"amount_paid": "10.00"}, "payment_method", 50),
    (MemberDuesPayment, {"amount_paid": "10.00"}, "transaction_reference", 200),
    (ExportMappingCreate, _MAPPING, "qb_account_number", 50),
    (ExportMappingUpdate, {}, "qb_account_number", 50),
]


@pytest.mark.parametrize("schema,base,field,width", CASES)
def test_a_value_at_the_column_width_is_accepted(schema, base, field, width):
    model = schema.model_validate({**base, field: "x" * width})
    assert getattr(model, field) == "x" * width


@pytest.mark.parametrize("schema,base,field,width", CASES)
def test_a_value_past_the_column_width_is_refused(schema, base, field, width):
    with pytest.raises(ValidationError) as caught:
        schema.model_validate({**base, field: "x" * (width + 1)})
    assert [e["loc"] for e in caught.value.errors()] == [(field,)]
