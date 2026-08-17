"""The quartermaster low-stock alert is email-only
(app/services/scheduled_tasks.run_inventory_low_stock_alerts).

Reordering is a purchasing decision made during business hours against an
itemised table, so the alert carries a full email and deliberately sends no
text. DB, email and SMS are mocked; no network, no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.inventory_service import InventoryService
from app.services.scheduled_tasks import run_inventory_low_stock_alerts


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


def _quartermaster():
    # Recipients are resolved by granted permission, not by a role name: a
    # department may run all stock through a quartermaster or split medical
    # off to an EMS supply officer. inventory.manage covers both domains.
    return SimpleNamespace(
        id="qm1",
        email="qm@fd.example",
        phone="+15551234567",
        roles=[SimpleNamespace(permissions=["inventory.manage"])],
    )


class _FakeEmail:
    """Captures the one send_email call the task makes."""

    sent: dict = {}

    def __init__(self, organization=None):
        pass

    async def send_email(self, to_emails, subject, **kwargs):
        _FakeEmail.sent = {"to": to_emails, "subject": subject}
        return (len(to_emails), 0)


async def _run(low_stock, admins):
    """Drive the task with a db whose two queries return orgs then admins."""
    _FakeEmail.sent = {}
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[_result([_org()]), _result(admins)])
    db.rollback = AsyncMock()
    sms_cls = MagicMock()

    with patch.object(
        InventoryService,
        "get_low_stock_items_for_alerts",
        new=AsyncMock(return_value=low_stock),
    ), patch("app.services.email_service.EmailService", _FakeEmail), patch(
        "app.services.email_service.wrap_email_body", return_value="<html></html>"
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

    async def test_no_text_is_sent_even_with_a_number_on_file(self):
        # The regression guard for the 2026-08 email-first change: this alert
        # used to text every consenting admin. A text can carry neither the
        # item list nor the quantities, so it was pure out-of-hours noise.
        # SMSService must not even be constructed.
        _, sms_cls = await _run([_low_stock_item()], [_quartermaster()])
        sms_cls.assert_not_called()

    async def test_nothing_is_sent_when_no_item_is_below_its_reorder_point(self):
        result, sms_cls = await _run([], [_quartermaster()])
        assert result["total"] == 0
        assert _FakeEmail.sent == {}
        sms_cls.assert_not_called()


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
