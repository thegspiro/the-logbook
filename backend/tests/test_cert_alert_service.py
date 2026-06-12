"""
Tests for the certification expiration alert service
(app/services/cert_alert_service.py).

Covers config resolution, the member email-preference gate, and the tiered
alert date logic (which tier fires, per-tier dedup, expired-cert escalation).
The notification and email integrations are mocked. DB mocked; no MySQL.

A never-alerted cert already inside an urgent window jumps straight to the
most urgent applicable tier and suppresses the skipped earlier tiers
(test_late_added_cert_jumps_to_most_urgent_tier).
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.cert_alert_service import CertAlertService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _org(config=None):
    settings = {"cert_alert_config": config} if config is not None else {}
    return SimpleNamespace(id="org-1", settings=settings)


def _record(days_until, **fields):
    base = {
        "id": "rec-1",
        "user_id": "u1",
        "course_name": "Firefighter I",
        "certification_number": None,
        "issuing_agency": None,
        "expiration_date": date.today() + timedelta(days=days_until),
        "alert_90_sent_at": None,
        "alert_60_sent_at": None,
        "alert_30_sent_at": None,
        "alert_7_sent_at": None,
        "escalation_sent_at": None,
    }
    base.update(fields)
    return SimpleNamespace(**base)


def _member(email="m@x.org", email_enabled=True, **kw):
    prefs = None if email_enabled else {"email_notifications": False}
    return SimpleNamespace(
        id="u1",
        first_name="Jane",
        full_name="Jane Smith",
        email=email,
        personal_email=kw.get("personal_email"),
        notification_preferences=prefs,
    )


@pytest.fixture(autouse=True)
def _stub_integrations(monkeypatch):
    """Replace the notification + email integrations with no-op mocks."""
    monkeypatch.setattr(
        "app.services.cert_alert_service.NotificationsService",
        lambda db: SimpleNamespace(log_notification=AsyncMock()),
    )
    monkeypatch.setattr(
        "app.services.cert_alert_service.EmailService",
        lambda org: SimpleNamespace(send_email=AsyncMock(return_value=(1, None))),
    )
    monkeypatch.setattr(
        "app.services.cert_alert_service.build_email_logo_html", lambda org: ""
    )


class TestGetAlertConfig:
    async def test_org_missing_disabled(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(None))
        assert await CertAlertService(db).get_alert_config("org-1") == {
            "enabled": False
        }

    async def test_returns_config(self):
        cfg = {"enabled": True, "escalation_roles": ["chief"]}
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(_org(cfg)))
        assert await CertAlertService(db).get_alert_config("org-1") == cfg

    async def test_no_config_key_disabled(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(_org()))
        assert await CertAlertService(db).get_alert_config("org-1") == {
            "enabled": False
        }


class TestMemberEmailEnabled:
    def _svc(self):
        return CertAlertService(MagicMock())

    def test_no_prefs_defaults_enabled(self):
        assert self._svc()._member_has_email_enabled(_member()) is True

    def test_email_notifications_off(self):
        m = SimpleNamespace(notification_preferences={"email_notifications": False})
        assert self._svc()._member_has_email_enabled(m) is False

    def test_email_channel_off(self):
        m = SimpleNamespace(
            notification_preferences={"email_notifications": True, "email": False}
        )
        assert self._svc()._member_has_email_enabled(m) is False


class TestProcessAlertsGuards:
    async def test_disabled_config_returns_zeros(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(_org({"enabled": False})))
        out = await CertAlertService(db).process_alerts("org-1")
        assert out == {
            "alerts_sent": 0,
            "escalations_sent": 0,
            "in_app_sent": 0,
            "errors": 0,
        }

    async def test_org_missing_returns_zeros(self):
        # get_alert_config sees enabled config, then org lookup returns None.
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(_org({"enabled": True})), _one(None)])
        out = await CertAlertService(db).process_alerts("org-1")
        assert out["in_app_sent"] == 0


class TestTieredAlerts:
    def _db(self, record, member):
        # config org, process org, expiring [record], member, expired []
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(_org({"enabled": True})),
                _one(_org({"enabled": True})),
                _scalars([record] if record else []),
                _one(member),
                _scalars([]),
            ]
        )
        db.commit = AsyncMock()
        return db

    async def test_ninety_day_tier_fires_and_marks_field(self):
        record = _record(90)
        member = _member(email_enabled=False)  # in-app only, simpler path
        out = await CertAlertService(self._db(record, member)).process_alerts("org-1")
        assert out["in_app_sent"] == 1
        assert record.alert_90_sent_at is not None
        assert record.alert_60_sent_at is None

    async def test_already_sent_tier_is_deduped(self):
        # 90 days out, 90-tier already sent; 60-tier not yet applicable (90>60).
        record = _record(90, alert_90_sent_at=datetime.now(timezone.utc))
        member = _member(email_enabled=False)
        out = await CertAlertService(self._db(record, member)).process_alerts("org-1")
        assert out["in_app_sent"] == 0

    async def test_normal_pipeline_fires_30_day_tier(self):
        # Daily-tracked cert: 90/60 already sent, now 30 days out -> the
        # 30-day tier (CCs training officers) is the most urgent applicable
        # unsent tier and fires.
        now = datetime.now(timezone.utc)
        record = _record(30, alert_90_sent_at=now, alert_60_sent_at=now)
        member = _member(email_enabled=False)
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(_org({"enabled": True})),  # config
                _one(_org({"enabled": True})),  # process org
                _scalars([record]),  # expiring
                _one(member),  # member
                _scalars([]),  # training officers (in-app)
                _scalars([]),  # expired
            ]
        )
        db.commit = AsyncMock()
        out = await CertAlertService(db).process_alerts("org-1")
        assert out["in_app_sent"] == 1
        assert record.alert_30_sent_at is not None
        assert record.alert_7_sent_at is None

    async def test_late_added_cert_jumps_to_most_urgent_tier(self):
        # A never-alerted cert 5 days out fires the 7-day tier (most urgent)
        # and suppresses the skipped 90/60/30 tiers so they don't fire
        # backwards on later runs. The 7-tier CCs officers, so the in-app
        # officer lookups (training + compliance) execute.
        record = _record(5)
        member = _member(email_enabled=False)
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(_org({"enabled": True})),  # config
                _one(_org({"enabled": True})),  # process org
                _scalars([record]),  # expiring
                _one(member),  # member
                _scalars([]),  # training officers (in-app)
                _scalars([]),  # compliance officers (in-app)
                _scalars([]),  # expired
            ]
        )
        db.commit = AsyncMock()
        await CertAlertService(db).process_alerts("org-1")
        assert record.alert_7_sent_at is not None
        # Skipped earlier tiers are marked sent (suppressed).
        assert record.alert_90_sent_at is not None
        assert record.alert_30_sent_at is not None


class TestExpiredEscalation:
    async def test_expired_cert_escalates_and_marks(self):
        record = _record(-10)  # expired 10 days ago
        member = _member(email_enabled=False)
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(_org({"enabled": True})),  # config
                _one(_org({"enabled": True})),  # process org
                _scalars([]),  # expiring: none
                _scalars([record]),  # expired
                _one(member),  # member
                _scalars([]),  # escalation officers
                _scalars([]),  # training officer emails
                _scalars([]),  # compliance officer emails
            ]
        )
        db.commit = AsyncMock()
        out = await CertAlertService(db).process_alerts("org-1")
        # No recipients (email disabled, no officers) -> marked processed, no email.
        assert record.escalation_sent_at is not None
        assert out["escalations_sent"] == 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
