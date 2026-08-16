"""The senders actually consult the rules
(scheduled_tasks.run_event_reminders / run_cert_expiration_alerts).

test_notification_rules covers what the resolver decides. These cover the part
that was missing for the table's whole existence: that somebody asks it. DB,
email and the cert service are mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.cert_alert_service import CertAlertService
from app.services.scheduled_tasks import (
    run_cert_expiration_alerts,
    run_event_reminders,
)


def _scalars(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _org():
    return SimpleNamespace(
        id="org-1", name="Falls Church FD", active=True, settings={}, timezone="UTC"
    )


def _rule(enabled):
    return SimpleNamespace(name="Event reminders", enabled=enabled, config=None)


def _db(rules):
    """Orgs first, then the resolver's rule lookup, then anything else empty."""
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[_scalars([_org()]), _scalars(rules), _scalars([])]
    )
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


class TestCertExpirationAlerts:
    async def test_a_disabled_rule_stops_the_run(self):
        db = _db([_rule(enabled=False)])
        with patch.object(
            CertAlertService, "process_alerts", new=AsyncMock()
        ) as process:
            result = await run_cert_expiration_alerts(db)
        process.assert_not_awaited()
        assert result["total"] == 0

    async def test_no_rule_leaves_the_alerts_running(self):
        # An org that never opened the notifications screen is unaffected.
        db = _db([])
        with patch.object(
            CertAlertService,
            "process_alerts",
            new=AsyncMock(return_value={"alerts_sent": 3}),
        ) as process:
            result = await run_cert_expiration_alerts(db)
        process.assert_awaited_once()
        assert result["total"] == 3

    async def test_an_enabled_rule_leaves_the_alerts_running(self):
        db = _db([_rule(enabled=True)])
        with patch.object(
            CertAlertService,
            "process_alerts",
            new=AsyncMock(return_value={"alerts_sent": 1}),
        ) as process:
            result = await run_cert_expiration_alerts(db)
        process.assert_awaited_once()
        assert result["total"] == 1


class TestEventReminders:
    async def test_a_disabled_rule_skips_the_org_before_it_loads_events(self):
        db = _db([_rule(enabled=False)])
        result = await run_event_reminders(db)
        assert result["total_in_app_reminders"] == 0
        assert result["total_emails_sent"] == 0
        # Orgs, then the rule — and then it gave up, rather than going on to
        # query the org's upcoming events.
        assert db.execute.await_count == 2

    async def test_no_rule_still_loads_the_org_s_events(self):
        db = _db([])
        await run_event_reminders(db)
        assert db.execute.await_count == 3


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
