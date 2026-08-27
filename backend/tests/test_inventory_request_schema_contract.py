"""Contract tests for the member equipment-request form options."""

import pytest
from pydantic import ValidationError

from app.schemas.inventory import EquipmentRequestCreate

# The member states intent, not fulfillment: `request_type` is no longer a
# field on this schema at all, so the form cannot send one — a stronger
# guarantee than #1876's, which only narrowed the values it could send.
# What the form still chooses is how long the item is needed.
REQUEST_FORM_DURATIONS = ("temporary", "ongoing")
REQUEST_FORM_PRIORITIES = ("low", "normal", "high")


@pytest.mark.parametrize("requested_duration", REQUEST_FORM_DURATIONS)
@pytest.mark.parametrize("priority", REQUEST_FORM_PRIORITIES)
def test_every_member_request_form_payload_is_accepted(requested_duration, priority):
    payload = EquipmentRequestCreate(
        item_name="Spare radio",
        requested_duration=requested_duration,
        priority=priority,
    )

    assert payload.requested_duration == requested_duration
    assert payload.priority == priority


def test_duration_is_required_so_intent_cannot_be_left_unstated():
    """Omitting it must fail rather than default.

    A default would pick the member's intent for them, which is the decision
    this schema exists to capture.
    """
    with pytest.raises(ValidationError, match="Field required"):
        EquipmentRequestCreate(item_name="Spare radio")


@pytest.mark.parametrize(
    ("field", "unsupported"),
    [
        # "assignment" was a request_type the form used to offer and the
        # backend never accepted; there is no request_type to send now, and an
        # unknown duration is refused the same way.
        ("requested_duration", "assignment"),
        ("priority", "urgent"),
    ],
)
def test_removed_member_request_values_are_rejected(field, unsupported):
    with pytest.raises(ValidationError, match="Input should be"):
        EquipmentRequestCreate(item_name="Spare radio", **{field: unsupported})


def test_request_type_is_no_longer_a_member_supplied_field():
    """The quartermaster decides fulfillment, so the form cannot preempt it."""
    assert "request_type" not in EquipmentRequestCreate.model_fields
