"""Count positions: Min to Pass fails the line, par sets the restock.

The department decided (2026-10-16) that a count answers two questions with
two numbers. Min to Pass — or Critical Min when Min to Pass is blank — decides
whether the line fails. Par decides the shortfall a restock fills, so a truck
short of par alone passes with a restock line rather than failing. A count
also carries a unit ("each", "rolls", "boxes"), so a partial pack is counted
in the smaller unit and every quantity stays whole.

The rule table is pinned in ``test_equipment_check_service.py``; these pin the
pieces around it and the whole path through the endpoint and the database.
"""

import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.equipment_check import router
from app.core.database import get_db
from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.training import ShiftEquipmentCheckItem
from app.schemas.equipment_check import (
    CheckTemplateItemCreate,
    CheckTemplateItemUpdate,
)
from app.services.equipment_check_service import EquipmentCheckService
from app.utils.check_types import describe_count

# ---------------------------------------------------------------------------
# Pure pieces
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestDescribeCount:
    def test_short_of_par_names_the_restock(self):
        assert describe_count(8, 10, "each") == "8 / 10 each, restock 2"

    def test_at_par(self):
        assert describe_count(10, 10, "rolls") == "10 / 10 rolls"

    def test_over_par_is_not_a_restock(self):
        assert describe_count(12, 10, None) == "12 / 10"

    def test_no_par(self):
        assert describe_count(3, None, "boxes") == "3 boxes"

    def test_not_counted(self):
        assert describe_count(None, 10, "each") is None


@pytest.mark.unit
class TestCountUnitSchema:
    def test_trimmed(self):
        item = CheckTemplateItemCreate(name="Gauze", count_unit="  each ")
        assert item.count_unit == "each"

    def test_blank_clears(self):
        # An admin emptying the field must store NULL, not "".
        update = CheckTemplateItemUpdate(count_unit="   ")
        assert update.count_unit is None
        assert "count_unit" in update.model_dump(exclude_unset=True)

    def test_length_capped(self):
        with pytest.raises(ValueError, match="at most 50 characters"):
            CheckTemplateItemCreate(name="Gauze", count_unit="x" * 51)


@pytest.mark.unit
class TestUnitLabelFallback:
    async def test_an_unlinked_position_shows_its_own_unit(self):
        # No catalog link means no lookup, so the database is never touched.
        service = EquipmentCheckService(AsyncMock())
        item = SimpleNamespace(inventory_item_id=None, count_unit="rolls")
        await service._attach_unit_labels("org-1", [item])
        assert item.unit_of_measure == "rolls"


# ---------------------------------------------------------------------------
# Against the database, through the endpoint
# ---------------------------------------------------------------------------


async def _build_template(db_session, org_id):
    template = EquipmentCheckTemplate(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Medic 1 Daily",
        check_timing="start_of_shift",
        is_active=True,
    )
    db_session.add(template)
    await db_session.flush()
    compartment = CheckTemplateCompartment(
        id=str(uuid.uuid4()), template_id=template.id, name="Jump bag"
    )
    db_session.add(compartment)
    await db_session.flush()

    def item(name, **extra):
        row = CheckTemplateItem(
            id=str(uuid.uuid4()),
            compartment_id=compartment.id,
            name=name,
            check_type="count",
            **extra,
        )
        db_session.add(row)
        return row

    items = {
        "gauze": item(
            "4x4 gauze", expected_quantity=10, required_quantity=6, count_unit="each"
        ),
        "tape": item("Tape", expected_quantity=4, count_unit="rolls"),
        "masks": item("NRB masks", expected_quantity=6, critical_minimum_quantity=2),
    }
    await db_session.flush()
    return template, items


def _row(template_item, status, quantity):
    return {
        "template_item_id": template_item.id,
        "compartment_name": "Jump bag",
        "item_name": template_item.name,
        "status": status,
        "quantity_found": quantity,
    }


async def _post(db_session, org_id, user_id, payload):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=user_id,
        organization_id=org_id,
        rank=None,
        positions=[SimpleNamespace(permissions=["inventory.check_submit"])],
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.post("/checks", json=payload)


async def _results(db_session, check_id):
    rows = await db_session.execute(
        select(ShiftEquipmentCheckItem).where(
            ShiftEquipmentCheckItem.check_id == check_id
        )
    )
    return {r.item_name: r for r in rows.scalars().all()}


@pytest.mark.integration
class TestCountSubmission:
    async def test_short_of_par_passes_and_raises_a_restock(
        self, db_session, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        template, items = await _build_template(db_session, org_id)

        response = await _post(
            db_session,
            org_id,
            user_id,
            {
                "template_id": template.id,
                "items": [
                    _row(items["gauze"], "pass", 8),
                    _row(items["tape"], "pass", 1),
                    _row(items["masks"], "pass", 2),
                ],
            },
        )

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["overallStatus"] == "pass"
        assert body["failedItems"] == 0

        stored = await _results(db_session, body["id"])
        gauze = stored["4x4 gauze"]
        assert (gauze.required_quantity, gauze.expected_quantity) == (6, 10)
        assert gauze.count_unit == "each"
        assert stored["Tape"].count_unit == "rolls"
        assert stored["Tape"].expected_quantity == 4

        by_name = {i["itemName"]: i for i in body["items"]}
        assert by_name["4x4 gauze"]["expectedQuantity"] == 10
        assert by_name["4x4 gauze"]["countUnit"] == "each"

        for key in ("gauze", "tape", "masks"):
            await db_session.refresh(items[key])
        assert items["gauze"].restock_needed is True
        assert items["gauze"].quantity_on_truck == 8
        assert items["tape"].restock_needed is True
        assert "of 4" in (items["tape"].restock_note or "")

    async def test_below_min_and_below_critical_fail(
        self, db_session, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        template, items = await _build_template(db_session, org_id)

        response = await _post(
            db_session,
            org_id,
            user_id,
            {
                "template_id": template.id,
                "items": [
                    _row(items["gauze"], "fail", 5),
                    _row(items["tape"], "pass", 4),
                    _row(items["masks"], "fail", 1),
                ],
            },
        )

        assert response.status_code == 201, response.text
        assert response.json()["overallStatus"] == "fail"
        assert response.json()["failedItems"] == 2

        log = await EquipmentCheckService(db_session).get_failure_log(org_id)
        rows = {r["item_name"]: r for r in log["items"]}
        assert set(rows) == {"4x4 gauze", "NRB masks"}
        assert rows["4x4 gauze"]["quantity_found"] == 5
        assert rows["4x4 gauze"]["target_quantity"] == 10
        assert rows["4x4 gauze"]["count_unit"] == "each"

    async def test_a_pass_below_min_is_refused(self, db_session, setup_org_and_admin):
        org_id, user_id = setup_org_and_admin
        template, items = await _build_template(db_session, org_id)

        response = await _post(
            db_session,
            org_id,
            user_id,
            {
                "template_id": template.id,
                "items": [_row(items["gauze"], "pass", 5)],
            },
        )

        assert response.status_code == 400
        assert "contradicts" in response.json()["detail"]


@pytest.mark.integration
class TestSupplyOverviewShortage:
    async def test_a_position_short_of_par_is_listed(
        self, db_session, setup_org_and_admin
    ):
        # The query resolves par as the larger of the two columns, so a
        # position counted at 8 against par 10 / min 6 is short even though it
        # meets Min to Pass.
        org_id, _user_id = setup_org_and_admin
        _template, items = await _build_template(db_session, org_id)
        items["gauze"].quantity_on_truck = 8
        await db_session.flush()

        overview = await EquipmentCheckService(db_session).get_supply_overview(
            org_id, today=date.today()
        )

        rows = {r["item_name"]: r for r in overview["items"]}
        assert rows["4x4 gauze"]["is_short"] is True
        assert rows["4x4 gauze"]["target_quantity"] == 10
