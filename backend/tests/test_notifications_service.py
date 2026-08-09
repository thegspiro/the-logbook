"""
Tests for the notifications service (app/services/notifications_service.py).

Focus (NOTIF-2): the service must not leak raw exception text (SQL, driver
internals) back to the caller — it routes failures through safe_error_detail,
which returns a generic message for non-validation exceptions and logs the real
error. DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

from app.core.utils import _GENERIC_ERROR
from app.services.notifications_service import NotificationsService


def _svc_with_failing_commit(raised: Exception):
    db = MagicMock()
    db.add = MagicMock()
    db.delete = MagicMock()
    db.commit = AsyncMock(side_effect=raised)
    db.rollback = AsyncMock()
    return NotificationsService(db), db


class TestErrorSanitization:
    """NOTIF-2: raw DB exception text is never returned to the client."""

    _RAW_DB_ERROR = (
        "(pymysql.err.OperationalError) INSERT INTO notification_rules "
        "(id, name) VALUES (%s, %s) — Unknown column 'foo' in 'field list'"
    )

    async def test_create_rule_sanitizes_db_error(self):
        svc, db = _svc_with_failing_commit(Exception(self._RAW_DB_ERROR))
        rule, err = await svc.create_rule(
            "org1", {"name": "x", "trigger": "t"}, "user1"
        )
        assert rule is None
        assert err == _GENERIC_ERROR
        assert "INSERT INTO" not in err
        db.rollback.assert_awaited_once()

    async def test_log_notification_sanitizes_db_error(self):
        svc, _ = _svc_with_failing_commit(Exception(self._RAW_DB_ERROR))
        log, err = await svc.log_notification("org1", {"channel": "in_app"})
        assert log is None
        assert err == _GENERIC_ERROR
        assert "notification_rules" not in err


class TestNotificationLogEagerRelationships:
    """BXC-2 reliability: NotificationLogResponse serializes the rule_name and
    recipient_name properties, which read self.rule / self.recipient. Both
    relationships must be eager (lazy='joined') — otherwise a log whose rule
    wasn't loaded triggers a lazy load during async serialization and raises
    MissingGreenlet (a 500 on the logs list). MissingGreenlet needs a real DB to
    reproduce, so this guards the load strategy directly."""

    def test_rule_and_recipient_are_eager(self):
        from app.models.notification import NotificationLog

        mapper = NotificationLog.__mapper__
        assert mapper.relationships["rule"].lazy == "joined"
        assert mapper.relationships["recipient"].lazy == "joined"
