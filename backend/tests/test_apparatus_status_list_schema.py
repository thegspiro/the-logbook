"""The apparatus status list carries ``requires_reason``.

The apparatus edit form asks for a reason when the chosen status requires
one, as ``POST /apparatus/{id}/status`` already enforces. The list behind the
form's Status picker left the flag out, so every status read as needing no
reason and a rig could be put Out of Service with no record of why.
"""

from types import SimpleNamespace

import pytest

from app.schemas.apparatus import ApparatusStatusListItem

pytestmark = pytest.mark.unit


def _status(**overrides):
    row = {
        "id": "st-1",
        "name": "Out of Service",
        "code": "out_of_service",
        "is_system": True,
        "default_status": None,
        "is_available": False,
        "is_operational": False,
        "requires_reason": True,
        "is_archived_status": False,
        "color": "#EF4444",
        "icon": "x-circle",
        "is_active": True,
    }
    row.update(overrides)
    return SimpleNamespace(**row)


def test_list_item_reports_requires_reason_in_camel_case():
    dumped = ApparatusStatusListItem.model_validate(_status()).model_dump(by_alias=True)
    assert dumped["requiresReason"] is True


def test_list_item_reports_a_status_that_needs_no_reason():
    dumped = ApparatusStatusListItem.model_validate(
        _status(name="In Service", requires_reason=False)
    ).model_dump(by_alias=True)
    assert dumped["requiresReason"] is False
