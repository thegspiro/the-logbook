"""Tests for chat notification dispatch (Slack/Discord/Teams).

Verifies that a domain event is formatted and routed to the correct platform
sender, that non-messaging or misconfigured integrations are skipped, and that
the org-level fan-out counts successes and tolerates per-integration failures.
The platform formatters run for real (pure functions); the network senders are
mocked. DB mocked.
"""

from unittest.mock import AsyncMock, MagicMock

from app.services.integration_services import notification_dispatch as nd


def _integration(itype, webhook="https://hook.example/x"):
    integ = MagicMock()
    integ.integration_type = itype
    integ.config = {}
    integ.get_secret = MagicMock(return_value=webhook)
    return integ


def _db_returning(integrations):
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=integrations)
    result = MagicMock()
    result.scalars = MagicMock(return_value=scalars)
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


class TestSendIntegrationNotification:
    async def test_discord_event_calls_sender_with_embed(self, monkeypatch):
        sender = AsyncMock(return_value=True)
        monkeypatch.setattr(
            "app.services.integration_services.discord_service."
            "send_discord_notification",
            sender,
        )
        ok = await nd.send_integration_notification(
            _integration("discord"), "event", {"title": "Drill Night"}
        )
        assert ok is True
        sender.assert_awaited_once()
        args, kwargs = sender.call_args
        assert args[0] == "https://hook.example/x"
        assert kwargs["embeds"] and kwargs["content"]

    async def test_slack_shift_calls_sender_with_blocks(self, monkeypatch):
        sender = AsyncMock(return_value=True)
        monkeypatch.setattr(
            "app.services.integration_services.slack_service.send_slack_notification",
            sender,
        )
        ok = await nd.send_integration_notification(
            _integration("slack"), "shift", {"type": "A Platoon"}
        )
        assert ok is True
        sender.assert_awaited_once()
        args, _ = sender.call_args
        assert args[0] == "https://hook.example/x"  # webhook_url
        assert args[1]  # fallback text

    async def test_teams_training_calls_sender_with_title(self, monkeypatch):
        sender = AsyncMock(return_value=True)
        monkeypatch.setattr(
            "app.services.integration_services.teams_service.send_teams_notification",
            sender,
        )
        ok = await nd.send_integration_notification(
            _integration("microsoft-teams"), "training", {"title": "CPR"}
        )
        assert ok is True
        sender.assert_awaited_once()

    async def test_non_messaging_type_is_skipped(self):
        assert (
            await nd.send_integration_notification(
                _integration("salesforce"), "event", {}
            )
            is False
        )

    async def test_missing_webhook_is_skipped(self):
        integ = _integration("discord", webhook="")
        integ.config = {}
        assert await nd.send_integration_notification(integ, "event", {}) is False

    async def test_unknown_kind_is_skipped(self, monkeypatch):
        sender = AsyncMock(return_value=True)
        monkeypatch.setattr(
            "app.services.integration_services.discord_service."
            "send_discord_notification",
            sender,
        )
        assert (
            await nd.send_integration_notification(
                _integration("discord"), "bogus", {}
            )
            is False
        )
        sender.assert_not_awaited()


class TestDispatchChatNotifications:
    async def test_dispatches_to_all_enabled_and_counts(self, monkeypatch):
        db = _db_returning([_integration("discord"), _integration("slack")])
        monkeypatch.setattr(
            nd, "send_integration_notification", AsyncMock(return_value=True)
        )
        sent = await nd.dispatch_chat_notifications(db, "org1", "event", {"title": "x"})
        assert sent == 2

    async def test_one_failure_does_not_block_others(self, monkeypatch):
        db = _db_returning([_integration("discord"), _integration("slack")])
        calls = {"n": 0}

        async def flaky(_integration_obj, _kind, _payload):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("webhook down")
            return True

        monkeypatch.setattr(nd, "send_integration_notification", flaky)
        sent = await nd.dispatch_chat_notifications(db, "org1", "event", {})
        assert sent == 1

    async def test_db_error_returns_zero(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=RuntimeError("db down"))
        assert await nd.dispatch_chat_notifications(db, "org1", "event", {}) == 0
