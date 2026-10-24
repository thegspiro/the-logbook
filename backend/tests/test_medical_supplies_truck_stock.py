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
from fastapi import HTTPException
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
from app.schemas.inventory import InventoryItemCreate, InventoryItemUpdate
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
    medic3 = await position(rigs["Medic 3"], gauze, expected_quantity=4)
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
        medic1_rig=str(rigs["Medic 1"].id),
        medic3=str(medic3.id),
        medic3_rig=str(rigs["Medic 3"].id),
        medical_cat=str(medical.id),
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


def _list_kwargs(dept, **overrides):
    kwargs = dict(
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
        exclude_apparatus_only=False,
        db=None,
        current_user=SimpleNamespace(id=dept.user_id, organization_id=dept.org_id),
    )
    kwargs.update(overrides)
    return kwargs


class TestKeptOnApparatusOnly:
    """A supply with no stock room behind it (a LUCAS device): its shelf counts
    as nothing, so it is judged on the trucks alone, and a delivery cannot be
    received into it."""

    async def _mark(self, db_session, *ids):
        await db_session.execute(
            InventoryItem.__table__.update()
            .where(InventoryItem.id.in_(list(ids)))
            .values(apparatus_only=True)
        )
        await db_session.commit()

    async def test_defaults_to_kept_in_stock(self, db_session, dept):
        items = await _items(db_session, dept.gauze, dept.rope)

        assert {i.apparatus_only for i in items.values()} == {False}

    async def test_its_shelf_counts_as_nothing(self, db_session, dept):
        await self._mark(db_session, dept.gauze)
        items = await _items(db_session, dept.gauze)

        parts = await InventoryService(db_session).stock_breakdown(
            dept.org_id, list(items.values())
        )

        # The 2 in-date shelf units are left over from before it was marked.
        assert parts[dept.gauze]["shelf"] == 0
        assert parts[dept.gauze]["apparatus"] == 12

    async def test_is_judged_low_on_the_trucks_alone(self, db_session, dept):
        await self._mark(db_session, dept.gauze)
        await db_session.execute(
            InventoryItem.__table__.update()
            .where(InventoryItem.id == dept.gauze)
            .values(reorder_point=12)
        )
        await db_session.commit()

        rows = await InventoryService(db_session).get_low_stock_items_for_alerts(
            dept.org_id, item_types=MEDICAL_ITEM_TYPES
        )

        # 12 aboard against a floor of 12; the stale shelf 2 would have hidden it.
        assert [(str(i.id), on_hand) for i, on_hand, _ in rows] == [(dept.gauze, 12)]

    async def test_gear_keeps_its_shelf(self, db_session, dept):
        # Truck stock is a medical-supplies rule; the flag does not reach gear.
        await self._mark(db_session, dept.rope)
        items = await _items(db_session, dept.rope)

        parts = await InventoryService(db_session).stock_breakdown(
            dept.org_id, list(items.values())
        )

        assert parts[dept.rope]["shelf"] == 2

    async def test_the_delivery_picker_leaves_it_out(self, db_session, dept):
        await self._mark(db_session, dept.gauze)
        other = InventoryItem(
            id=_uid(),
            organization_id=dept.org_id,
            category_id=(await _items(db_session, dept.gauze))[dept.gauze].category_id,
            name="Cannula",
            tracking_type=TrackingType.POOL,
            quantity=4,
            active=True,
        )
        db_session.add(other)
        await db_session.commit()

        everything = await ms.list_medical_items(**_list_kwargs(dept, db=db_session))
        stocked = await ms.list_medical_items(
            **_list_kwargs(dept, db=db_session, exclude_apparatus_only=True)
        )

        assert {i.name for i in everything.items} == {"Cannula", "Gauze"}
        assert [i.name for i in stocked.items] == ["Cannula"]
        assert stocked.total == 1

    async def test_an_edit_sets_and_clears_it(self, db_session, dept):
        service = InventoryService(db_session)

        item, err = await service.update_item(
            dept.gauze, dept.org_id, {"apparatus_only": True}
        )
        assert err is None
        assert item.apparatus_only is True

        item, err = await service.update_item(
            dept.gauze, dept.org_id, {"apparatus_only": False}
        )
        assert err is None
        assert item.apparatus_only is False


class TestApparatusOnlySchemas:
    def test_create_defaults_to_false(self):
        assert InventoryItemCreate(name="LUCAS").apparatus_only is False

    def test_update_leaves_it_alone_unless_sent(self):
        assert "apparatus_only" not in InventoryItemUpdate().model_dump(
            exclude_unset=True
        )
        assert InventoryItemUpdate(apparatus_only=True).model_dump(
            exclude_unset=True
        ) == {"apparatus_only": True}


async def _gauze_row(db_session, dept):
    result = await ms.list_medical_items(**_list_kwargs(dept, db=db_session))
    return next(i for i in result.items if str(i.id) == dept.gauze)


class TestNextExpiryAcrossShelfAndTrucks:
    async def test_the_trucks_win_when_their_units_expire_first(self, db_session, dept):
        gauze = await _gauze_row(db_session, dept)

        # Medic 1's 4 expired two days ago; the shelf's 2 expire in five.
        assert gauze.next_expiration_date == dept.today - timedelta(days=2)
        assert gauze.days_until_next_expiration == -2
        assert gauze.next_expiration_location == "apparatus"
        assert gauze.next_expiration_where == "Medic 1 › Main Compartment › Jump Bag"

    async def test_the_shelf_wins_when_it_is_sooner(self, db_session, dept):
        # Empty the expired truck lot: a position holding nothing has nothing
        # to expire, so the truck's next date becomes +10 against the shelf's +5.
        await db_session.execute(
            CheckItemDeployedLot.__table__.update()
            .where(CheckItemDeployedLot.expiration_date < dept.today)
            .values(quantity=0)
        )
        await db_session.commit()

        gauze = await _gauze_row(db_session, dept)

        assert gauze.days_until_next_expiration == 5
        assert gauze.next_expiration_location == "shelf"
        assert gauze.next_expiration_where is None

    async def test_truck_dates_beyond_the_expiring_window_still_count(
        self, db_session, dept
    ):
        await db_session.execute(
            CheckItemDeployedLot.__table__.update().values(
                expiration_date=dept.today + timedelta(days=400)
            )
        )
        await db_session.execute(
            InventoryLot.__table__.delete().where(
                InventoryLot.inventory_item_id == dept.gauze
            )
        )
        await db_session.commit()

        gauze = await _gauze_row(db_session, dept)

        assert gauze.days_until_next_expiration == 400
        assert gauze.next_expiration_location == "apparatus"

    async def test_the_truck_lookup_can_be_narrowed_to_some_supplies(
        self, db_session, dept
    ):
        checks = EquipmentCheckService(db_session)

        none = await checks.apparatus_expiring_stock(
            dept.org_id,
            list(MEDICAL_ITEM_TYPES),
            days_ahead=None,
            today=dept.today,
            item_ids=[],
        )
        gauze = await checks.apparatus_expiring_stock(
            dept.org_id,
            list(MEDICAL_ITEM_TYPES),
            days_ahead=None,
            today=dept.today,
            item_ids=[dept.gauze],
        )

        assert none == []
        assert [r["days_until_expiration"] for r in gauze] == [-2, 10]


class TestOldLotsOfAnApparatusOnlySupply:
    """Lots left on a supply after it was marked apparatus-only are left out
    of the expiring list, the tiles and its next expiry — as its shelf already
    is from its count — and come back if it is unmarked."""

    async def _mark(self, db_session, item_id, value=True):
        await db_session.execute(
            InventoryItem.__table__.update()
            .where(InventoryItem.id == item_id)
            .values(apparatus_only=value)
        )
        await db_session.commit()

    async def test_left_out_of_the_expiring_list(self, db_session, dept):
        await self._mark(db_session, dept.gauze)

        rows = await ms.list_expiring_medical_stock(
            days_ahead=30,
            db=db_session,
            current_user=SimpleNamespace(id=dept.user_id, organization_id=dept.org_id),
        )

        # The truck rows stay; the shelf lot does not.
        assert {r.location for r in rows} == {"apparatus"}

    async def test_left_out_of_the_tiles(self, db_session, dept):
        await self._mark(db_session, dept.gauze)

        summary = await ms.medical_supply_summary(
            expiring_within_days=30,
            db=db_session,
            current_user=SimpleNamespace(id=dept.user_id, organization_id=dept.org_id),
        )

        assert summary["expiring_soon"] == 0
        assert summary["expiring_soon_on_apparatus"] == 1

    async def test_left_out_of_next_expiry(self, db_session, dept):
        await self._mark(db_session, dept.gauze)
        await db_session.execute(CheckItemDeployedLot.__table__.delete())
        await db_session.commit()

        soonest = await InventoryService(db_session).next_lot_expirations(
            dept.org_id, [dept.gauze]
        )

        assert soonest == {}

    async def test_unmarking_brings_them_back(self, db_session, dept):
        await self._mark(db_session, dept.gauze)
        await self._mark(db_session, dept.gauze, value=False)

        rows = await InventoryService(db_session).get_expiring_lots(
            dept.org_id, days_ahead=30, item_types=MEDICAL_ITEM_TYPES, today=dept.today
        )

        assert [str(lot.inventory_item_id) for lot, _ in rows] == [dept.gauze]

    async def test_gear_ignores_the_flag(self, db_session, dept):
        await self._mark(db_session, dept.rope)

        rows = await InventoryService(db_session).get_expiring_lots(
            dept.org_id, days_ahead=30, today=dept.today
        )

        assert dept.rope in {str(lot.inventory_item_id) for lot, _ in rows}


class TestLotRecallSearch:
    """Every unit of a lot, wherever it is: the fixture's shelf lot is
    undated-numbered by default, so each test names the lots it looks for."""

    async def _number_shelf_lot(self, db_session, dept, number):
        await db_session.execute(
            InventoryLot.__table__.update()
            .where(InventoryLot.inventory_item_id == dept.gauze)
            .values(lot_number=number)
        )
        await db_session.commit()

    async def _search(self, db_session, dept, text):
        return await ms.search_medical_lots(
            lot_number=text,
            db=db_session,
            current_user=SimpleNamespace(id=dept.user_id, organization_id=dept.org_id),
        )

    async def test_finds_the_lot_on_the_shelf_and_aboard(self, db_session, dept):
        await self._number_shelf_lot(db_session, dept, "L3-RECALL")

        # Medic 1 carries lot "L3"; the shelf lot is "L3-RECALL". Lower case
        # matches both, as a recall notice and a label rarely agree on case.
        rows = await self._search(db_session, dept, "l3")

        assert [(r.location, r.lot_number, r.quantity) for r in rows] == [
            ("shelf", "L3-RECALL", 2),
            ("apparatus", "L3", 3),
        ]
        assert rows[1].where == "Medic 1 › Main Compartment › Jump Bag"

    async def test_an_expired_unit_is_still_found(self, db_session, dept):
        rows = await self._search(db_session, dept, "L4")

        # Medic 1's lot L4 expired two days ago; a recall still has to find it.
        assert [(r.lot_number, r.days_until_expiration) for r in rows] == [("L4", -2)]

    async def test_an_undated_lot_is_found_and_sorts_last(self, db_session, dept):
        await db_session.execute(
            CheckItemDeployedLot.__table__.update()
            .where(CheckItemDeployedLot.lot_number == "L3")
            .values(expiration_date=None)
        )
        await self._number_shelf_lot(db_session, dept, "L3-B")

        rows = await self._search(db_session, dept, "L3")

        assert [r.lot_number for r in rows] == ["L3-B", "L3"]
        assert rows[1].expiration_date is None

    async def test_a_lot_recorded_on_the_position_itself_is_found(
        self, db_session, dept
    ):
        # Medic 2's position has no deployed lots; its lot is on the position.
        await db_session.execute(
            CheckTemplateItem.__table__.update()
            .where(CheckTemplateItem.id == dept.medic2)
            .values(lot_number="POS-55")
        )
        await db_session.commit()

        rows = await self._search(db_session, dept, "pos-5")

        assert [(r.location, r.quantity) for r in rows] == [("apparatus", 5)]

    async def test_units_that_are_gone_are_left_out(self, db_session, dept):
        await db_session.execute(
            CheckItemDeployedLot.__table__.update()
            .where(CheckItemDeployedLot.lot_number == "L3")
            .values(quantity=0)
        )
        await db_session.commit()

        assert await self._search(db_session, dept, "L3") == []

    async def test_wildcards_are_matched_literally(self, db_session, dept):
        assert await self._search(db_session, dept, "%%") == []

    async def test_gear_lots_are_not_searched(self, db_session, dept):
        await db_session.execute(
            InventoryLot.__table__.update()
            .where(InventoryLot.inventory_item_id == dept.rope)
            .values(lot_number="ROPE-1")
        )
        await db_session.commit()

        assert await self._search(db_session, dept, "ROPE") == []

    async def test_ignores_another_departments_stock(self, db_session, dept):
        await self._number_shelf_lot(db_session, dept, "L3-RECALL")

        rows = await ms.search_medical_lots(
            lot_number="L3",
            db=db_session,
            current_user=SimpleNamespace(id=dept.user_id, organization_id=_uid()),
        )

        assert rows == []

    async def test_a_blank_search_is_refused(self, db_session, dept):
        with pytest.raises(HTTPException) as err:
            await self._search(db_session, dept, "  ")

        assert err.value.status_code == 400


class TestTheWeeklyEmailsReplacementStock:
    async def test_an_apparatus_only_supply_has_none_to_swap_in(self, db_session, dept):
        await db_session.execute(
            InventoryItem.__table__.update()
            .where(InventoryItem.id == dept.gauze)
            .values(apparatus_only=True)
        )
        await db_session.commit()

        lots = await InventoryService(db_session).get_lots_for_items(
            dept.org_id, [dept.gauze, dept.rope]
        )

        # The gauze's leftover shelf lot is not replacement stock; gear keeps its.
        assert set(lots) == {dept.rope}

    async def test_the_overview_carries_the_compartment_path(self, db_session, dept):
        overview = await EquipmentCheckService(db_session).get_supply_overview(
            dept.org_id, 30, today=dept.today
        )

        medic1 = [
            i
            for i in overview["items"]
            if i["compartment_name"] == "Jump Bag" and i["apparatus_name"] == "Medic 1"
        ]
        assert medic1
        assert medic1[0]["compartment_path"] == ["Main Compartment", "Jump Bag"]


class TestTruckRowsNameTheirApparatus:
    async def test_a_truck_row_carries_its_apparatus_id(self, db_session, dept):
        rows = await ms.list_expiring_medical_stock(
            days_ahead=30,
            db=db_session,
            current_user=SimpleNamespace(id=dept.user_id, organization_id=dept.org_id),
        )

        aboard = [r for r in rows if r.location == "apparatus"]
        assert aboard
        assert {r.apparatus_id for r in aboard} == {dept.medic1_rig}
        # A shelf lot is on no apparatus.
        assert {r.apparatus_id for r in rows if r.location == "shelf"} == {None}

    async def test_a_template_for_an_apparatus_type_names_none(self, db_session, dept):
        await db_session.execute(
            EquipmentCheckTemplate.__table__.update()
            .where(EquipmentCheckTemplate.organization_id == dept.org_id)
            .values(apparatus_id=None, apparatus_type="ambulance")
        )
        await db_session.commit()

        rows = await EquipmentCheckService(db_session).apparatus_expiring_stock(
            dept.org_id, list(MEDICAL_ITEM_TYPES), days_ahead=30, today=dept.today
        )

        assert rows
        assert {r["apparatus_id"] for r in rows} == {None}
        assert all(r["where"].startswith("Any ambulance") for r in rows)


async def _medical_item(db_session, dept, name, *, lot_in_days=None):
    """Another medical supply, with a shelf lot expiring ``lot_in_days`` out."""
    row = InventoryItem(
        id=_uid(),
        organization_id=dept.org_id,
        category_id=dept.medical_cat,
        name=name,
        tracking_type=TrackingType.POOL,
        quantity=0,
        active=True,
    )
    db_session.add(row)
    await db_session.flush()
    if lot_in_days is not None:
        db_session.add(
            InventoryLot(
                id=_uid(),
                organization_id=dept.org_id,
                inventory_item_id=row.id,
                quantity=3,
                expiration_date=dept.today + timedelta(days=lot_in_days),
            )
        )
    await db_session.commit()
    return str(row.id)


class TestSortByNextExpiry:
    """Ordered by the Next expiry the rows show: shelf and trucks together."""

    async def _names(self, db_session, dept, **overrides):
        result = await ms.list_medical_items(
            **_list_kwargs(dept, db=db_session, sort_by="next_expiry", **overrides)
        )
        return [i.name for i in result.items], result.total

    async def _stock(self, db_session, dept):
        await _medical_item(db_session, dept, "Bandage", lot_in_days=100)
        await _medical_item(db_session, dept, "Cold Pack", lot_in_days=1)
        await _medical_item(db_session, dept, "Saline")

    async def test_soonest_first_with_the_trucks_counted(self, db_session, dept):
        await self._stock(db_session, dept)

        names, total = await self._names(db_session, dept, sort_order="asc")

        # Gauze's shelf lot is +5, after Cold Pack's +1; it leads only because
        # the expired units on Medic 1 count. Saline has nothing dated.
        assert names == ["Gauze", "Cold Pack", "Bandage", "Saline"]
        assert total == 4

    async def test_latest_first_still_puts_undated_last(self, db_session, dept):
        await self._stock(db_session, dept)

        names, _ = await self._names(db_session, dept, sort_order="desc")

        assert names == ["Bandage", "Cold Pack", "Gauze", "Saline"]

    async def test_a_later_page_continues_the_order(self, db_session, dept):
        """Ranked over the filtered set, so page two follows page one."""
        await self._stock(db_session, dept)

        names, total = await self._names(
            db_session, dept, sort_order="asc", skip=2, limit=2
        )

        assert names == ["Bandage", "Saline"]
        assert total == 4

    async def test_the_filters_still_apply(self, db_session, dept):
        await self._stock(db_session, dept)

        names, total = await self._names(
            db_session, dept, sort_order="asc", search="nda"
        )

        assert names == ["Bandage"]
        assert total == 1

    async def test_with_nothing_dated_it_falls_back_to_name(self, db_session, dept):
        await db_session.execute(
            InventoryLot.__table__.delete().where(
                InventoryLot.organization_id == dept.org_id
            )
        )
        await db_session.execute(
            CheckItemDeployedLot.__table__.delete().where(
                CheckItemDeployedLot.organization_id == dept.org_id
            )
        )
        await db_session.commit()
        await _medical_item(db_session, dept, "Bandage")

        names, _ = await self._names(db_session, dept, sort_order="asc")

        assert names == ["Bandage", "Gauze"]


class TestUncountedPositions:
    """Medic 3 carries Gauze on a position no crew has counted (target 4)."""

    def _user(self, dept):
        return SimpleNamespace(id=dept.user_id, organization_id=dept.org_id)

    async def test_finds_the_supply(self, db_session, dept):
        ids = await InventoryService(db_session).item_ids_with_uncounted_positions(
            dept.org_id, MEDICAL_ITEM_TYPES
        )

        assert ids == [dept.gauze]

    async def test_the_list_names_the_position_and_its_apparatus(
        self, db_session, dept
    ):
        result = await ms.list_medical_items(
            **_list_kwargs(dept, db=db_session, uncounted=True)
        )

        assert [str(i.id) for i in result.items] == [dept.gauze]
        places = result.items[0].apparatus_uncounted_places
        assert [place.model_dump() for place in places] == [
            {
                "template_item_id": dept.medic3,
                "apparatus_id": dept.medic3_rig,
                "where": "Medic 3 › Main Compartment › Jump Bag",
            }
        ]

    async def test_the_summary_counts_supplies(self, db_session, dept):
        summary = await ms.medical_supply_summary(
            expiring_within_days=30, db=db_session, current_user=self._user(dept)
        )

        assert summary["uncounted_on_apparatus"] == 1

    async def test_a_count_clears_it(self, db_session, dept):
        await db_session.execute(
            CheckTemplateItem.__table__.update()
            .where(CheckTemplateItem.id == dept.medic3)
            .values(quantity_on_truck=4)
        )
        await db_session.commit()

        result = await ms.list_medical_items(
            **_list_kwargs(dept, db=db_session, uncounted=True)
        )
        summary = await ms.medical_supply_summary(
            expiring_within_days=30, db=db_session, current_user=self._user(dept)
        )

        assert result.items == []
        assert summary["uncounted_on_apparatus"] == 0

    async def test_a_draft_template_is_not_asked_for(self, db_session, dept):
        await db_session.execute(
            EquipmentCheckTemplate.__table__.update()
            .where(EquipmentCheckTemplate.apparatus_id == dept.medic3_rig)
            .values(is_active=False)
        )
        await db_session.commit()

        ids = await InventoryService(db_session).item_ids_with_uncounted_positions(
            dept.org_id, MEDICAL_ITEM_TYPES
        )

        assert ids == []

    async def test_gear_is_left_out(self, db_session, dept):
        await db_session.execute(
            CheckTemplateItem.__table__.update()
            .where(CheckTemplateItem.id == dept.rope_line)
            .values(quantity_on_truck=None)
        )
        await db_session.commit()

        ids = await InventoryService(db_session).item_ids_with_uncounted_positions(
            dept.org_id, MEDICAL_ITEM_TYPES
        )

        assert ids == [dept.gauze]

    async def test_ignores_another_departments_trucks(self, db_session, dept):
        service = InventoryService(db_session)

        assert (
            await service.item_ids_with_uncounted_positions(_uid(), MEDICAL_ITEM_TYPES)
            == []
        )
        assert (
            await EquipmentCheckService(db_session).position_places(
                _uid(), [dept.medic3]
            )
            == {}
        )

    async def test_a_fully_counted_row_lists_no_places(self, db_session, dept):
        rope = await _medical_item(db_session, dept, "Bandage")

        result = await ms.list_medical_items(**_list_kwargs(dept, db=db_session))

        row = next(i for i in result.items if str(i.id) == rope)
        assert row.apparatus_uncounted_places == []


class TestEveryLotAboardForTheExport:
    """``include_undated``: every lot on the trucks, dated or not."""

    async def _rows(self, db_session, org_id, dept):
        return await EquipmentCheckService(db_session).apparatus_expiring_stock(
            org_id,
            list(MEDICAL_ITEM_TYPES),
            days_ahead=None,
            today=dept.today,
            include_undated=True,
        )

    async def _number_medic2(self, db_session, dept, **values):
        await db_session.execute(
            CheckTemplateItem.__table__.update()
            .where(CheckTemplateItem.id == dept.medic2)
            .values(**values)
        )
        await db_session.commit()

    async def test_an_undated_lot_on_a_position_is_listed(self, db_session, dept):
        await self._number_medic2(db_session, dept, lot_number="M2-LOT")

        rows = await self._rows(db_session, dept.org_id, dept)

        assert [(r["lot_number"], r["quantity"]) for r in rows] == [
            ("L4", 4),
            ("L3", 3),
            ("M2-LOT", 5),
        ]

    async def test_a_position_with_no_lot_and_no_date_is_not(self, db_session, dept):
        rows = await self._rows(db_session, dept.org_id, dept)

        # Medic 2 and Medic 3 record no lot: nothing to list.
        assert {r["lot_number"] for r in rows} == {"L3", "L4"}

    async def test_an_empty_position_is_not(self, db_session, dept):
        await self._number_medic2(
            db_session, dept, lot_number="M2-LOT", quantity_on_truck=0
        )

        rows = await self._rows(db_session, dept.org_id, dept)

        assert "M2-LOT" not in {r["lot_number"] for r in rows}

    async def test_ignores_another_departments_trucks(self, db_session, dept):
        assert await self._rows(db_session, _uid(), dept) == []

    async def test_category_names_are_org_scoped(self, db_session, dept):
        service = InventoryService(db_session)

        assert await service.item_category_names(dept.org_id, [dept.gauze]) == {
            dept.gauze: "Airway"
        }
        assert await service.item_category_names(_uid(), [dept.gauze]) == {}

    async def test_the_export_lists_shelf_and_truck_lots(self, db_session, dept):
        response = await ms.export_medical_lots_csv(
            db=db_session,
            current_user=SimpleNamespace(id=dept.user_id, organization_id=dept.org_id),
        )
        text = "".join(
            [
                c if isinstance(c, str) else c.decode()
                async for c in response.body_iterator
            ]
        )

        rows = [line.split(",") for line in text.strip().splitlines()]
        header, body = rows[0], rows[1:]
        where = header.index("Location")
        # Medic 1's expired 4 (-2d), the shelf's 2 (+5d), Medic 1's 3 (+10d).
        assert [(r[header.index("Quantity")], r[where]) for r in body] == [
            ("4", "On apparatus"),
            ("2", "In storage"),
            ("3", "On apparatus"),
        ]


class TestUncountedPositionsForTheEmail:
    async def test_names_each_position_and_its_supply(self, db_session, dept):
        rows = await EquipmentCheckService(db_session).uncounted_supply_positions(
            dept.org_id, list(MEDICAL_ITEM_TYPES)
        )

        assert rows == [
            {
                "item_name": "Gauze",
                "item_size": None,
                "apparatus_id": dept.medic3_rig,
                "where": "Medic 3 › Main Compartment › Jump Bag",
            }
        ]

    async def test_none_once_counted(self, db_session, dept):
        await db_session.execute(
            CheckTemplateItem.__table__.update()
            .where(CheckTemplateItem.id == dept.medic3)
            .values(quantity_on_truck=4)
        )
        await db_session.commit()

        rows = await EquipmentCheckService(db_session).uncounted_supply_positions(
            dept.org_id, list(MEDICAL_ITEM_TYPES)
        )

        assert rows == []

    async def test_ignores_another_departments_trucks(self, db_session, dept):
        rows = await EquipmentCheckService(db_session).uncounted_supply_positions(
            _uid(), list(MEDICAL_ITEM_TYPES)
        )

        assert rows == []


class TestLotRecalls:
    """A recall reaches every unit carrying the number, shelf and truck."""

    def _user(self, dept):
        return SimpleNamespace(
            id=dept.user_id, organization_id=dept.org_id, username="supply"
        )

    async def _recall(self, db_session, dept, number, item=None, reason=None):
        from app.schemas.inventory import LotRecallCreate

        with patch.object(ms, "log_audit_event", new=AsyncMock()):
            return await ms.record_medical_lot_recall(
                data=LotRecallCreate(
                    inventory_item_id=item or dept.gauze,
                    lot_number=number,
                    reason=reason,
                ),
                db=db_session,
                current_user=self._user(dept),
            )

    async def _lift(self, db_session, dept, recall_id, note="Entered in error"):
        from app.schemas.inventory import LotRecallLift

        with patch.object(ms, "log_audit_event", new=AsyncMock()):
            return await ms.lift_medical_lot_recall(
                recall_id=recall_id,
                data=LotRecallLift(note=note),
                db=db_session,
                current_user=self._user(dept),
            )

    async def _parts(self, db_session, dept):
        items = await _items(db_session, dept.gauze)
        parts = await InventoryService(db_session).stock_breakdown(
            dept.org_id, list(items.values())
        )
        return parts[dept.gauze]

    async def _number_shelf_lot(self, db_session, dept, number, days=5):
        await db_session.execute(
            InventoryLot.__table__.update()
            .where(InventoryLot.inventory_item_id == dept.gauze)
            .values(
                lot_number=number, expiration_date=dept.today + timedelta(days=days)
            )
        )
        await db_session.commit()

    async def test_a_recalled_truck_lot_stops_counting(self, db_session, dept):
        # Medic 1's in-date 3 are lot L3; case and spaces do not matter.
        await self._recall(db_session, dept, " l3 ")

        parts = await self._parts(db_session, dept)

        # 12 aboard before: 3 (L3) + 5 counted + 4 assumed full.
        assert parts["apparatus"] == 9

    async def test_a_recalled_position_lot_stops_counting(self, db_session, dept):
        await db_session.execute(
            CheckTemplateItem.__table__.update()
            .where(CheckTemplateItem.id == dept.medic2)
            .values(lot_number="M2-LOT")
        )
        await db_session.commit()
        await self._recall(db_session, dept, "M2-LOT")

        parts = await self._parts(db_session, dept)

        assert parts["apparatus"] == 7

    async def test_a_recalled_shelf_lot_stops_counting(self, db_session, dept):
        await self._number_shelf_lot(db_session, dept, "GZ-1")
        await self._recall(db_session, dept, "gz-1")
        service = InventoryService(db_session)

        parts = await self._parts(db_session, dept)
        swappable = await service.get_lots_for_items(dept.org_id, [dept.gauze])

        assert parts["shelf"] == 0
        # Not offered as replacement stock, since the swap refuses it.
        assert swappable == {}

    async def test_it_lists_first_in_expiring_whatever_its_date(self, db_session, dept):
        await self._number_shelf_lot(db_session, dept, "GZ-1", days=400)
        await self._recall(db_session, dept, "GZ-1")

        rows = await ms.list_expiring_medical_stock(
            days_ahead=30, db=db_session, current_user=self._user(dept)
        )

        assert rows[0].lot_number == "GZ-1"
        assert rows[0].recalled is True
        assert all(not r.recalled for r in rows[1:])

    async def test_the_list_says_what_is_left_to_pull(self, db_session, dept):
        await self._number_shelf_lot(db_session, dept, "L3")
        made = await self._recall(db_session, dept, "L3", reason="Sterility")

        assert made.units_on_shelf == 2
        assert made.units_aboard == 3
        assert made.reason == "Sterility"
        listed = await ms.list_medical_lot_recalls(
            include_lifted=False, db=db_session, current_user=self._user(dept)
        )
        assert [r.id for r in listed] == [made.id]

    async def test_lifting_restores_the_stock_and_keeps_the_record(
        self, db_session, dept
    ):
        made = await self._recall(db_session, dept, "L3")

        lifted = await self._lift(db_session, dept, made.id)
        parts = await self._parts(db_session, dept)

        assert parts["apparatus"] == 12
        assert lifted.lift_note == "Entered in error"
        assert lifted.units_aboard == 0
        active = await ms.list_medical_lot_recalls(
            include_lifted=False, db=db_session, current_user=self._user(dept)
        )
        everything = await ms.list_medical_lot_recalls(
            include_lifted=True, db=db_session, current_user=self._user(dept)
        )
        assert active == []
        assert [r.id for r in everything] == [made.id]

    async def test_a_second_active_recall_of_the_lot_is_refused(self, db_session, dept):
        await self._recall(db_session, dept, "L3")

        with pytest.raises(HTTPException) as err:
            await self._recall(db_session, dept, "l3")

        assert err.value.status_code == 409

    async def test_a_lifted_recall_cannot_be_lifted_again(self, db_session, dept):
        made = await self._recall(db_session, dept, "L3")
        await self._lift(db_session, dept, made.id)

        with pytest.raises(HTTPException) as err:
            await self._lift(db_session, dept, made.id)

        assert err.value.status_code == 409

    async def test_a_gear_supply_cannot_be_recalled_here(self, db_session, dept):
        with pytest.raises(HTTPException) as err:
            await self._recall(db_session, dept, "R-1", item=dept.rope)

        assert err.value.status_code == 404

    async def test_another_departments_recall_cannot_be_lifted(self, db_session, dept):
        made = await self._recall(db_session, dept, "L3")
        stranger = SimpleNamespace(id=_uid(), organization_id=_uid(), username="x")
        from app.schemas.inventory import LotRecallLift

        with pytest.raises(HTTPException) as err:
            await ms.lift_medical_lot_recall(
                recall_id=made.id,
                data=LotRecallLift(note="Not ours"),
                db=db_session,
                current_user=stranger,
            )

        assert err.value.status_code == 404
        assert (await self._parts(db_session, dept))["apparatus"] == 9

    async def test_another_departments_recall_does_not_reach_us(self, db_session, dept):
        service = InventoryService(db_session)

        assert await service.recalled_lot_keys(_uid(), [dept.gauze]) == set()

    async def test_the_lot_lookup_flags_it(self, db_session, dept):
        # A different lot whose number merely contains the recalled one.
        await self._number_shelf_lot(db_session, dept, "L30")
        await self._recall(db_session, dept, "L3")

        rows = await ms.search_medical_lots(
            lot_number="L3", db=db_session, current_user=self._user(dept)
        )

        flags = {r.lot_number: r.recalled for r in rows}
        assert flags == {"L3": True, "L30": False}
