"""The bulk item response must be buildable from the rows a first call returns.

MySQL 8 has no INSERT ... RETURNING, so server-default columns such as
created_at stay unloaded after a flush. MariaDB (the CI/dev database) does
return them, which hid the bug; the test turns RETURNING off to behave like
MySQL.
"""

import pytest

from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.schemas.equipment_check import CheckTemplateItemBulkResponse
from app.services.equipment_check_service import EquipmentCheckService

pytestmark = pytest.mark.integration


async def test_first_call_result_serializes_without_insert_returning(
    db_session, setup_org_and_admin, monkeypatch
):
    org_id, admin_id = setup_org_and_admin
    monkeypatch.setattr(CheckTemplateItem.__table__, "implicit_returning", False)
    template = EquipmentCheckTemplate(
        organization_id=org_id, name="Engine 1", check_timing="start_of_shift"
    )
    db_session.add(template)
    await db_session.flush()
    compartment = CheckTemplateCompartment(template_id=template.id, name="Cab")
    db_session.add(compartment)
    await db_session.flush()

    created, replayed = await EquipmentCheckService(db_session).add_items_bulk(
        str(compartment.id),
        org_id,
        [{"name": "Radio"}, {"name": "Flashlight"}],
        "bulk-response-key",
        admin_id,
        "Admin User",
    )

    response = CheckTemplateItemBulkResponse(
        items=created, created_count=len(created), replayed=replayed
    )
    assert [item.name for item in response.items] == ["Radio", "Flashlight"]
    assert all(item.created_at is not None for item in response.items)
    assert all(item.updated_at is not None for item in response.items)
    assert response.created_count == 2
    assert response.replayed is False
