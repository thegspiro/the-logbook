"""``e016062a4127`` makes a request's preferred dates calendar dates.

Run for real against MySQL/MariaDB on uniquely named scratch tables, as the
other migration tests here do (DDL commits implicitly). Pinned:

* an empty database is a no-op both ways (pitfall #26);
* over rows (pitfall #35), every value lands on the day the requester picked:
  a midnight value keeps its date whatever the department's zone, and any
  other value is read as UTC and converted to the department's calendar —
  including across midnight, and with an unknown zone read as UTC;
* a re-run changes nothing, and the downgrade returns midnight DATETIMEs.
"""

import importlib.util
import uuid
from datetime import date, datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings
from app.models.event_request import EventRequest

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261121_0230_e016062a4127_event_request_dates_are_calendar_dates.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_calendar_dates", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
def test_the_model_declares_calendar_dates():
    table = EventRequest.__table__
    assert MIGRATION.TABLE == table.name
    for column in MIGRATION.COLUMNS:
        assert isinstance(table.c[column].type, sa.Date)
        assert not isinstance(table.c[column].type, sa.DateTime)


@pytest.fixture
def scratch(monkeypatch):
    suffix = uuid.uuid4().hex[:6]
    table = f"r{suffix}_event_requests"
    orgs = f"r{suffix}_organizations"
    monkeypatch.setattr(MIGRATION, "TABLE", table)
    monkeypatch.setattr(MIGRATION, "ORG_TABLE", orgs)
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield engine, table, orgs
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{table}`")
            conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{orgs}`")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _build(engine, table, orgs) -> None:
    """The tables as an installation has them before this revision, with rows."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE `{orgs}` (id VARCHAR(36) PRIMARY KEY, "
            "timezone VARCHAR(50) NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO `{orgs}` VALUES ('chicago', 'America/Chicago'), "
            "('tokyo', 'Asia/Tokyo'), ('nonsense', 'Mars/Olympus')"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE `{table}` (id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL, "
            "preferred_date_start DATETIME NULL, "
            "preferred_date_end DATETIME NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO `{table}` VALUES "
            # The public form: the chosen day at midnight, whatever the zone.
            "('form', 'chicago', '2027-01-15 00:00:00', '2027-01-29 00:00:00'), "
            "('form-east', 'tokyo', '2027-01-15 00:00:00', NULL), "
            # Department midnight in UTC, as a staff entry wrote it.
            "('staff', 'chicago', '2026-12-01 06:00:00', '2026-12-05 06:00:00'), "
            # 03:00 UTC is still the previous evening in Chicago.
            "('late', 'chicago', '2026-12-02 03:00:00', NULL), "
            # 15:00 UTC on the 14th is already the 15th in Tokyo.
            "('tokyo', 'tokyo', '2027-01-14 15:00:00', NULL), "
            "('bad-zone', 'nonsense', '2027-03-01 05:00:00', NULL), "
            "('none', 'chicago', NULL, NULL)"
        )
        conn.commit()


def _rows(engine, table) -> dict:
    with engine.connect() as conn:
        result = conn.exec_driver_sql(
            f"SELECT id, preferred_date_start, preferred_date_end FROM `{table}`"
        )
        return {row.id: (row[1], row[2]) for row in result}


def _type(engine, table, column) -> str:
    with engine.connect() as conn:
        for c in sa.inspect(conn).get_columns(table):
            if c["name"] == column:
                return str(c["type"]).lower()
    raise AssertionError(column)


_AFTER = {
    "form": (date(2027, 1, 15), date(2027, 1, 29)),
    "form-east": (date(2027, 1, 15), None),
    "staff": (date(2026, 12, 1), date(2026, 12, 5)),
    "late": (date(2026, 12, 1), None),
    "tokyo": (date(2027, 1, 15), None),
    "bad-zone": (date(2027, 3, 1), None),
    "none": (None, None),
}


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        engine, table, _orgs = scratch
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
        with engine.connect() as conn:
            assert table not in sa.inspect(conn).get_table_names()

    def test_every_value_lands_on_the_day_the_requester_picked(self, scratch):
        engine, table, orgs = scratch
        _build(engine, table, orgs)

        _run(engine, MIGRATION.upgrade)
        assert _type(engine, table, "preferred_date_start") == "date"
        assert _type(engine, table, "preferred_date_end") == "date"
        assert _rows(engine, table) == _AFTER

        _run(engine, MIGRATION.upgrade)
        assert _rows(engine, table) == _AFTER

    def test_the_downgrade_returns_midnight_datetimes(self, scratch):
        engine, table, orgs = scratch
        _build(engine, table, orgs)
        _run(engine, MIGRATION.upgrade)

        _run(engine, MIGRATION.downgrade)
        assert _type(engine, table, "preferred_date_start") == "datetime"
        rows = _rows(engine, table)
        assert rows["late"] == (datetime(2026, 12, 1), None)
        assert rows["form"] == (datetime(2027, 1, 15), datetime(2027, 1, 29))

        _run(engine, MIGRATION.downgrade)
        assert _rows(engine, table) == rows
