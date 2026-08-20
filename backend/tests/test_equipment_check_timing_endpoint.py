"""Request-boundary regressions for authoritative equipment-check timing."""

import pytest
from pydantic import ValidationError

from app.schemas.equipment_check import (
    ShiftEquipmentCheckCreate,
    StandaloneEquipmentCheckCreate,
)


def _item():
    return {
        "template_item_id": "item-1",
        "compartment_name": "Cab",
        "item_name": "SCBA",
        "status": "pass",
    }


@pytest.mark.parametrize(
    "schema",
    [ShiftEquipmentCheckCreate, StandaloneEquipmentCheckCreate],
)
def test_submission_endpoints_reject_arbitrary_timing(schema):
    """FastAPI's request models reject values close-out cannot understand."""
    with pytest.raises(ValidationError):
        schema(
            template_id="tmpl-1",
            check_timing="whenever_the_client_says",
            items=[_item()],
        )


@pytest.mark.parametrize(
    "schema",
    [ShiftEquipmentCheckCreate, StandaloneEquipmentCheckCreate],
)
def test_submission_endpoints_keep_timing_optional_for_legacy_clients(schema):
    request = schema(template_id="tmpl-1", items=[_item()])

    assert request.check_timing is None
