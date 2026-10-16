"""
Medical Supplies: stock on the apparatus counts, and expires, too.

The department decided (2026-10-16) that a medical supply is low on its
department-wide total — shelf plus trucks — not on one shelf, and that the
Expiring list and tiles cover what is aboard the apparatus as well. Gear keeps
judging the shelf alone. These pin both halves, and that the low-stock list,
the automatic reorder and the per-row flag all read one figure.
"""

import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.api.v1.endpoints import medical_supplies as ms
from app.models.apparatus import (
    Apparatus,
    ApparatusStatus,
    ApparatusType,
    CheckItemDeployedLot,
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    InventoryLot,
    ItemType,
    ReorderRequest,
    TrackingType,
)
from app.models.user import Organization, User
from app.services.auto_reorder_service import AutoReorderService
from app.services.equipment_check_service import EquipmentCheckService
from app.services.inventory_service import InventoryService
from app.utils.org_timezone import resolve_org_today

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def dept(db_session):
    """Gauze (medical, reorder at 15) and Rope (gear, reorder at 15).

    Gauze: 2 on the shelf; Medic 1 carries 3 in date and 4 expired, Medic 2
    was counted at 5, Medic 3 has never been counted (target 4), and a draft
    template's 10 do not count. Rope: 2 on the shelf, 5 on Medic 2.
    """
    org = Organization(id=_uid(), name="Truck FD", slug=f"truck-{_uid()[:8]}")
    db_session.add(org)
    await db_session.flush()
    today = await resolve_org_today(db_session, org.id)
    user = User(
        id=_uid(),
        organization_id=org.id,
        username=f"u{_uid()[:8]}",
        first_name="Pat",
        last_name="Medic",
        email=f"{_uid()[:8]}@test.com",
        password_hash="x",
    )
    medical = InventoryCategory(
        id=_uid(), organization_id=org.id, name="Airway", item_type=ItemType.MEDICAL
    )
    gear = InventoryCategory(
        id=_uid(), organization_id=org.id, name="Tools", item_type=ItemType.TOOL
    )
    db_session.add_all([user, medical, gear])
    await db_session.flush()

    def item(name, cat):
        row = InventoryItem(
            id=_uid(),
            organization_id=org.id,
            category_id=cat.id,
            name=name,
            tracking_type=TrackingType.POOL,
            quantity=0,
            reorder_point=15,
            active=True,
        )
        db_session.add(row)
        return row

    gauze, rope = item("Gauze", medical), item("Rope", gear)
    await db_session.flush()
    for target in (gauze, rope):
        db_session.add(
            InventoryLot(
                id=_uid(),
                organization_id=org.id,
                inventory_item_id=target.id,
                quantity=2,
                expiration_date=today + timedelta(days=5),
            )
        )

    rigs = {}
    for unit in ("Medic 1", "Medic 2", "Medic 3"):
        kind = ApparatusType(
            id=_uid(), organization_id=org.id, name=unit, code=unit[-1]
        )
        state = ApparatusStatus(
            id=_uid(), organization_id=org.id, name="In", code=f"IS{unit[-1]}"
        )
        db_session.add_all([kind, state])
        await db_session.flush()
        rig = Apparatus(
            id=_uid(),
            organization_id=org.id,
            unit_number=unit,
            name=unit,
            apparatus_type_id=kind.id,
            status_id=state.id,
        )
        db_session.add(rig)
        rigs[unit] = rig
    await db_session.flush()

    async def position(rig, linked, *, active=True, nested=True, **kw):
        template = EquipmentCheckTemplate(
            id=_uid(),
            organization_id=org.id,
            name=f"{rig.name} Daily",
            check_timing="start_of_shift",
            is_active=active,
            apparatus_id=rig.id,
        )
        db_session.add(template)
        await db_session.flush()
        parent = None
        if nested:
            parent = CheckTemplateCompartment(
                id=_uid(), template_id=template.id, name="Main Compartment"
            )
            db_session.add(parent)
            await db_session.flush()
        bag = CheckTemplateCompartment(
            id=_uid(),
            template_id=template.id,
            name="Jump Bag",
            parent_compartment_id=parent.id if parent else None,
        )
        db_session.add(bag)
        await db_session.flush()
        line = CheckTemplateItem(
            id=_uid(),
            compartment_id=bag.id,
            name=linked.name,
            check_type="count",
            inventory_item_id=linked.id,
            **kw,
        )
        db_session.add(line)
        await db_session.flush()
        return line

    medic1 = await position(rigs["Medic 1"], gauze, expected_quantity=7)
    for qty, when in ((3, today + timedelta(days=10)), (4, today - timedelta(days=2))):
        db_session.add(
            CheckItemDeployedLot(
                id=_uid(),
                organization_id=org.id,
                template_item_id=medic1.id,
                lot_number=f"L{qty}",
                expiration_date=when,
                quantity=qty,
            )
        )
    medic2 = await position(
        rigs["Medic 2"], gauze, nested=False, expected_quantity=5, quantity_on_truck=5
    )
    await position(rigs["Medic 3"], gauze, expected_quantity=4)
    await position(rigs["Medic 1"], gauze, active=False, quantity_on_truck=10)
    rope_line = await position(
        rigs["Medic 2"], rope, nested=False, expected_quantity=5, quantity_on_truck=5
    )
    await db_session.commit()
    return SimpleNamespace(
        org_id=org.id,
        user_id=user.id,
        today=today,
        gauze=str(gauze.id),
        rope=str(rope.id),
        medic2=str(medic2.id),
        rope_line=str(rope_line.id),
    )


async def _items(db_session, *ids):
    rows = await db_session.execute(
        select(InventoryItem).where(InventoryItem.id.in_(list(ids)))
    )
    return {str(i.id): i for i in rows.scalars().all()}


class TestStockBreakdown:
    async def test_counts_in_date_truck_stock_for_a_medical_supply(
        self, db_session, dept
    ):
        items = await _items(db_session, dept.gauze, dept.rope)

        parts = await InventoryService(db_session).stock_breakdown(
            dept.org_id, list(items.values())
        )

        # 3 in date (the 4 expired are out) + 5 counted + 4 assumed full;
        # the draft template's 10 are not on a truck that runs.
        assert parts[dept.gauze]["shelf"] == 2
        assert parts[dept.gauze]["apparatus"] == 12
        assert parts[dept.gauze]["uncounted"] == 1
        # Gear is still judged on the shelf alone.
        assert parts[dept.rope]["apparatus"] == 0

    async def test_a_position_past_its_own_date_holds_nothing_usable(
        self, db_session, dept
    ):
        await db_session.execute(
            CheckTemplateItem.__table__.update()
            .where(CheckTemplateItem.id == dept.medic2)
            .values(has_expiration=True, expiration_date=dept.today - timedelta(days=1))
        )
        await db_session.commit()
        items = await _items(db_session, dept.gauze)

        parts = await InventoryService(db_session).stock_breakdown(
            dept.org_id, list(items.values())
        )

        assert parts[dept.gauze]["apparatus"] == 7

    async def test_ignores_another_departments_trucks(self, db_session, dept):
        stock = await InventoryService(db_session).apparatus_ready_stock(
            _uid(), [dept.gauze]
        )

        assert stock == {}


class TestLowStockOnTheTotal:
    async def test_a_medical_supply_is_low_on_shelf_plus_trucks(self, db_session, dept):
        rows = await InventoryService(db_session).get_low_stock_items_for_alerts(
            dept.org_id
        )

        low = {str(item.id): on_hand for item, on_hand, _ in rows}
        # Gauze: 2 + 12 = 14, at or below 15. Rope: gear, 2 on the shelf.
        assert low == {dept.gauze: 14, dept.rope: 2}

    async def test_truck_stock_lifts_a_medical_supply_out_of_low(
        self, db_session, dept
    ):
        await db_session.execute(
            InventoryItem.__table__.update()
            .where(InventoryItem.id.in_([dept.gauze, dept.rope]))
            .values(reorder_point=10)
        )
        await db_session.commit()

        rows = await InventoryService(db_session).get_low_stock_items_for_alerts(
            dept.org_id, item_types=MEDICAL_ITEM_TYPES
        )

        assert rows == []

    async def test_the_list_reports_the_same_figure(self, db_session, dept):
        result = await ms.list_medical_items(
            category_id=None,
            status_filter=None,
            condition=None,
            location_id=None,
            storage_area_id=None,
            search=None,
            active_only=True,
            sort_by="name",
            sort_order="asc",
            skip=0,
            limit=100,
            fuzzy=False,
            low_stock=False,
            db=db_session,
            current_user=SimpleNamespace(id=dept.user_id, organization_id=dept.org_id),
        )

        (gauze,) = result.items
        assert gauze.apparatus_stock == 12
        assert gauze.apparatus_uncounted == 1
        assert gauze.is_low_stock is True


class TestAutoReorderOnTheTotal:
    @pytest.fixture(autouse=True)
    def _no_mail(self):
        with patch.object(AutoReorderService, "_notify", AsyncMock()):
            yield

    async def test_orders_up_to_twice_the_point_from_the_total(self, db_session, dept):
        reorder = await AutoReorderService(db_session).raise_if_low(
            dept.org_id, dept.gauze, dept.user_id
        )

        assert reorder is not None
        # 2 x 15 - (2 shelf + 12 trucks)
        assert reorder.quantity_requested == 16

    async def test_files_nothing_while_the_trucks_cover_it(self, db_session, dept):
        await db_session.execute(
            InventoryItem.__table__.update()
            .where(InventoryItem.id == dept.gauze)
            .values(reorder_point=10)
        )
        await db_session.commit()

        reorder = await AutoReorderService(db_session).raise_if_low(
            dept.org_id, dept.gauze, dept.user_id
        )

        assert reorder is None
        assert (
            await db_session.execute(
                select(ReorderRequest).where(ReorderRequest.item_id == dept.gauze)
            )
        ).first() is None


class TestReorderAfterACount:
    async def _recount(self, db_session, dept, position_id):
        user = await db_session.get(User, dept.user_id)
        with patch.object(
            EquipmentCheckService, "_raise_low_stock_reorder", AsyncMock()
        ) as raise_:
            await EquipmentCheckService(db_session).set_item_quantity(
                position_id, dept.org_id, user, 1
            )
        return raise_

    async def test_a_lower_count_of_a_medical_supply_checks_for_a_reorder(
        self, db_session, dept
    ):
        raise_ = await self._recount(db_session, dept, dept.medic2)

        raise_.assert_awaited_once_with(dept.org_id, dept.gauze, dept.user_id)

    async def test_gear_still_reorders_from_swaps_only(self, db_session, dept):
        raise_ = await self._recount(db_session, dept, dept.rope_line)

        raise_.assert_not_awaited()


class TestExpiringOnTheTrucks:
    async def test_lists_shelf_and_truck_stock_with_where_it_is(self, db_session, dept):
        rows = await ms.list_expiring_medical_stock(
            days_ahead=30,
            db=db_session,
            current_user=SimpleNamespace(id=dept.user_id, organization_id=dept.org_id),
        )

        assert [
            (r.location, r.where, r.quantity, r.days_until_expiration) for r in rows
        ] == [
            ("apparatus", "Medic 1 › Main Compartment › Jump Bag", 4, -2),
            ("shelf", None, 2, 5),
            ("apparatus", "Medic 1 › Main Compartment › Jump Bag", 3, 10),
        ]
        assert {r.item_name for r in rows} == {"Gauze"}

    async def test_the_tiles_count_truck_stock_apart(self, db_session, dept):
        summary = await ms.medical_supply_summary(
            expiring_within_days=30,
            db=db_session,
            current_user=SimpleNamespace(id=dept.user_id, organization_id=dept.org_id),
        )

        assert summary["expiring_soon"] == 1
        assert summary["expired"] == 0
        assert summary["expiring_soon_on_apparatus"] == 1
        assert summary["expired_on_apparatus"] == 1

    async def test_ignores_another_departments_trucks(self, db_session, dept):
        rows = await EquipmentCheckService(db_session).apparatus_expiring_stock(
            _uid(), list(MEDICAL_ITEM_TYPES), days_ahead=30, today=dept.today
        )

        assert rows == []
