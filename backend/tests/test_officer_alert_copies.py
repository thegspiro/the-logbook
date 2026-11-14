"""Officer alerts whose email can be turned off also leave a bell entry.

Owner decision 2026-10-29 (KNOWN_LIMITATIONS, "Member Emails — An Opted-Out
Officer or Nominee Hears Nothing"): quartermaster duties and membership and
store administration were email-only, so an officer who turned the email off
was told nothing. Each now writes a bell entry for every officer it is about,
emailed or not, and a recurring digest refreshes an unread entry rather than
stacking a new one each run.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationChannel, NotificationLog
from app.services.inventory_service import InventoryService
from app.services.officer_alert_copies import add_in_app_copies
from app.services.scheduled_tasks import run_inventory_low_stock_alerts

OPTED_OUT = {"email_notifications": False}


# ── The helper, against the database ──────────────────────────────────


async def _officer(db: AsyncSession, org_id: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
            "'Quinn', 'Master', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"qm-{user_id[:8]}",
            "em": f"qm-{user_id[:8]}@fd.test",
        },
    )
    return user_id


async def _entries(db: AsyncSession, org_id: str, category: str):
    return list(
        (
            await db.scalars(
                select(NotificationLog).where(
                    NotificationLog.organization_id == org_id,
                    NotificationLog.category == category,
                )
            )
        ).all()
    )


async def _send(db, org_id, recipients, message, **kwargs):
    await add_in_app_copies(
        db,
        organization_id=org_id,
        recipient_ids=recipients,
        category="inventory_low_stock",
        subject="Low stock",
        message=message,
        action_url="/inventory/admin/items?low_stock=true",
        **kwargs,
    )
    await db.flush()


@pytest.mark.integration
class TestAddInAppCopies:
    async def test_one_entry_per_recipient(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        other = await _officer(db_session, org_id)

        await _send(db_session, org_id, [admin_id, other, admin_id], "3 items low")

        entries = await _entries(db_session, org_id, "inventory_low_stock")
        assert sorted(e.recipient_id for e in entries) == sorted([admin_id, other])
        assert all(e.channel == NotificationChannel.IN_APP for e in entries)

    async def test_a_rerun_refreshes_the_unread_entry(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin

        await _send(db_session, org_id, [admin_id], "3 items low", replace_unread=True)
        await _send(db_session, org_id, [admin_id], "5 items low", replace_unread=True)

        entries = await _entries(db_session, org_id, "inventory_low_stock")
        assert [e.message for e in entries] == ["5 items low"]

    async def test_a_read_entry_is_left_and_a_new_one_added(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _send(db_session, org_id, [admin_id], "3 items low", replace_unread=True)
        (first,) = await _entries(db_session, org_id, "inventory_low_stock")
        first.read = True
        await db_session.flush()

        await _send(db_session, org_id, [admin_id], "5 items low", replace_unread=True)

        entries = await _entries(db_session, org_id, "inventory_low_stock")
        assert sorted(e.message for e in entries) == ["3 items low", "5 items low"]

    async def test_digests_with_different_keys_are_kept_apart(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin

        await _send(
            db_session,
            org_id,
            [admin_id],
            "gear",
            replace_unread=True,
            dedupe_key="gear",
        )
        await _send(
            db_session,
            org_id,
            [admin_id],
            "medical",
            replace_unread=True,
            dedupe_key="medical",
        )

        entries = await _entries(db_session, org_id, "inventory_low_stock")
        assert sorted(e.message for e in entries) == ["gear", "medical"]


# ── The senders, mocked ───────────────────────────────────────────────


def _result(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


@pytest.mark.unit
class TestLowStockReachesAnOptedOutQuartermaster:
    async def test_the_bell_entry_is_written_and_no_email_sent(self):
        quartermaster = SimpleNamespace(
            id="qm1",
            email="qm@fd.example",
            roles=[SimpleNamespace(permissions=["inventory.manage"])],
            notification_preferences=OPTED_OUT,
        )
        item = SimpleNamespace(
            name="Structural gloves",
            reorder_point=10,
            category=SimpleNamespace(name="PPE", item_type=None),
        )
        answers = iter(
            [
                _result([SimpleNamespace(id="org1", name="FD", active=True)]),
                _result([quartermaster]),
            ]
        )
        no_unread = MagicMock()
        no_unread.scalars.return_value = iter(())
        db = MagicMock()
        db.execute = AsyncMock(side_effect=lambda *_a, **_k: next(answers, no_unread))
        db.commit = AsyncMock()
        db.rollback = AsyncMock()
        email_cls = MagicMock()
        email_cls.return_value.send_email = AsyncMock(return_value=(1, 0))

        with patch.object(
            InventoryService,
            "get_low_stock_items_for_alerts",
            new=AsyncMock(return_value=[(item, 2, False)]),
        ), patch("app.services.email_service.EmailService", email_cls):
            result = await run_inventory_low_stock_alerts(db)

        assert result["errors"] == []
        email_cls.return_value.send_email.assert_not_awaited()
        added = [c.args[0] for c in db.add.call_args_list]
        assert [(n.recipient_id, n.category) for n in added] == [
            ("qm1", "inventory_low_stock")
        ]
        assert added[0].action_url == "/inventory/admin/items?low_stock=true"


@pytest.mark.unit
class TestNewStoreOrderReachesEveryManager:
    async def test_a_bell_entry_even_with_nobody_to_email(self):
        from app.services.storefront_notification_service import (
            StorefrontNotificationService,
        )

        service = StorefrontNotificationService(MagicMock())
        service.db.commit = AsyncMock()
        service.get_admin_user_ids = AsyncMock(return_value=["qm1", "qm2"])
        service.get_admin_recipients = AsyncMock(return_value=[])
        order = SimpleNamespace(
            id="order-1",
            organization_id="org1",
            order_number="S-0042",
            customer_name="Dana Member",
        )
        bell = AsyncMock(return_value=2)

        with patch("app.services.officer_alert_copies.add_in_app_copies", bell):
            sent = await service.send_admin_new_order(order, None)

        assert sent == 0
        kwargs = bell.await_args.kwargs
        assert kwargs["recipient_ids"] == ["qm1", "qm2"]
        assert kwargs["category"] == "storefront_admin"
        assert kwargs["dedupe_key"] == "order-1"

    async def test_a_preview_writes_no_bell_entry(self):
        from app.services.storefront_notification_service import (
            StorefrontNotificationService,
        )

        service = StorefrontNotificationService(MagicMock(), capture=[])
        service.get_admin_recipients = AsyncMock(return_value=[])
        bell = AsyncMock()

        with patch("app.services.officer_alert_copies.add_in_app_copies", bell):
            await service.send_admin_new_order(
                SimpleNamespace(id="o", organization_id="org1", order_number="S-1"),
                None,
            )

        bell.assert_not_awaited()


@pytest.mark.unit
class TestWithdrawalReachesAnOptedOutCoordinator:
    async def test_the_bell_entry_is_written_and_no_email_sent(self):
        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
        )

        coordinator = SimpleNamespace(
            id="coord-1", email="coord@fd.example", notification_preferences=OPTED_OUT
        )
        org_result = MagicMock()
        org_result.scalar_one_or_none.return_value = SimpleNamespace(
            id="org1", settings={}
        )
        db = MagicMock()
        db.execute = AsyncMock(return_value=org_result)
        db.commit = AsyncMock()
        service = MembershipPipelineService(db)
        service._withdrawal_notice_recipients = AsyncMock(return_value=[coordinator])
        service._log_activity = AsyncMock()
        prospect = SimpleNamespace(
            id="p-1",
            organization_id="org1",
            first_name="Avery",
            last_name="Applicant",
            pipeline=None,
            current_step=None,
        )
        bell = AsyncMock(return_value=1)
        email_cls = MagicMock()
        email_cls.return_value.send_email = AsyncMock(return_value=(1, 0))

        with patch("app.services.officer_alert_copies.add_in_app_copies", bell), patch(
            "app.services.email_service.EmailService", email_cls
        ):
            await service._notify_coordinators_of_withdrawal(prospect, "Moving away")

        email_cls.return_value.send_email.assert_not_awaited()
        kwargs = bell.await_args.kwargs
        assert kwargs["recipient_ids"] == ["coord-1"]
        assert kwargs["category"] == "prospect_withdrawn"
        assert "Avery Applicant withdrew" in kwargs["message"]
        db.commit.assert_awaited()
