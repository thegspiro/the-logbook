"""The CSV import's dry run (workflow review W43-5).

The import preview listed a nameless row, an unknown category and a negative
quantity without comment; the problems appeared only after Import. With
``dry_run=true`` the endpoint checks every row the way the real import would
and returns the same report without creating anything, so the preview can show
it first.
"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.inventory import InventoryCategory, InventoryItem, ItemType
from app.models.user import Organization, Position, User

pytestmark = pytest.mark.integration

# Row 2 imports; row 3 has no name; row 4 names a category nobody made (a
# warning, still imported); row 5 has a negative quantity; row 6 repeats a
# serial already on file; rows 7 and 8 share a serial between themselves.
SHEET = (
    "Name,Category,Serial Number,Tracking Type,Quantity\n"
    "Turnout coat,Turnout Gear,SN-100,individual,1\n"
    ",Turnout Gear,SN-101,individual,1\n"
    "Helmet,Headgear,SN-102,individual,1\n"
    "Gloves,Turnout Gear,,pool,-3\n"
    "Boots,Turnout Gear,SN-ON-FILE,individual,1\n"
    "Hood,Turnout Gear,SN-TWICE,individual,1\n"
    "Hood spare,Turnout Gear,SN-TWICE,individual,1\n"
)


async def _setup(db):
    org = Organization(name="Import FD", slug=f"import-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    db.add(
        InventoryCategory(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Turnout Gear",
            item_type=ItemType.PPE,
        )
    )
    db.add(
        InventoryItem(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Old boots",
            serial_number="SN-ON-FILE",
        )
    )
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"qm-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="Sam",
        last_name="Reed",
        password_hash="x",
    )
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Quartermaster",
        slug=f"qm-{uuid.uuid4().hex[:8]}",
        permissions=["inventory.view", "inventory.manage"],
    )
    user.positions.append(position)
    db.add_all([user, position])
    await db.flush()
    return org, user


async def _post(db, user, csv_text, *, dry_run):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.api.v1.endpoints import inventory as inventory_endpoints
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(inventory_endpoints.router, prefix="/inventory")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.post(
            "/inventory/items/import",
            params={"dry_run": "true"} if dry_run else None,
            files={"file": ("items.csv", csv_text.encode(), "text/csv")},
        )


async def _item_count(db, org) -> int:
    return (
        await db.execute(
            select(func.count(InventoryItem.id)).where(
                InventoryItem.organization_id == org.id
            )
        )
    ).scalar_one()


def _failed_rows(body) -> list[int]:
    return sorted({entry["row"] for entry in body["errors"]})


async def test_a_dry_run_reports_every_refusal_and_creates_nothing(db_session):
    org, user = await _setup(db_session)
    before = await _item_count(db_session, org)

    response = await _post(db_session, user, SHEET, dry_run=True)

    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is True
    assert body["total_rows"] == 7
    assert _failed_rows(body) == [3, 5, 6, 8]
    assert body["imported"] == 3
    assert body["failed"] == 4
    messages = {entry["row"]: entry["error"] for entry in body["errors"]}
    assert "Name" in messages[3]
    assert "negative" in messages[5]
    assert "SN-ON-FILE" in messages[6]
    assert (
        messages[8] == "Serial number 'SN-TWICE' is already used by row 7 of this file"
    )
    assert any("Headgear" in warning for warning in body["warnings"])
    assert await _item_count(db_session, org) == before


async def test_the_dry_run_report_matches_the_real_import(db_session):
    org, user = await _setup(db_session)
    before = await _item_count(db_session, org)

    preview = (await _post(db_session, user, SHEET, dry_run=True)).json()
    real = (await _post(db_session, user, SHEET, dry_run=False)).json()

    assert real["dry_run"] is False
    assert _failed_rows(real) == _failed_rows(preview)
    assert (real["imported"], real["failed"]) == (
        preview["imported"],
        preview["failed"],
    )
    assert real["warnings"] == preview["warnings"]
    assert await _item_count(db_session, org) == before + real["imported"]
