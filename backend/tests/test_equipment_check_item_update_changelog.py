"""Updating a checklist position with an expiration date writes its change log.

``PUT /equipment-checks/items/{id}`` saved the position and then recorded what
changed in a JSON column. The recorded changes were the request's typed values,
so an ``expiration_date`` reached the column as a ``date`` and the insert
failed with "Object of type date is not JSON serializable" -- the position was
already saved, the caller got a 500, and the template's history never heard
about it.
"""

import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.equipment_check import update_item
from app.schemas.equipment_check import CheckTemplateItemUpdate

pytestmark = pytest.mark.unit


async def test_the_logged_changes_hold_only_json_values():
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value="tmpl-1"))
    )
    db.commit = AsyncMock()
    item = SimpleNamespace(compartment_id="comp-1", name="Tourniquet, CAT")
    logged = AsyncMock()
    stored = AsyncMock(return_value=item)
    user = SimpleNamespace(
        id="user-1", organization_id="org-1", first_name="Dana", last_name="Ruiz"
    )

    with patch(
        "app.api.v1.endpoints.equipment_check.EquipmentCheckService.update_item",
        stored,
    ), patch(
        "app.api.v1.endpoints.equipment_check.EquipmentCheckService.log_template_change",
        logged,
    ):
        await update_item(
            item_id="item-1",
            data=CheckTemplateItemUpdate(
                has_expiration=True, expiration_date=date(2026, 11, 13)
            ),
            db=db,
            current_user=user,
        )

    sent = logged.await_args.kwargs["changes"]
    assert json.loads(json.dumps(sent)) == {
        "has_expiration": True,
        "expiration_date": "2026-11-13",
    }
    # The update itself still receives the typed value.
    assert stored.await_args.args[2]["expiration_date"] == date(2026, 11, 13)
