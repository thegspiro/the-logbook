"""The clearance record screen reads one clearance by id with the member named.

``GET /inventory/clearances/{id}`` is what the departure clearance screen loads;
it now carries ``member_name`` so the screen can say whose clearance it is.
The name is resolved inside the caller's organization.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.api.v1.endpoints.inventory import get_departure_clearance
from app.schemas.inventory import DepartureClearanceResponse
from app.services.departure_clearance_service import DepartureClearanceService
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org_with_member(db):
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Clearance FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"clr-{org_id[:8]}"},
    )
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) VALUES (:id, :org, :un, 'Dana', 'Reyes', "
            ":em, 'hashed', 'inactive')"
        ),
        {"id": user_id, "org": org_id, "un": f"dr{user_id[:6]}", "em": "dr@test.com"},
    )
    await db.flush()
    return org_id, user_id


async def _clearance(db, org_id, user_id):
    inventory = InventoryService(db)
    item, _ = await inventory.create_item(
        organization_id=uuid.UUID(org_id),
        item_data={"name": "Helmet", "condition": "good", "status": "available"},
        created_by=uuid.UUID(user_id),
    )
    await inventory.assign_item_to_user(
        item_id=uuid.UUID(item.id),
        user_id=uuid.UUID(user_id),
        organization_id=uuid.UUID(org_id),
        assigned_by=uuid.UUID(user_id),
    )
    clearance, err = await DepartureClearanceService(db).initiate_clearance(
        user_id=user_id,
        organization_id=org_id,
        initiated_by=user_id,
        departure_type="dropped_voluntary",
        return_deadline_days=14,
        notes=None,
    )
    assert err is None
    return clearance


async def test_the_detail_names_the_member(db_session):
    org_id, user_id = await _org_with_member(db_session)
    clearance = await _clearance(db_session, org_id, user_id)

    response = await get_departure_clearance(
        clearance_id=uuid.UUID(clearance.id),
        db=db_session,
        current_user=SimpleNamespace(id=user_id, organization_id=org_id),
    )

    assert response.member_name == "Dana Reyes"
    assert [line.item_name for line in response.line_items] == ["Helmet"]
    assert response.line_items[0].disposition == "pending"


async def test_another_orgs_clearance_is_not_found(db_session):
    org_id, user_id = await _org_with_member(db_session)
    clearance = await _clearance(db_session, org_id, user_id)
    other_org, other_user = await _org_with_member(db_session)

    with pytest.raises(HTTPException) as exc_info:
        await get_departure_clearance(
            clearance_id=uuid.UUID(clearance.id),
            db=db_session,
            current_user=SimpleNamespace(id=other_user, organization_id=other_org),
        )
    assert exc_info.value.status_code == 404


async def test_a_clearance_just_opened_serializes_with_its_line_items(db_session):
    """POST /inventory/clearances answers with the clearance it just made.

    The response lists the line items, and the object the service hands back
    was refreshed without them, so reading them at serialization time went to
    the database outside the request's async context and the route answered
    500 after the clearance had already been saved.
    """
    org_id, user_id = await _org_with_member(db_session)
    clearance = await _clearance(db_session, org_id, user_id)

    response = DepartureClearanceResponse.model_validate(clearance)

    assert [line.item_name for line in response.line_items] == ["Helmet"]
