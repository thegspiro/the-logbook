"""
Tests for the notifications service (app/services/notifications_service.py).

Focus (NOTIF-2): the service must not leak raw exception text (SQL, driver
internals) back to the caller — it routes failures through safe_error_detail,
which returns a generic message for non-validation exceptions and logs the real
error. DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

from app.core.utils import _GENERIC_ERROR
from app.models.notification import NotificationRule, NotificationTrigger
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


class TestUpdateRule:
    """update_rule must route through apply_updates so an explicit null
    actually clears an optional field (previously the endpoint used
    model_dump(exclude_none=True), which dropped the null before the service
    ever saw it, so PATCH .../rules/{id} with description=null returned 200
    while silently leaving the old description in place)."""

    def _db_with(self, rule):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=rule))
        )
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.rollback = AsyncMock()
        return db

    async def test_clears_an_explicit_null_field(self):
        rule = NotificationRule(
            id="r1",
            organization_id="org-1",
            name="Reminder",
            description="old description",
            trigger=NotificationTrigger.EVENT_REMINDER,
        )
        db = self._db_with(rule)
        result, err = await NotificationsService(db).update_rule(
            "r1", "org-1", {"description": None}
        )
        assert err is None
        assert result.description is None

    async def test_rejects_null_against_not_null_name(self):
        rule = NotificationRule(
            id="r1",
            organization_id="org-1",
            name="Reminder",
            trigger=NotificationTrigger.EVENT_REMINDER,
        )
        db = self._db_with(rule)
        result, err = await NotificationsService(db).update_rule(
            "r1", "org-1", {"name": None}
        )
        assert result is None
        assert err is not None
        db.rollback.assert_awaited_once()


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


def _db_with_savepoint(execute_result=None, execute_error=None):
    """Mock session whose begin_nested() yields an async-context SAVEPOINT."""
    db = MagicMock()
    nested = MagicMock()
    # __aexit__ must return False so an exception raised inside the SAVEPOINT
    # block propagates to the service's except clause (as it does for real).
    nested.__aexit__.return_value = False
    db.begin_nested = MagicMock(return_value=nested)
    if execute_error is not None:
        db.execute = AsyncMock(side_effect=execute_error)
    else:
        db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db, nested


class TestRelatedActionArchiving:
    async def test_archives_only_notification_for_completed_resource(self):
        db, nested = _db_with_savepoint(execute_result=MagicMock(rowcount=1))

        count = await NotificationsService(db).archive_related_notifications(
            "org-1", "event_validation", "event_id", "event-1"
        )

        assert count == 1
        statement = db.execute.await_args.args[0]
        compiled = str(statement.compile(compile_kwargs={"literal_binds": True}))
        assert "UPDATE notification_logs" in compiled
        assert "event_validation" in compiled
        assert "event_id" in compiled
        assert "event-1" in compiled
        db.begin_nested.assert_called_once()
        db.commit.assert_awaited_once()
        db.rollback.assert_not_awaited()

    async def test_no_match_is_idempotent_without_a_commit(self):
        db, _ = _db_with_savepoint(execute_result=MagicMock(rowcount=0))

        count = await NotificationsService(db).archive_related_notifications(
            "org-1", "shift_validation", "shift_id", "shift-1"
        )

        assert count == 0
        db.commit.assert_not_awaited()

    async def test_failure_rolls_back_savepoint_not_the_callers_session(self):
        """PR #1442 review: a failed archival must not rollback() the shared
        session — that silently discards the caller's staged-but-uncommitted
        work (e.g. a just-flushed audit record). The failure is contained to
        the SAVEPOINT (its __aexit__), and session.rollback is never called."""
        db, nested = _db_with_savepoint(execute_error=Exception("boom"))

        count = await NotificationsService(db).archive_related_notifications(
            "org-1", "shift_validation", "shift_id", "shift-1"
        )

        assert count == 0
        db.rollback.assert_not_awaited()
        db.commit.assert_not_awaited()
        # The exception traveled through the SAVEPOINT context manager, which
        # is what rolls back to the savepoint in a real session.
        nested.__aexit__.assert_awaited_once()
        assert nested.__aexit__.await_args.args[0] is Exception

    async def test_commit_failure_is_contained_and_resets_session(self):
        db, _ = _db_with_savepoint(execute_result=MagicMock(rowcount=1))
        db.commit = AsyncMock(side_effect=Exception("deadlock"))

        count = await NotificationsService(db).archive_related_notifications(
            "org-1", "event_validation", "event_id", "event-1"
        )

        # Never raises to the caller; rollback here only resets the session
        # after the commit itself already failed.
        assert count == 0
        db.rollback.assert_awaited_once()
