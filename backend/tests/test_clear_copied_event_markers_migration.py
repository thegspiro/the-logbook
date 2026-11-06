"""Migration f4583df5025b: lifecycle markers a series save copied are cleared.

Before 2026-10-04 a "This and all future events" save wrote the edited
occurrence's ``reminders_sent`` and ``validation_notification_sent`` onto every
later occurrence, which then skipped the reminder or post-event prompt the copy
claimed was already sent. The migration removes a marker only where the row's
own schedule says the scheduled task cannot have written it, and only where no
such notice was ever delivered for that occurrence — a reminder must not go out
twice (CLAUDE.md Pitfall #36).

Run with rows present (Pitfall #35), on SQLite for speed and on the real
MariaDB/MySQL for the dialect that ships.
"""

import importlib.util
import json
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from sqlalchemy import text

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_f4583df5025b_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

_PREFIX = "zz_ccm_"


def _migration():
    spec = importlib.util.spec_from_file_location("clear_markers", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._EVENTS = _PREFIX + "events"
    module._ORGS = _PREFIX + "organizations"
    module._LOGS = _PREFIX + "notification_logs"
    return module


UTC = timezone.utc


@pytest.mark.unit
class TestThresholdMirrorsTheReminderTask:
    """The threshold is the moment ``run_event_reminders`` would first send an
    interval, computed the same way."""

    def test_sub_day_interval_is_exactly_that_many_hours_before(self):
        start = datetime(2026, 11, 20, 18, 0, tzinfo=UTC)
        got = _migration()._threshold(start, 2, ZoneInfo("UTC"), time(12, 0))
        assert got == datetime(2026, 11, 20, 16, 0, tzinfo=UTC)

    def test_day_interval_fires_at_the_department_reminder_time(self):
        # 09:00 on the 20th in New York is 14:00 UTC; one day before, at the
        # department's 18:30 local, is 23:30 UTC on the 19th.
        start = datetime(2026, 11, 20, 14, 0, tzinfo=UTC)
        got = _migration()._threshold(
            start, 24, ZoneInfo("America/New_York"), time(18, 30)
        )
        assert got == datetime(2026, 11, 19, 23, 30, tzinfo=UTC)

    def test_the_local_date_decides_the_day(self):
        # 01:00 UTC on the 21st is still the 20th in New York, so "one day
        # before" is the 19th there.
        start = datetime(2026, 11, 21, 1, 0, tzinfo=UTC)
        got = _migration()._threshold(
            start, 24, ZoneInfo("America/New_York"), time(12, 0)
        )
        assert got == datetime(2026, 11, 19, 17, 0, tzinfo=UTC)

    def test_a_naive_start_is_utc(self):
        got = _migration()._threshold(
            datetime(2026, 11, 20, 18, 0), 1, ZoneInfo("UTC"), time(12, 0)
        )
        assert got == datetime(2026, 11, 20, 17, 0, tzinfo=UTC)

    def test_org_settings_are_read_like_the_task_reads_them(self):
        module = _migration()
        tz, at = module._org_schedule(
            "Europe/London",
            json.dumps({"events": {"defaults": {"default_reminder_time": "07:15"}}}),
        )
        assert (tz, at) == (ZoneInfo("Europe/London"), time(7, 15))
        assert module._org_schedule(None, None) == (
            ZoneInfo("America/New_York"),
            time(12, 0),
        )
        assert module._org_schedule("Not/AZone", "{not json") == (
            ZoneInfo("America/New_York"),
            time(12, 0),
        )


def _fmt(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%d %H:%M:%S")


def _create(engine, rows, logs):
    p = _PREFIX
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {p}organizations (id VARCHAR(36) PRIMARY KEY, "
                "timezone VARCHAR(50), settings TEXT)"
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {p}events (id VARCHAR(36) PRIMARY KEY, "
                "organization_id VARCHAR(36) NOT NULL, "
                "start_datetime DATETIME NOT NULL, end_datetime DATETIME NOT NULL, "
                "is_recurring BOOLEAN NOT NULL DEFAULT 0, "
                "recurrence_parent_id VARCHAR(36), custom_fields TEXT)"
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {p}notification_logs (id VARCHAR(36) PRIMARY KEY, "
                "category VARCHAR(50), action_url VARCHAR(500))"
            )
        )
        conn.execute(text(f"INSERT INTO {p}organizations VALUES ('org', 'UTC', NULL)"))
        for row in rows:
            conn.execute(
                text(
                    f"INSERT INTO {p}events VALUES "
                    "(:id, 'org', :start, :end, :rec, :parent, :custom)"
                ),
                row,
            )
        for i, (category, url) in enumerate(logs):
            conn.execute(
                text(f"INSERT INTO {p}notification_logs VALUES (:id, :c, :u)"),
                {"id": f"log-{i}", "c": category, "u": url},
            )


def _drop(engine):
    with engine.begin() as conn:
        for name in ("events", "organizations", "notification_logs"):
            conn.execute(text(f"DROP TABLE IF EXISTS {_PREFIX}{name}"))


def _run(engine, step):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _custom(engine) -> dict:
    with engine.begin() as conn:
        result = conn.execute(text(f"SELECT id, custom_fields FROM {_PREFIX}events"))
        return {r.id: _loads(r.custom_fields) for r in result.fetchall()}


def _loads(raw):
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return raw


def _fixture_rows():
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)

    def row(key, start_in, *, custom, parent="parent", recurring=0, hours=1):
        start = now + start_in
        return {
            "id": key,
            "start": _fmt(start),
            "end": _fmt(start + timedelta(hours=hours)),
            "rec": recurring,
            "parent": parent,
            "custom": custom if isinstance(custom, str) else json.dumps(custom),
        }

    rows = [
        # Ten days out: neither interval nor the post-event prompt can be due.
        row(
            "copied",
            timedelta(days=10),
            custom={
                "reminders_sent": [24, 168],
                "validation_notification_sent": True,
                "organizer_note": "keep me",
            },
        ),
        # Three days out: the week-ahead reminder was due, the day-ahead not.
        row("partly_due", timedelta(days=3), custom={"reminders_sent": [24, 168]}),
        # Five hours out: the day-ahead was due, the one-hour-ahead not.
        row("sub_day", timedelta(hours=5), custom={"reminders_sent": [1, 24]}),
        # Over: every marker could be genuine.
        row(
            "past",
            timedelta(days=-2),
            custom={"reminders_sent": [24], "validation_notification_sent": True},
        ),
        # Not part of a series, so no series save ever reached it.
        row(
            "standalone",
            timedelta(days=10),
            parent=None,
            custom={"reminders_sent": [24], "validation_notification_sent": True},
        ),
        # A series parent carries is_recurring rather than a parent id.
        row(
            "series_parent",
            timedelta(days=10),
            parent=None,
            recurring=1,
            custom={"reminders_sent": [24]},
        ),
        # A reminder really went out for this occurrence (under an earlier
        # schedule), so its markers are not provably copies.
        row("reminded", timedelta(days=10), custom={"reminders_sent": [24]}),
        row(
            "prompted",
            timedelta(days=10),
            custom={"validation_notification_sent": True},
        ),
        # Running now: started, not ended. Reminders all due; prompt not.
        row(
            "running",
            timedelta(hours=-1),
            hours=3,
            custom={"reminders_sent": [24], "validation_notification_sent": True},
        ),
        row(
            "odd_values",
            timedelta(days=10),
            custom={"reminders_sent": ["x", None, 24]},
        ),
        row("unparseable", timedelta(days=10), custom="{not json"),
        row("no_markers", timedelta(days=10), custom={"organizer_note": "n"}),
    ]
    logs = [
        ("event_reminder", "/events/reminded"),
        ("event_validation", "https://example.org/events/prompted"),
        # A notice of another kind, or for another event, proves nothing.
        ("event_validation", "/events/partly_due"),
        ("event_reminder", "/events/copied-but-not-this-one"),
    ]
    return rows, logs


EXPECTED = {
    "copied": {"organizer_note": "keep me"},
    "partly_due": {"reminders_sent": [168]},
    "sub_day": {"reminders_sent": [24]},
    "past": {"reminders_sent": [24], "validation_notification_sent": True},
    "standalone": {"reminders_sent": [24], "validation_notification_sent": True},
    "series_parent": {},
    "reminded": {"reminders_sent": [24]},
    "prompted": {"validation_notification_sent": True},
    "running": {"reminders_sent": [24]},
    "odd_values": {"reminders_sent": ["x", None]},
    "no_markers": {"organizer_note": "n"},
}


@pytest.fixture
def sqlite_engine():
    engine = sa.create_engine("sqlite://")
    yield engine
    engine.dispose()


@pytest.fixture
def mysql_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    _drop(engine)
    yield engine
    _drop(engine)
    engine.dispose()


def _assert_against_rows(engine):
    rows, logs = _fixture_rows()
    _create(engine, rows, logs)
    _run(engine, "upgrade")
    got = _custom(engine)
    for key, expected in EXPECTED.items():
        assert got[key] == expected, key
    # Left exactly as stored rather than rewritten or raising.
    with engine.begin() as conn:
        raw = conn.execute(
            text(f"SELECT custom_fields FROM {_PREFIX}events WHERE id = 'unparseable'")
        ).scalar()
    assert raw == "{not json"

    # Idempotent: a second run finds nothing more to clear.
    _run(engine, "upgrade")
    assert _custom(engine) == got

    # Irreversible by design: downgrade leaves the cleared rows as they are.
    _run(engine, "downgrade")
    assert _custom(engine) == got


@pytest.mark.unit
class TestAgainstRowsOnSqlite:
    def test_copied_markers_go_and_genuine_ones_stay(self, sqlite_engine):
        _assert_against_rows(sqlite_engine)

    def test_missing_tables_are_skipped(self, sqlite_engine):
        _run(sqlite_engine, "upgrade")
        assert sa.inspect(sqlite_engine).get_table_names() == []


@pytest.mark.integration
class TestAgainstRowsOnMysql:
    def test_copied_markers_go_and_genuine_ones_stay(self, mysql_engine):
        _assert_against_rows(mysql_engine)
