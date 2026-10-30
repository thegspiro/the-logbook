"""Equipment checks raise the restock and reorder signals themselves.

Two gaps closed together:

* A shift check that counted a position short updated the truck's count but
  never raised a restock report. Only the separate "report used" action did,
  so a crew that found two of four gauze and just recorded it left nothing on
  the supply officer's worklist.
* A lot swap took units off the shelf but never asked whether the shelf was
  now at its reorder point. The next morning's low-stock email was the only
  signal, and it asks nobody to act.
"""

import inspect
import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select, text

from app.models.inventory import (
    ItemType,
    ReorderRequest,
    ReorderStatus,
    ReorderUrgency,
)
from app.services.auto_reorder_service import AutoReorderService, reorder_quantity
from app.services.equipment_check_service import EquipmentCheckService
from app.services.inventory_service import InventoryService


def _counted_item(**over):
    base = dict(
        id="ti-1",
        check_type="count",
        required_quantity=4,
        expected_quantity=None,
        quantity_on_truck=4,
        deployed_lots=[],
        restock_needed=False,
        restock_reported_at=None,
        restock_reported_by=None,
        restock_note=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


@pytest.mark.unit
class TestAShortCountRaisesARestockReport:
    def _reconcile(self, item, counted, checked_by="u-crew"):
        EquipmentCheckService(MagicMock())._reconcile_count_observation(
            item, counted, "org-1", checked_by
        )

    def test_a_short_count_flags_the_position(self):
        item = _counted_item()

        self._reconcile(item, 2)

        assert item.restock_needed is True
        assert item.restock_reported_by == "u-crew"
        assert item.restock_reported_at is not None
        assert item.restock_note == "Counted 2 of 4 on an equipment check"

    def test_a_full_count_raises_nothing(self):
        item = _counted_item()

        self._reconcile(item, 4)

        assert item.restock_needed is False
        assert item.restock_note is None

    def test_a_standing_report_is_not_overwritten(self):
        """The first report names who raised it and why; a recount of the
        same gap adds nothing to that."""
        item = _counted_item(
            quantity_on_truck=3,
            restock_needed=True,
            restock_reported_by="u-medic",
            restock_note="used two on a call",
        )

        self._reconcile(item, 2)

        assert item.restock_reported_by == "u-medic"
        assert item.restock_note == "used two on a call"

    def test_a_full_recount_still_settles_a_standing_report(self):
        item = _counted_item(
            quantity_on_truck=2,
            restock_needed=True,
            restock_reported_by="u-medic",
            restock_note="used two",
        )

        self._reconcile(item, 4)

        assert item.restock_needed is False

    def test_a_position_with_no_target_is_never_short(self):
        item = _counted_item(required_quantity=None)

        self._reconcile(item, 0)

        assert item.restock_needed is False

    def test_a_non_count_position_is_untouched(self):
        item = _counted_item(check_type="presence")

        self._reconcile(item, 0)

        assert item.restock_needed is False

    def test_every_submit_path_passes_the_submitter(self):
        """Shift, standalone and completion all record who counted short."""
        source = inspect.getsource(EquipmentCheckService)
        calls = source.count("await self._create_check_items(")
        assert calls == 3
        assert source.count("organization_id, checked_by\n") >= 2
        assert "                checked_by,\n            )" in source


@pytest.mark.unit
class TestReorderQuantity:
    def test_brings_stock_back_to_twice_the_point(self):
        assert reorder_quantity(on_hand=4, reorder_point=10) == 16

    def test_an_empty_shelf_orders_twice_the_point(self):
        assert reorder_quantity(on_hand=0, reorder_point=5) == 10

    def test_never_asks_for_nothing(self):
        assert reorder_quantity(on_hand=0, reorder_point=0) == 1


@pytest.mark.unit
class TestTheSwapAsksForAReorderAfterCommitting:
    def _service(self):
        db = AsyncMock()
        db.add = MagicMock()
        return EquipmentCheckService(db)

    @staticmethod
    def _own_session():
        session = AsyncMock()
        factory = MagicMock()
        factory.return_value.__aenter__ = AsyncMock(return_value=session)
        factory.return_value.__aexit__ = AsyncMock(return_value=False)
        return factory, session

    async def test_a_failed_reorder_does_not_fail_the_swap(self):
        svc = self._service()
        factory, _ = self._own_session()
        with patch(
            "app.services.equipment_check_service.async_session_factory", factory
        ), patch("app.services.equipment_check_service.AutoReorderService") as cls:
            cls.return_value.raise_if_low = AsyncMock(side_effect=RuntimeError("db"))
            await svc._raise_low_stock_reorder("org-1", "inv-1", "u-1")

        # The request's own session is left alone: rolling it back would
        # expire the endpoint's objects.
        svc.db.rollback.assert_not_awaited()

    async def test_it_runs_in_its_own_session(self):
        svc = self._service()
        factory, session = self._own_session()
        with patch(
            "app.services.equipment_check_service.async_session_factory", factory
        ), patch("app.services.equipment_check_service.AutoReorderService") as cls:
            cls.return_value.raise_if_low = AsyncMock(return_value=None)
            await svc._raise_low_stock_reorder("org-1", "inv-1", "u-1")

        cls.assert_called_once_with(session)
        cls.return_value.raise_if_low.assert_awaited_once_with("org-1", "inv-1", "u-1")

    def test_the_reorder_runs_after_the_swap_commits(self):
        """Inside the swap it would take the item lock after the lot lock —
        the reverse of add_lot — and could deadlock a crew's swap."""
        source = inspect.getsource(EquipmentCheckService.swap_item_lot)
        commit = source.rindex("await self.db.commit()")
        assert source.index("await self._raise_low_stock_reorder(") > commit


def _officer(user_id: str, email: str) -> SimpleNamespace:
    return SimpleNamespace(id=user_id, email=email, notification_preferences=None)


@pytest.mark.unit
class TestTheReorderEmailAudience:
    async def test_a_medical_item_reaches_only_medical_audiences(self):
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=SimpleNamespace(id="org-1"))
        item = SimpleNamespace(
            name="Gauze <4x4>",
            reorder_point=10,
            category=SimpleNamespace(item_type=ItemType.MEDICAL),
        )
        reorder = SimpleNamespace(id="ro-1", quantity_requested=16)
        audiences = {
            frozenset({"gear", "medical"}): [_officer("qm", "qm@x.test")],
            frozenset({"medical"}): [_officer("ems", "ems@x.test")],
            frozenset({"gear"}): [_officer("uniforms", "uniforms@x.test")],
        }
        send = AsyncMock(return_value=(1, 0))
        bell = AsyncMock(return_value=1)
        with patch(
            "app.services.scheduled_tasks._stock_alert_audiences",
            AsyncMock(return_value=audiences),
        ), patch("app.services.officer_alert_copies.add_in_app_copies", bell), patch(
            "app.services.email_service.EmailService"
        ) as email_cls, patch(
            "app.services.email_policy.department_required_kinds",
            return_value=frozenset(),
        ), patch(
            "app.services.email_service.wrap_email_body",
            side_effect=lambda org, title, body, **kw: body,
        ):
            email_cls.return_value.send_email = send
            await AutoReorderService(db)._notify("org-1", item, reorder, 4)

        kwargs = send.await_args.kwargs
        assert kwargs["to_emails"] == ["ems@x.test", "qm@x.test"]
        # The item name is escaped into the HTML body.
        assert "Gauze &lt;4x4&gt;" in kwargs["html_body"]
        # The bell copies reach the same audiences, and only the one holding
        # inventory.manage is pointed at the reorder queue it can open.
        bells = {
            tuple(c.kwargs["recipient_ids"]): c.kwargs["action_url"]
            for c in bell.await_args_list
        }
        assert bells == {
            ("qm",): "/inventory/admin/reorder",
            ("ems",): "/medical-supplies",
        }

    async def test_nobody_to_tell_sends_nothing(self):
        db = AsyncMock()
        db.scalar = AsyncMock(return_value=SimpleNamespace(id="org-1"))
        item = SimpleNamespace(name="Halligan", reorder_point=1, category=None)
        with patch(
            "app.services.scheduled_tasks._stock_alert_audiences",
            AsyncMock(
                return_value={frozenset({"medical"}): [_officer("ems", "ems@x.test")]}
            ),
        ), patch(
            "app.services.officer_alert_copies.add_in_app_copies", AsyncMock()
        ), patch(
            "app.services.email_service.EmailService"
        ) as email_cls, patch(
            "app.services.email_policy.department_required_kinds",
            return_value=frozenset(),
        ):
            email_cls.return_value.send_email = AsyncMock()
            await AutoReorderService(db)._notify(
                "org-1", item, SimpleNamespace(id="ro-2", quantity_requested=1), 0
            )

        email_cls.return_value.send_email.assert_not_awaited()


# ── Database-backed: the rules that need real rows and locks ──────────


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def stocked_item(db_session):
    """An org, a user, and a medical item with a reorder point of 10.

    Committed, because the service under test rolls back on every path that
    files nothing — and an uncommitted fixture would be rolled back with it.
    """
    org_id, user_id = _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"t-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, 'medic', 'Pat', 'Medic', 'medic@test.com', 'x', 'active')"
        ),
        {"id": user_id, "org": org_id},
    )
    await db_session.flush()
    svc = InventoryService(db_session)
    category, _ = await svc.create_category(
        organization_id=uuid.UUID(org_id),
        category_data={"name": "Trauma", "item_type": "medical"},
        created_by=uuid.UUID(user_id),
    )
    item, _ = await svc.create_item(
        organization_id=uuid.UUID(org_id),
        item_data={
            "name": "Gauze 4x4",
            "tracking_type": "pool",
            "quantity": 0,
            "reorder_point": 10,
            "category_id": uuid.UUID(category.id),
        },
        created_by=uuid.UUID(user_id),
    )
    await db_session.commit()
    # Plain strings, not the ORM row: a path that files nothing rolls back,
    # and a rollback expires every object the session holds.
    return org_id, user_id, str(item.id), str(category.id)


async def _set_lot(db_session, org_id, item_id, quantity, expiration=None):
    await db_session.execute(
        text(
            "INSERT INTO inventory_lots (id, organization_id, inventory_item_id, "
            "lot_number, expiration_date, quantity) VALUES "
            "(:id, :org, :item, 'L1', :exp, :qty)"
        ),
        {
            "id": _uid(),
            "org": org_id,
            "item": item_id,
            "exp": expiration,
            "qty": quantity,
        },
    )
    await db_session.commit()


async def _open_reorders(db_session, org_id, item_id):
    result = await db_session.execute(
        select(ReorderRequest).where(
            ReorderRequest.organization_id == org_id,
            ReorderRequest.item_id == item_id,
        )
    )
    return list(result.scalars().all())


@pytest.mark.integration
class TestRaiseIfLow:
    @pytest.fixture(autouse=True)
    def notify_spy(self):
        with patch.object(AutoReorderService, "_notify", AsyncMock()) as notify:
            yield notify

    async def test_stock_at_the_point_files_a_request(self, db_session, stocked_item):
        org_id, user_id, item_id, category_id = stocked_item
        await _set_lot(db_session, org_id, item_id, 10)

        reorder = await AutoReorderService(db_session).raise_if_low(
            org_id, item_id, user_id
        )

        assert reorder is not None
        assert reorder.status == ReorderStatus.PENDING
        assert reorder.quantity_requested == 10
        assert reorder.urgency == ReorderUrgency.NORMAL
        assert reorder.requested_by == user_id
        assert reorder.category_id == category_id

    async def test_an_empty_shelf_is_urgent(self, db_session, stocked_item):
        org_id, user_id, item_id, category_id = stocked_item
        await _set_lot(db_session, org_id, item_id, 0)

        reorder = await AutoReorderService(db_session).raise_if_low(
            org_id, item_id, user_id
        )

        assert reorder.urgency == ReorderUrgency.HIGH
        assert reorder.quantity_requested == 20

    async def test_expired_lots_do_not_count_as_stock(self, db_session, stocked_item):
        """The same rule the daily low-stock alert reads."""
        org_id, user_id, item_id, category_id = stocked_item
        await _set_lot(db_session, org_id, item_id, 50, expiration=date(2000, 1, 1))
        await _set_lot(db_session, org_id, item_id, 3)

        reorder = await AutoReorderService(db_session).raise_if_low(
            org_id, item_id, user_id
        )

        assert reorder.quantity_requested == 17

    async def test_stock_above_the_point_files_nothing(self, db_session, stocked_item):
        org_id, user_id, item_id, category_id = stocked_item
        await _set_lot(db_session, org_id, item_id, 11)

        assert (
            await AutoReorderService(db_session).raise_if_low(org_id, item_id, user_id)
            is None
        )
        assert await _open_reorders(db_session, org_id, item_id) == []

    async def test_no_reorder_point_files_nothing(self, db_session, stocked_item):
        org_id, user_id, item_id, category_id = stocked_item
        await db_session.execute(
            text("UPDATE inventory_items SET reorder_point = NULL WHERE id = :id"),
            {"id": item_id},
        )
        await _set_lot(db_session, org_id, item_id, 0)

        assert (
            await AutoReorderService(db_session).raise_if_low(org_id, item_id, user_id)
            is None
        )

    async def test_an_open_request_is_not_repeated(
        self, db_session, stocked_item, notify_spy
    ):
        org_id, user_id, item_id, category_id = stocked_item
        await _set_lot(db_session, org_id, item_id, 2)
        service = AutoReorderService(db_session)

        first = await service.raise_if_low(org_id, item_id, user_id)
        second = await service.raise_if_low(org_id, item_id, user_id)

        assert first is not None
        assert second is None
        assert len(await _open_reorders(db_session, org_id, item_id)) == 1
        assert notify_spy.await_count == 1

    async def test_a_cancelled_request_does_not_block_a_new_one(
        self, db_session, stocked_item
    ):
        org_id, user_id, item_id, category_id = stocked_item
        await _set_lot(db_session, org_id, item_id, 2)
        service = AutoReorderService(db_session)
        first = await service.raise_if_low(org_id, item_id, user_id)
        first.status = ReorderStatus.CANCELLED
        await db_session.commit()

        second = await service.raise_if_low(org_id, item_id, user_id)

        assert second is not None
        assert second.id != first.id

    async def test_another_orgs_item_is_not_found(self, db_session, stocked_item):
        org_id, user_id, item_id, category_id = stocked_item
        await _set_lot(db_session, org_id, item_id, 0)

        assert (
            await AutoReorderService(db_session).raise_if_low(_uid(), item_id, user_id)
            is None
        )
        assert await _open_reorders(db_session, org_id, item_id) == []
