"""Contract tests for the member equipment-request form options."""

import pytest
from pydantic import ValidationError

from app.schemas.inventory import EquipmentRequestCreate

REQUEST_FORM_TYPES = ("checkout", "issuance", "purchase")
REQUEST_FORM_PRIORITIES = ("low", "normal", "high")


@pytest.mark.parametrize("request_type", REQUEST_FORM_TYPES)
@pytest.mark.parametrize("priority", REQUEST_FORM_PRIORITIES)
def test_every_member_request_form_payload_is_accepted(request_type, priority):
    payload = EquipmentRequestCreate(
        item_name="Spare radio",
        request_type=request_type,
        priority=priority,
    )

    assert payload.request_type == request_type
    assert payload.priority == priority


@pytest.mark.parametrize("unsupported", ["assignment", "urgent"])
def test_removed_member_request_values_are_rejected(unsupported):
    field = "request_type" if unsupported == "assignment" else "priority"

    with pytest.raises(ValidationError, match="Input should be"):
        EquipmentRequestCreate(item_name="Spare radio", **{field: unsupported})
