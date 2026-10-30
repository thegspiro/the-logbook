"""Generic Webhooks are sent the events the chat integrations get.

Owner decision 2026-10-29 (KNOWN_LIMITATIONS, "Integrations — Weather Alerts and
Generic Webhooks Do Nothing After Their Test"): event created, shift created
and training recorded, each pickable in the webhook's settings. An empty
selection means every event, so a webhook connected before the setting existed
starts receiving them.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from app.schemas.integration import GenericWebhookConfig
from app.services.integration_services import notification_dispatch
from app.services.integration_services.notification_dispatch import (
    dispatch_generic_webhooks,
)

pytestmark = pytest.mark.unit


def _webhook(event_types=(), url="https://hooks.example.org/in", secret="s3"):
    secrets = {"url": url, "secret": secret}
    return SimpleNamespace(
        integration_type="generic-webhook",
        config={"event_types": list(event_types)},
        get_secret=lambda key: secrets.get(key),
    )


def _db(*integrations):
    result = MagicMock()
    result.scalars.return_value.all.return_value = list(integrations)
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


async def _dispatch(db, kind, payload=None):
    send = AsyncMock(return_value=True)
    with patch(
        "app.services.integration_services.webhook_service.send_webhook", send
    ), patch.object(notification_dispatch, "record_integration_run", AsyncMock()):
        sent = await dispatch_generic_webhooks(db, "org-1", kind, payload or {})
    return sent, send


async def test_an_unfiltered_webhook_gets_every_event():
    sent, send = await _dispatch(_db(_webhook()), "shift", {"type": "Shift"})

    assert sent == 1
    url, event_type, payload = send.await_args.args
    assert (url, event_type, payload) == (
        "https://hooks.example.org/in",
        "shift.created",
        {"type": "Shift"},
    )
    assert send.await_args.kwargs == {"secret": "s3"}


async def test_a_webhook_gets_only_the_events_it_picked():
    db = _db(_webhook(event_types=["training.recorded"]))

    assert (await _dispatch(db, "event"))[0] == 0
    sent, send = await _dispatch(db, "training")
    assert sent == 1
    assert send.await_args.args[1] == "training.recorded"


async def test_no_url_sends_nothing():
    sent, send = await _dispatch(_db(_webhook(url="")), "event")

    assert sent == 0
    send.assert_not_awaited()


async def test_an_unknown_kind_sends_nothing():
    sent, send = await _dispatch(_db(_webhook()), "summary")

    assert sent == 0
    send.assert_not_awaited()


def test_settings_accept_only_the_known_event_types():
    config = GenericWebhookConfig(
        url="https://x.example", event_types=["shift.created", "shift.created"]
    )
    assert config.event_types == ["shift.created"]
    with pytest.raises(ValidationError, match="Unknown webhook event type"):
        GenericWebhookConfig(url="https://x.example", event_types=["event.deleted"])


async def test_the_background_entrypoint_sends_webhooks_too():
    session = MagicMock()
    session.commit = AsyncMock()
    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)
    webhooks = AsyncMock(return_value=1)

    with patch("app.core.database.async_session_factory", factory), patch.object(
        notification_dispatch, "dispatch_chat_notifications", AsyncMock(return_value=0)
    ), patch.object(notification_dispatch, "dispatch_generic_webhooks", webhooks):
        await notification_dispatch.notify_entity_created(
            "org-1", "event", {"title": "Drill"}
        )

    webhooks.assert_awaited_once_with(session, "org-1", "event", {"title": "Drill"})
