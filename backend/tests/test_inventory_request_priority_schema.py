"""Regression tests for the bounded equipment-request priority contract."""

import pytest
from pydantic import ValidationError

from app.models.inventory import RequestPriority
from app.schemas.inventory import EquipmentRequestCreate


def test_equipment_request_uses_normal_backend_default():
    # `requested_duration` is required as of the intent/fulfillment split: the
    # member states how long they need the item and the quartermaster decides
    # how to fulfill it. It is supplied here only to build a valid payload —
    # what these two tests pin down is the priority contract.
    request = EquipmentRequestCreate(
        item_name="Portable radio", requested_duration="temporary"
    )

    assert request.priority == RequestPriority.NORMAL.value


def test_equipment_request_accepts_only_model_priority_values():
    for priority in RequestPriority:
        request = EquipmentRequestCreate(
            item_name="Portable radio",
            requested_duration="temporary",
            priority=priority.value,
        )
        assert request.priority == priority.value

    with pytest.raises(ValidationError):
        EquipmentRequestCreate(
            item_name="Portable radio",
            requested_duration="temporary",
            priority="urgent",
        )
