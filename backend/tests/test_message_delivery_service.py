"""Tests for department message delivery/escalation
(app/services/message_delivery_service.py).

Covers channel routing by priority/ack and the in-app fan-out. DB and the
email/SMS services are mocked; no MySQL, no network.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.consent_service import ConsentService
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
    db.flush = AsyncMock()
    nested = MagicMock()
    nested.__aenter__ = AsyncMock()
    nested.__aexit__ = AsyncMock(return_value=False)
    db.begin_nested = MagicMock(return_value=nested)
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


def _patch_sms_consent(*consented_ids):
    """Pretend the given member ids granted SMS consent (TCPA gate).

    Anyone omitted is treated as never-asked, which the service must handle
    as a refusal.
    """
    return patch.object(
        ConsentService,
        "granted_user_ids",
        new=AsyncMock(return_value=set(consented_ids)),
    )


class TestInAppFanOut:
    async def test_expired_message_is_not_delivered(self):
        db = _db()
        message = _msg()
        message.expires_at = datetime.now() - timedelta(minutes=1)
        with _patch_recipients([_user("u1")]) as recipients:
            await MessageDeliveryService(db).deliver(message)
        recipients.assert_not_awaited()
        db.add.assert_not_called()

    async def test_creates_one_notification_per_recipient_excluding_author(self):
        db = _db()
        recipients = [_user("u1"), _user("author"), _user("u2")]
        svc = MessageDeliveryService(db)
        with _patch_recipients(recipients):
            await svc.deliver(_msg(posted_by="author"))
        # The author is excluded; the other two each get an in-app row.
        assert db.add.call_count == 2
        db.commit.assert_awaited()
        notifications = [call.args[0] for call in db.add.call_args_list]
        assert [item.action_url for item in notifications] == [
            "/messages/m1",
            "/messages/m1",
        ]

    async def test_no_recipients_is_a_noop(self):
        db = _db()
        svc = MessageDeliveryService(db)
        # Only the author is targeted -> nobody left after excluding them.
        with _patch_recipients([_user("author")]):
            await svc.deliver(_msg(posted_by="author"))
        db.add.assert_not_called()

    async def test_deliver_never_raises_on_targeting_failure(self):
        # A message that errors mid-fan-out must not propagate: in the publish
        # task it would otherwise halt delivery of the other due messages.
        db = _db()
        svc = MessageDeliveryService(db)
        with patch.object(
            MessagingService,
            "_targeted_users",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            # Must not raise.
            await svc.deliver(_msg())


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

    async def test_every_message_is_emailed(self):
        # Email is the channel of record: a normal, no-ack message still goes
        # out by email so a member can never say they were not told.
        svc = await self._route(_msg(priority="normal"))
        svc._create_in_app.assert_awaited_once()
        svc._send_email.assert_awaited_once()
        svc._send_sms.assert_not_awaited()

    async def test_ack_required_escalates_email_only(self):
        svc = await self._route(_msg(priority="normal", requires_ack=True))
        svc._send_email.assert_awaited_once()
        svc._send_sms.assert_not_awaited()

    async def test_urgent_escalates_both_email_and_sms(self):
        svc = await self._route(_msg(priority="urgent"))
        svc._send_email.assert_awaited_once()
        svc._send_sms.assert_awaited_once()

    async def test_member_without_sms_consent_is_still_emailed(self):
        # The invariant that makes consent enforcement safe: suppressing a
        # member's text must never mean they go uninformed. Email is sent for
        # an urgent message even when the SMS path drops every recipient for
        # want of consent.
        db = _db()
        svc = MessageDeliveryService(db)
        svc._create_in_app = AsyncMock()
        svc._send_email = AsyncMock()
        fake_sms = MagicMock()
        fake_sms.enabled = True
        fake_sms.send_bulk_sms = AsyncMock()
        recipient = _user("u1", email="a@fd.co", mobile="+15551234567")
        with _patch_recipients([recipient]), patch(
            "app.services.sms_service.SMSService", return_value=fake_sms
        ), _patch_sms_consent():  # nobody consented
            await svc.deliver(_msg(priority="urgent"))
        svc._send_email.assert_awaited_once()
        fake_sms.send_bulk_sms.assert_not_awaited()


class TestEmailRecipientFiltering:
    async def test_email_ignores_opt_out_and_reaches_everyone_with_an_address(self):
        # Email is the record-of-notice channel, so the email_notifications
        # preference does NOT suppress it — a member must not be able to opt
        # out of the evidence that they were told. Only a missing address
        # removes someone.
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
                sent.setdefault("to", []).extend(to_emails)
                return (len(to_emails), 0)

        svc = MessageDeliveryService(db)
        with patch("app.services.email_service.EmailService", _FakeEmail), patch(
            "app.services.email_service.wrap_email_body",
            return_value="<html></html>",
        ):
            await svc._send_email(_msg(priority="urgent"), recipients, org=None)

        # Both addressable members are emailed, including the opted-out one.
        assert sent["to"] == ["in@fd.co", "out@fd.co"]


class TestReportedFailuresAreNotRecordedAsDelivered:
    """A provider that reports failure instead of raising must not read as sent.

    ``EmailService.send_email`` returns ``(sent, failed)`` and
    ``SMSService.send_bulk_sms`` returns a count; neither raises when the
    channel is disabled or the provider rejects a recipient. Marking those
    attempts "delivered" is not just a wrong audit row — the idempotency key
    then suppresses every later retry, so the member never gets the message and
    the record says they did. Email is the channel of record, which is exactly
    what this would silently drop.
    """

    async def test_email_reporting_zero_sent_is_recorded_as_failed(self):
        db = _db()
        recipients = [_user("u1", email="nobody@fd.co")]

        class _FailingEmail:
            def __init__(self, organization=None):
                pass

            async def send_email(self, to_emails, **kwargs):
                return (0, len(to_emails))  # disabled provider / rejected recipient

        svc = MessageDeliveryService(db)
        claimed = []

        async def _claim(message, user, channel):
            attempt = SimpleNamespace(
                status="pending", error=None, delivered_at=None, channel=channel
            )
            claimed.append(attempt)
            return attempt

        svc._claim_delivery = _claim
        with patch("app.services.email_service.EmailService", _FailingEmail), patch(
            "app.services.email_service.wrap_email_body",
            return_value="<html></html>",
        ):
            await svc._send_email(_msg(priority="urgent"), recipients, org=None)

        assert len(claimed) == 1
        assert claimed[0].status == "failed"
        assert claimed[0].delivered_at is None

    async def test_sms_reporting_zero_sent_is_recorded_as_failed(self):
        db = _db()
        recipients = [_user("u1", mobile="+15551234567")]
        svc = MessageDeliveryService(db)
        claimed = []

        async def _claim(message, user, channel):
            attempt = SimpleNamespace(
                status="pending", error=None, delivered_at=None, channel=channel
            )
            claimed.append(attempt)
            return attempt

        svc._claim_delivery = _claim
        fake_sms = MagicMock()
        fake_sms.enabled = True
        fake_sms.send_bulk_sms = AsyncMock(return_value=0)  # Twilio rejected it
        with patch(
            "app.services.sms_service.SMSService", return_value=fake_sms
        ), _patch_sms_consent("u1"):
            await svc._send_sms(
                _msg(priority="urgent"),
                recipients,
                org=SimpleNamespace(name="FD"),
            )

        fake_sms.send_bulk_sms.assert_awaited_once()
        assert len(claimed) == 1
        assert claimed[0].status == "failed"
        assert claimed[0].delivered_at is None


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
        with patch(
            "app.services.sms_service.SMSService", return_value=fake_sms
        ), _patch_sms_consent("u1", "u2", "u3", "u4"):
            await svc._send_sms(
                _msg(priority="urgent"),
                recipients,
                org=SimpleNamespace(name="FD"),
            )
        assert fake_sms.send_bulk_sms.await_count == 2
        numbers = [call.args[0][0] for call in fake_sms.send_bulk_sms.await_args_list]
        assert numbers == ["+1555mobile", "+1555phone"]

    async def test_sms_requires_consent_even_when_the_channel_is_on(self):
        # TCPA: the recorded consent gates the send independently of the
        # member's channel preference. u2 never granted consent, so despite
        # having a number and no opt-out they must not be texted.
        db = _db()
        recipients = [
            _user("u1", mobile="+1555consented"),
            _user("u2", mobile="+1555noconsent"),
        ]
        svc = MessageDeliveryService(db)
        fake_sms = MagicMock()
        fake_sms.enabled = True
        fake_sms.send_bulk_sms = AsyncMock(return_value=1)
        with patch(
            "app.services.sms_service.SMSService", return_value=fake_sms
        ), _patch_sms_consent("u1"):
            await svc._send_sms(
                _msg(priority="urgent"),
                recipients,
                org=SimpleNamespace(name="FD"),
            )
        numbers = fake_sms.send_bulk_sms.await_args.args[0]
        assert numbers == ["+1555consented"]

    async def test_no_consent_means_no_sms_at_all(self):
        # Fail closed: nobody asked, nobody texted — but deliver() still sent
        # the email, so the members were informed.
        db = _db()
        recipients = [_user("u1", mobile="+15551234567")]
        svc = MessageDeliveryService(db)
        fake_sms = MagicMock()
        fake_sms.enabled = True
        fake_sms.send_bulk_sms = AsyncMock()
        with patch(
            "app.services.sms_service.SMSService", return_value=fake_sms
        ), _patch_sms_consent():
            await svc._send_sms(
                _msg(priority="urgent"),
                recipients,
                org=SimpleNamespace(name="FD"),
            )
        fake_sms.send_bulk_sms.assert_not_awaited()


class TestEscalationRateLimit:
    """When the per-org escalation throttle trips, the costly channel is
    skipped — but the message itself and its in-app notification are unaffected
    (those are handled outside these channel methods)."""

    async def test_email_skipped_when_rate_limited(self):
        db = _db()
        recipients = [_user("u1", email="a@fd.co")]
        sent = {"called": False}

        class _FakeEmail:
            def __init__(self, organization=None):
                pass

            async def send_email(self, **kwargs):
                sent["called"] = True
                return (1, 0)

        svc = MessageDeliveryService(db)
        with patch(
            "app.core.security.is_rate_limited", new=AsyncMock(return_value=True)
        ), patch("app.services.email_service.EmailService", _FakeEmail), patch(
            "app.services.email_service.wrap_email_body", return_value="<html></html>"
        ):
            await svc._send_email(_msg(priority="urgent"), recipients, org=None)

        assert sent["called"] is False

    async def test_sms_skipped_when_rate_limited(self):
        db = _db()
        recipients = [_user("u1", mobile="+15551234567")]
        fake_sms = MagicMock()
        fake_sms.enabled = True
        fake_sms.send_bulk_sms = AsyncMock()
        svc = MessageDeliveryService(db)
        with patch(
            "app.core.security.is_rate_limited", new=AsyncMock(return_value=True)
        ), patch("app.services.sms_service.SMSService", return_value=fake_sms):
            await svc._send_sms(_msg(priority="urgent"), recipients, org=None)

        fake_sms.send_bulk_sms.assert_not_awaited()


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
        ) as deliver, patch.object(
            MessagingService, "materialize_recipients", new=AsyncMock()
        ) as materialize:
            result = await run_publish_scheduled_messages(db)

        assert result["published"] == 1
        materialize.assert_awaited_once_with(due)
        # Marked live before delivery so a failure can't cause a re-escalation.
        assert due.scheduled_at is None
        deliver.assert_awaited_once()
        db.commit.assert_awaited()
        claim_statement = db.execute.await_args.args[0]
        assert claim_statement._for_update_arg.skip_locked is True

    async def test_two_publishers_and_retry_deliver_each_channel_once(self):
        """A second publisher/retry loses the same durable delivery keys."""
        recipient = _user("u1", email="member@fd.co", mobile="+15551234567")
        claimed = set()
        in_app = set()
        channel_sends = {"email": 0, "sms": 0}

        class RacingDelivery(MessageDeliveryService):
            async def _create_in_app(self, message, recipients):
                # Models the notification_logs unique constraint.
                for user in recipients:
                    in_app.add((message.id, user.id, "in_app"))

            async def _send_email(self, message, recipients, org):
                key = (message.id, recipients[0].id, "email")
                if key not in claimed:
                    claimed.add(key)
                    channel_sends["email"] += 1

            async def _send_sms(self, message, recipients, org):
                key = (message.id, recipients[0].id, "sms")
                if key not in claimed:
                    claimed.add(key)
                    channel_sends["sms"] += 1

        first, second = RacingDelivery(_db()), RacingDelivery(_db())
        target = MessagingService(first.db)
        target._targeted_users = AsyncMock(return_value=[recipient])
        # One shared patch encloses both workers, avoiding concurrent patch
        # contexts while the deliveries themselves genuinely overlap.
        with patch(
            "app.services.messaging_service.MessagingService", return_value=target
        ):
            await asyncio.gather(
                first.deliver(_msg(priority="urgent")),
                second.deliver(_msg(priority="urgent")),
            )
            # A later task retry must also observe the durable keys.
            await first.deliver(_msg(priority="urgent"))

        assert in_app == {("m1", "u1", "in_app")}
        assert channel_sends == {"email": 1, "sms": 1}

    async def test_deactivates_expired_due_message_without_delivery(self):
        from app.services.scheduled_tasks import run_publish_scheduled_messages

        due = SimpleNamespace(
            scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=2),
            expires_at=datetime.now() - timedelta(minutes=1),
            is_active=True,
            deleted_at=None,
        )
        db = MagicMock(commit=AsyncMock())
        result_set = MagicMock()
        result_set.scalars.return_value.all.return_value = [due]
        db.execute = AsyncMock(return_value=result_set)

        with patch.object(
            MessageDeliveryService, "deliver", new=AsyncMock()
        ) as deliver:
            result = await run_publish_scheduled_messages(db)

        assert result == {
            "task": "publish_scheduled_messages",
            "published": 0,
            "expired": 1,
            "failed": 0,
        }
        assert due.is_active is False
        assert due.scheduled_at is None
        deliver.assert_not_awaited()

    async def test_one_message_failure_does_not_lose_the_rest_of_the_batch(self):
        """The claim step clears scheduled_at for the whole batch up front,
        so a message that fails mid-loop must not propagate and orphan
        every message still left in `due` — the due-query would never
        select them again (same shape as CRON2-31-1/5/6's session-poisoning
        class: a claim/dedup marker must not be stamped independent of
        whether the action it guards actually happened for every item)."""
        from app.services.scheduled_tasks import run_publish_scheduled_messages

        bad = SimpleNamespace(
            id="bad",
            scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=2),
            expires_at=None,
            is_active=True,
            deleted_at=None,
        )
        good = SimpleNamespace(
            id="good",
            scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            expires_at=None,
            is_active=True,
            deleted_at=None,
        )
        db = MagicMock()
        db.commit = AsyncMock()
        db.rollback = AsyncMock()
        db.refresh = AsyncMock()
        result_set = MagicMock()
        result_set.scalars.return_value.all.return_value = [bad, good]
        db.execute = AsyncMock(return_value=result_set)

        with patch.object(
            MessagingService,
            "materialize_recipients",
            new=AsyncMock(side_effect=[Exception("boom"), None]),
        ), patch.object(MessageDeliveryService, "deliver", new=AsyncMock()) as deliver:
            result = await run_publish_scheduled_messages(db)

        assert result["published"] == 1
        assert result["failed"] == 1
        # Both messages were claimed (scheduled_at cleared) in the batch
        # step; only the surviving message was actually delivered — proving
        # `good` was not skipped even though `bad` (processed first) raised.
        assert bad.scheduled_at is None
        assert good.scheduled_at is None
        deliver.assert_awaited_once_with(good)
        db.rollback.assert_awaited_once()
        # The rollback after `bad` failed expires every persistent object in
        # the session, so `good` (fetched in the same original batch) must
        # be refreshed before its attributes are read again.
        db.refresh.assert_awaited_once_with(good)


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
