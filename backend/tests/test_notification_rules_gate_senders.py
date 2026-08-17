"""The senders actually consult the rules
(scheduled_tasks.run_event_reminders / CertAlertService.process_alerts).

test_notification_rules covers what the resolver decides. These cover the part
that was missing for the table's whole existence: that somebody asks it.

The cert-alert gate is asserted on ``CertAlertService.process_alerts`` rather
than on the scheduled task, because three entry points reach that method — the
daily task, ``/training/certifications/process-alerts``, and the all-orgs
endpoint via ``run_daily_cert_alerts``. Gating only the task would have left
the trigger reported as enforced while two routes still sent alerts, which is
the very failure this table's dispatcher was missing. DB mocked; no MySQL.
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


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _org(cert_alerts_on=True):
    return SimpleNamespace(
        id="org-1",
        name="Falls Church FD",
        active=True,
        settings={"cert_alert_config": {"enabled": cert_alerts_on}},
        timezone="UTC",
    )


def _rule(enabled):
    return SimpleNamespace(name="Rule", enabled=enabled, config=None)


class TestCertAlertsAtTheSharedChokepoint:
    async def _process(self, rules):
        """process_alerts against an org whose training module has alerts on."""
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(_org()),  # get_alert_config
                _scalars(rules),  # TRAINING_EXPIRY rules
                _one(_org()),  # process org
                _scalars([]),  # expiring
                _scalars([]),  # expired
            ]
        )
        db.commit = AsyncMock()
        return await CertAlertService(db).process_alerts("org-1"), db

    async def test_a_disabled_rule_stops_the_alerts(self):
        result, db = await self._process([_rule(enabled=False)])
        assert result == {
            "alerts_sent": 0,
            "escalations_sent": 0,
            "in_app_sent": 0,
            "errors": 0,
        }
        # Gave up after config + rules, rather than going on to load the org
        # and its expiring certifications.
        assert db.execute.await_count == 2

    async def test_no_rule_leaves_the_alerts_running(self):
        # An org that never opened the notifications screen is unaffected.
        _, db = await self._process([])
        assert db.execute.await_count > 2

    async def test_an_enabled_rule_leaves_the_alerts_running(self):
        _, db = await self._process([_rule(enabled=True)])
        assert db.execute.await_count > 2

    async def test_the_scheduled_task_no_longer_gates_it_itself(self):
        # The task must delegate, or the two endpoint entry points that call
        # the service directly would bypass the rule.
        db = MagicMock()
        db.execute = AsyncMock(return_value=_scalars([_org()]))
        db.rollback = AsyncMock()
        with patch.object(
            CertAlertService,
            "process_alerts",
            new=AsyncMock(return_value={"alerts_sent": 2}),
        ) as process:
            result = await run_cert_expiration_alerts(db)
        process.assert_awaited_once()
        assert result["total"] == 2


class TestEventReminders:
    def _db(self, rules):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_scalars([_org()]), _scalars(rules), _scalars([])]
        )
        db.commit = AsyncMock()
        db.rollback = AsyncMock()
        return db

    async def test_a_disabled_rule_skips_the_org_before_it_loads_events(self):
        db = self._db([_rule(enabled=False)])
        result = await run_event_reminders(db)
        assert result["total_in_app_reminders"] == 0
        assert result["total_emails_sent"] == 0
        # Orgs, then the rule — and then it gave up, rather than going on to
        # query the org's upcoming events.
        assert db.execute.await_count == 2

    async def test_no_rule_still_loads_the_org_s_events(self):
        db = self._db([])
        await run_event_reminders(db)
        assert db.execute.await_count == 3


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
