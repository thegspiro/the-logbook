"""Tests for department message delivery/escalation
(app/services/message_delivery_service.py).

Covers channel routing by priority/ack and the in-app fan-out. DB and the
email/SMS services are mocked; no MySQL, no network.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.message_delivery_service import MessageDeliveryService
from app.services.messaging_service import MessagingService


def _msg(priority="normal", requires_ack=False, posted_by="author"):
    return SimpleNamespace(
        id="m1",
        organization_id="org1",
        posted_by=posted_by,
        title="Roof collapse drill",
        body="Report to the training tower at 0900.",
        priority=priority,
        requires_acknowledgment=requires_ack,
        expires_at=None,
    )


def _user(uid, email=None, mobile=None, phone=None, prefs=None):
    return SimpleNamespace(
        id=uid,
        email=email,
        mobile=mobile,
        phone=phone,
        notification_preferences=prefs,
    )


def _db():
    db = MagicMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    # org lookup during escalation
    db.execute = AsyncMock(
        return_value=MagicMock(
            scalar_one_or_none=MagicMock(
                return_value=SimpleNamespace(name="Falls Church FD")
            )
        )
    )
    return db


def _patch_recipients(recipients):
    return patch.object(
        MessagingService,
        "_targeted_users",
        new=AsyncMock(return_value=recipients),
    )


class TestInAppFanOut:
    async def test_creates_one_notification_per_recipient_excluding_author(self):
        db = _db()
        recipients = [_user("u1"), _user("author"), _user("u2")]
        svc = MessageDeliveryService(db)
        with _patch_recipients(recipients):
            await svc.deliver(_msg(posted_by="author"))
        # The author is excluded; the other two each get an in-app row.
        assert db.add.call_count == 2
        db.commit.assert_awaited()

    async def test_no_recipients_is_a_noop(self):
        db = _db()
        svc = MessageDeliveryService(db)
        # Only the author is targeted -> nobody left after excluding them.
        with _patch_recipients([_user("author")]):
            await svc.deliver(_msg(posted_by="author"))
        db.add.assert_not_called()


class TestChannelRouting:
    async def _route(self, message):
        db = _db()
        svc = MessageDeliveryService(db)
        svc._create_in_app = AsyncMock()
        svc._send_email = AsyncMock()
        svc._send_sms = AsyncMock()
        with _patch_recipients([_user("u1", email="a@b.co", mobile="+15551234567")]):
            await svc.deliver(message)
        return svc

    async def test_normal_message_escalates_neither_email_nor_sms(self):
        svc = await self._route(_msg(priority="normal"))
        svc._create_in_app.assert_awaited_once()
        svc._send_email.assert_not_awaited()
        svc._send_sms.assert_not_awaited()

    async def test_ack_required_escalates_email_only(self):
        svc = await self._route(_msg(priority="normal", requires_ack=True))
        svc._send_email.assert_awaited_once()
        svc._send_sms.assert_not_awaited()

    async def test_urgent_escalates_both_email_and_sms(self):
        svc = await self._route(_msg(priority="urgent"))
        svc._send_email.assert_awaited_once()
        svc._send_sms.assert_awaited_once()


class TestEmailRecipientFiltering:
    async def test_email_skips_members_who_opted_out(self):
        db = _db()
        recipients = [
            _user("u1", email="in@fd.co"),
            _user("u2", email="out@fd.co", prefs={"email_notifications": False}),
            _user("u3", email=None),  # no address
        ]
        sent = {}

        class _FakeEmail:
            def __init__(self, organization=None):
                pass

            async def send_email(self, to_emails, **kwargs):
                sent["to"] = to_emails
                return (len(to_emails), 0)

        svc = MessageDeliveryService(db)
        with patch("app.services.email_service.EmailService", _FakeEmail), patch(
            "app.services.email_service.wrap_email_body",
            return_value="<html></html>",
        ):
            await svc._send_email(_msg(priority="urgent"), recipients, org=None)

        # Only the opted-in member with an address is emailed.
        assert sent["to"] == ["in@fd.co"]


class TestSmsGating:
    async def test_sms_skipped_when_twilio_disabled(self):
        db = _db()
        recipients = [_user("u1", mobile="+15551234567")]
        svc = MessageDeliveryService(db)
        fake_sms = MagicMock()
        fake_sms.enabled = False
        fake_sms.send_bulk_sms = AsyncMock()
        with patch("app.services.sms_service.SMSService", return_value=fake_sms):
            await svc._send_sms(_msg(priority="urgent"), recipients, org=None)
        fake_sms.send_bulk_sms.assert_not_awaited()

    async def test_sms_uses_mobile_then_phone_for_opted_in_members(self):
        db = _db()
        recipients = [
            _user("u1", mobile="+1555mobile"),
            _user("u2", phone="+1555phone"),
            _user("u3", mobile="+1555nope", prefs={"sms_notifications": False}),
            _user("u4"),  # no number
        ]
        svc = MessageDeliveryService(db)
        fake_sms = MagicMock()
        fake_sms.enabled = True
        fake_sms.send_bulk_sms = AsyncMock(return_value=2)
        with patch("app.services.sms_service.SMSService", return_value=fake_sms):
            await svc._send_sms(
                _msg(priority="urgent"),
                recipients,
                org=SimpleNamespace(name="FD"),
            )
        fake_sms.send_bulk_sms.assert_awaited_once()
        numbers = fake_sms.send_bulk_sms.await_args.args[0]
        assert numbers == ["+1555mobile", "+1555phone"]


class TestPublishScheduledMessages:
    """The publish task marks due messages live (clears scheduled_at) and then
    delivers them via the shared escalation path."""

    async def test_publishes_due_messages_and_clears_schedule(self):
        from app.services.scheduled_tasks import run_publish_scheduled_messages

        due = SimpleNamespace(
            scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            is_active=True,
            deleted_at=None,
        )
        db = MagicMock()
        db.commit = AsyncMock()
        exec_result = MagicMock()
        exec_result.scalars.return_value.all.return_value = [due]
        db.execute = AsyncMock(return_value=exec_result)

        with patch.object(
            MessageDeliveryService, "deliver", new=AsyncMock()
        ) as deliver:
            result = await run_publish_scheduled_messages(db)

        assert result["published"] == 1
        # Marked live before delivery so a failure can't cause a re-escalation.
        assert due.scheduled_at is None
        deliver.assert_awaited_once()
        db.commit.assert_awaited()


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
