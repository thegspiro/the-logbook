"""The quartermaster low-stock alert is email-only
(app/services/scheduled_tasks.run_inventory_low_stock_alerts).

Reordering is a purchasing decision made during business hours against an
itemised table, so the alert carries a full email and deliberately sends no
text. DB, email and SMS are mocked; no network, no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.config import settings
from app.services.inventory_service import InventoryService
from app.services.scheduled_tasks import (
    MEDICAL_ITEM_TYPES,
    run_inventory_low_stock_alerts,
)


def _result(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _org():
    return SimpleNamespace(id="org1", name="Falls Church FD", active=True)


def _low_stock_item(name="Structural gloves", on_hand=2, reorder_point=10):
    item = SimpleNamespace(
        name=name,
        reorder_point=reorder_point,
        category=SimpleNamespace(name="PPE"),
    )
    return (item, on_hand, False)


def _medical_low_stock_item(name="Nasal cannula", on_hand=1, reorder_point=6):
    item = SimpleNamespace(
        name=name,
        reorder_point=reorder_point,
        category=SimpleNamespace(
            name="Airway", item_type=sorted(MEDICAL_ITEM_TYPES)[0]
        ),
    )
    return (item, on_hand, False)


def _quartermaster():
    # Recipients are resolved by granted permission, not by a role name: a
    # department may run all stock through a quartermaster or split medical
    # off to an EMS supply officer. inventory.manage covers both domains.
    return SimpleNamespace(
        id="qm1",
        email="qm@fd.example",
        phone="+15551234567",
        roles=[SimpleNamespace(permissions=["inventory.manage"])],
        notification_preferences=None,
    )


class _FakeEmail:
    """Captures the one send_email call the task makes."""

    sent: dict = {}

    def __init__(self, organization=None):
        pass

    async def send_email(self, to_emails, subject, **kwargs):
        _FakeEmail.sent = {
            "to": to_emails,
            "subject": subject,
            "html": kwargs.get("html_body", ""),
            "text": kwargs.get("text_body", ""),
        }
        return (len(to_emails), 0)


async def _run(low_stock, admins):
    """Drive the task with a db whose two queries return orgs then admins.

    A later query is the bell copy looking for an unread entry, and finds none.
    """
    _FakeEmail.sent = {}
    answers = iter([_result([_org()]), _result(admins)])
    no_unread = MagicMock()
    no_unread.scalars.return_value = iter(())
    db = MagicMock()
    db.execute = AsyncMock(side_effect=lambda *_a, **_k: next(answers, no_unread))
    db.rollback = AsyncMock()
    db.commit = AsyncMock()
    sms_cls = MagicMock()

    with patch.object(
        InventoryService,
        "get_low_stock_items_for_alerts",
        new=AsyncMock(return_value=low_stock),
    ), patch("app.services.email_service.EmailService", _FakeEmail), patch(
        "app.services.email_service.wrap_email_body",
        side_effect=lambda org, title, body, **kwargs: body,
    ), patch(
        "app.services.sms_service.SMSService", sms_cls
    ):
        result = await run_inventory_low_stock_alerts(db)
    return result, sms_cls


class TestLowStockAlerts:
    async def test_quartermaster_is_emailed_the_itemised_alert(self):
        result, _ = await _run([_low_stock_item()], [_quartermaster()])
        assert result["total"] == 1
        assert result["errors"] == []
        assert _FakeEmail.sent["to"] == ["qm@fd.example"]
        assert "Low Stock Alert" in _FakeEmail.sent["subject"]
        # The query includes an item sitting exactly at its reorder point.
        assert "at or below reorder point" in _FakeEmail.sent["subject"]

    async def test_medical_rows_link_to_the_low_stock_tab(self):
        await _run([_medical_low_stock_item()], [_quartermaster()])
        url = f"{settings.FRONTEND_URL}/medical-supplies?tab=low"
        assert f'<a href="{url}">' in _FakeEmail.sent["html"]
        assert url in _FakeEmail.sent["text"]

    async def test_a_gear_only_email_links_to_the_gear_list_and_not_the_medical_one(
        self,
    ):
        await _run([_low_stock_item()], [_quartermaster()])
        gear_url = f"{settings.FRONTEND_URL}/inventory/admin/items?low_stock=true"
        assert f'<a href="{gear_url}">' in _FakeEmail.sent["html"]
        assert gear_url in _FakeEmail.sent["text"]
        assert "/medical-supplies" not in _FakeEmail.sent["html"]
        assert "/medical-supplies" not in _FakeEmail.sent["text"]

    async def test_a_medical_only_email_has_no_gear_link(self):
        # A medical-only officer lacks inventory.manage, so the gear page would
        # send them to Access Denied.
        await _run([_medical_low_stock_item()], [_quartermaster()])
        assert "/inventory/admin/items" not in _FakeEmail.sent["html"]
        assert "/inventory/admin/items" not in _FakeEmail.sent["text"]

    async def test_a_mixed_email_links_to_both_lists(self):
        await _run([_low_stock_item(), _medical_low_stock_item()], [_quartermaster()])
        html = _FakeEmail.sent["html"]
        assert f"{settings.FRONTEND_URL}/medical-supplies?tab=low" in html
        assert f"{settings.FRONTEND_URL}/inventory/admin/items?low_stock=true" in html

    async def test_no_text_is_sent_even_with_a_number_on_file(self):
        # The regression guard for the 2026-08 email-first change: this alert
        # used to text every consenting admin. A text can carry neither the
        # item list nor the quantities, so it was pure out-of-hours noise.
        # SMSService must not even be constructed.
        _, sms_cls = await _run([_low_stock_item()], [_quartermaster()])
        sms_cls.assert_not_called()

    async def test_a_quartermaster_who_turned_duty_emails_off_is_not_emailed(self):
        qm = _quartermaster()
        qm.notification_preferences = {"email_kinds": {"inventory_duties": False}}
        result, _ = await _run([_low_stock_item()], [qm])
        assert result["total"] == 0
        assert _FakeEmail.sent == {}

    async def test_nothing_is_sent_when_no_item_is_below_its_reorder_point(self):
        result, sms_cls = await _run([], [_quartermaster()])
        assert result["total"] == 0
        assert _FakeEmail.sent == {}
        sms_cls.assert_not_called()


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
