"""Regression tests for the bounded equipment-request priority contract."""

import pytest
from pydantic import ValidationError

from app.models.inventory import RequestPriority
from app.schemas.inventory import EquipmentRequestCreate


def test_equipment_request_uses_normal_backend_default():
    request = EquipmentRequestCreate(item_name="Portable radio")

    assert request.priority == RequestPriority.NORMAL.value


def test_equipment_request_accepts_only_model_priority_values():
    for priority in RequestPriority:
        request = EquipmentRequestCreate(
            item_name="Portable radio", priority=priority.value
        )
        assert request.priority == priority.value

    with pytest.raises(ValidationError):
        EquipmentRequestCreate(item_name="Portable radio", priority="urgent")
