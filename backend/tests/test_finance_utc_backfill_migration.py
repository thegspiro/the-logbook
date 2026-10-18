"""``da76465bc3d2`` converts finance timestamps from the server's zone to UTC.

The database clock stamped ``created_at`` and friends in the MySQL server's
own zone while the application reads every DATETIME as UTC. The migration
corrects rows written before the UTC pin took effect. Pinned here:

* it names only finance tables and only their database-clock columns, and never
  an integrity-protected table such as the audit log;
* over scratch tables in the real test database, old rows move by the zone's
  offset, NULLs stay NULL, rows after the cutoff and TIMESTAMP columns are left
  alone, and the whole of ``updated_at`` is corrected in the same statement so
  a database-level ON UPDATE cannot rewrite it;
* a UTC server, a missing table and an unresolvable zone are each handled
  without touching a row (the last by refusing, not by writing NULLs);
* the downgrade is the exact inverse for the rows it converted.

The DDL cannot ride in the rolled-back ``db_session`` transaction, so each test
points the migration at uniquely prefixed scratch tables and drops them after.
"""

import importlib.util
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import DateTime

from app.core.config import settings
from app.core.database import Base

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261018_1958_da76465bc3d2_finance_timestamps_to_utc.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_finance_utc_backfill", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

# New York in October: local time is four hours behind UTC.
EDT = "-04:00"
# 2026-10-18 03:00 UTC, which is 2026-10-17 23:00 on the server's local clock.
CUTOFF_UTC = "2026-10-18 03:00:00"


@pytest.mark.unit
class TestWhatItTouches:
    def test_every_named_column_is_a_database_clock_column_of_a_model(self):
        for table, columns in MIGRATION.TABLES:
            model_table = Base.metadata.tables[table]
            for name in columns:
                column = model_table.c[name]
                assert isinstance(column.type, DateTime)
                assert column.server_default is not None, f"{table}.{name}"

    def test_the_tables_are_finance_tables_and_never_integrity_protected_ones(self):
        names = {table for table, _columns in MIGRATION.TABLES}

        assert "purchase_requests" in names
        assert not names & {"audit_logs", "audit_log_checkpoints", "elections"}
        assert not any(
            name.startswith(("audit_", "election", "ballot")) for name in names
        )

    def test_identifiers_are_plain_names_so_they_can_be_quoted_safely(self):
        for table, columns in MIGRATION.TABLES:
            for identifier in (table, *columns):
                assert MIGRATION._IDENTIFIER.match(identifier), identifier

    def test_a_table_name_that_is_not_plain_is_refused(self):
        with pytest.raises(ValueError, match="Unexpected identifier"):
            MIGRATION.convert_table(
                None,
                "budgets; DROP TABLE users",
                ("created_at",),
                zone=EDT,
                cutoff=datetime(2026, 1, 1),
                to_utc=True,
            )


@pytest.fixture
def scratch(monkeypatch):
    """The migration aimed at scratch tables of the test's own."""
    prefix = f"m{uuid.uuid4().hex[:6]}_"
    monkeypatch.setattr(
        MIGRATION,
        "TABLES",
        (
            (f"{prefix}purchase_requests", ("created_at", "updated_at")),
            (f"{prefix}fiscal_years", ("created_at",)),
            (f"{prefix}absent_table", ("created_at",)),
        ),
    )
    monkeypatch.setenv(MIGRATION.SOURCE_TZ_ENV, EDT)
    monkeypatch.setenv(MIGRATION.CUTOFF_ENV, CUTOFF_UTC)
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            for table in ("purchase_requests", "fiscal_years", "stamped"):
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{prefix}{table}`")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _build(engine, prefix: str) -> None:
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}purchase_requests (id VARCHAR(36) PRIMARY KEY, "
            "created_at DATETIME NULL, "
            "updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP "
            "ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}fiscal_years (id VARCHAR(36) PRIMARY KEY, "
            "created_at DATETIME NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {prefix}purchase_requests (id, created_at, updated_at) VALUES "
            # Written by the old code in New York time, before the cutoff.
            "('old', '2026-10-17 22:31:00', '2026-10-17 22:35:00'), "
            # Written after the cutoff by code that already stamps UTC.
            "('new', '2026-10-18 05:00:00', '2026-10-18 05:10:00'), "
            "('nulls', NULL, NULL)"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {prefix}fiscal_years VALUES ('fy', '2026-01-15 09:00:00')"
        )
        conn.commit()


def _rows(engine, table: str) -> dict:
    with engine.connect() as conn:
        result = conn.exec_driver_sql(f"SELECT * FROM `{table}`").mappings()
        return {row["id"]: dict(row) for row in result}


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_old_rows_move_to_utc_and_everything_else_stays(self, scratch):
        _build(scratch.engine, scratch.prefix)

        _run(scratch.engine, MIGRATION.upgrade)

        rows = _rows(scratch.engine, f"{scratch.prefix}purchase_requests")
        assert rows["old"]["created_at"] == datetime(2026, 10, 18, 2, 31, 0)
        assert rows["old"]["updated_at"] == datetime(2026, 10, 18, 2, 35, 0)
        # After the cutoff it is already UTC, so it is not shifted a second time.
        assert rows["new"]["created_at"] == datetime(2026, 10, 18, 5, 0, 0)
        assert rows["new"]["updated_at"] == datetime(2026, 10, 18, 5, 10, 0)
        assert rows["nulls"]["created_at"] is None
        assert rows["nulls"]["updated_at"] is None

    def test_updated_at_is_not_rewritten_by_the_databases_on_update_clause(
        self, scratch
    ):
        _build(scratch.engine, scratch.prefix)

        _run(scratch.engine, MIGRATION.upgrade)

        rows = _rows(scratch.engine, f"{scratch.prefix}purchase_requests")
        # Had ON UPDATE fired, this would be the time the test ran, not 02:35.
        assert rows["old"]["updated_at"] == datetime(2026, 10, 18, 2, 35, 0)

    def test_another_table_is_converted_by_the_same_run(self, scratch):
        _build(scratch.engine, scratch.prefix)

        _run(scratch.engine, MIGRATION.upgrade)

        rows = _rows(scratch.engine, f"{scratch.prefix}fiscal_years")
        # The test pins a fixed -04:00, so even a January row moves four hours;
        # the daylight-saving behaviour is pinned by the named-zone test below.
        assert rows["fy"]["created_at"] == datetime(2026, 1, 15, 13, 0, 0)

    def test_the_downgrade_restores_the_rows_the_upgrade_converted(self, scratch):
        _build(scratch.engine, scratch.prefix)
        before = _rows(scratch.engine, f"{scratch.prefix}purchase_requests")

        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.downgrade)

        assert _rows(scratch.engine, f"{scratch.prefix}purchase_requests") == before

    def test_a_utc_server_is_left_exactly_as_it_is(self, scratch, monkeypatch):
        monkeypatch.setenv(MIGRATION.SOURCE_TZ_ENV, "+00:00")
        _build(scratch.engine, scratch.prefix)
        before = _rows(scratch.engine, f"{scratch.prefix}purchase_requests")

        _run(scratch.engine, MIGRATION.upgrade)

        assert _rows(scratch.engine, f"{scratch.prefix}purchase_requests") == before

    def test_an_unresolvable_zone_refuses_and_writes_nothing(
        self, scratch, monkeypatch
    ):
        monkeypatch.setenv(MIGRATION.SOURCE_TZ_ENV, "Not/AZone")
        _build(scratch.engine, scratch.prefix)
        before = _rows(scratch.engine, f"{scratch.prefix}purchase_requests")

        with pytest.raises(RuntimeError, match="Cannot resolve the database time zone"):
            _run(scratch.engine, MIGRATION.upgrade)

        assert _rows(scratch.engine, f"{scratch.prefix}purchase_requests") == before

    def test_a_timestamp_column_is_never_shifted(self, scratch, monkeypatch):
        """TIMESTAMP already stores UTC; converting it again would corrupt it."""
        monkeypatch.setattr(
            MIGRATION, "TABLES", ((f"{scratch.prefix}stamped", ("created_at",)),)
        )
        with scratch.engine.connect() as conn:
            conn.exec_driver_sql(
                f"CREATE TABLE {scratch.prefix}stamped (id VARCHAR(36) PRIMARY KEY, "
                "created_at TIMESTAMP NULL DEFAULT NULL) ENGINE=InnoDB"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {scratch.prefix}stamped VALUES ('t', '2026-10-17 22:31:00')"
            )
            conn.commit()
        before = _rows(scratch.engine, f"{scratch.prefix}stamped")

        _run(scratch.engine, MIGRATION.upgrade)

        assert _rows(scratch.engine, f"{scratch.prefix}stamped") == before

    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        # Nothing built: CI's ``alembic upgrade head`` runs before create_all.
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.downgrade)

    def test_a_cutoff_that_is_not_a_timestamp_is_refused_before_any_change(
        self, scratch, monkeypatch
    ):
        monkeypatch.setenv(MIGRATION.CUTOFF_ENV, "yesterday")
        _build(scratch.engine, scratch.prefix)
        before = _rows(scratch.engine, f"{scratch.prefix}purchase_requests")

        with pytest.raises(ValueError, match=MIGRATION.CUTOFF_ENV):
            _run(scratch.engine, MIGRATION.upgrade)

        assert _rows(scratch.engine, f"{scratch.prefix}purchase_requests") == before

    def test_a_named_zone_applies_daylight_saving_row_by_row(
        self, scratch, monkeypatch
    ):
        """A January row moves five hours and a July row four, in New York."""
        with scratch.engine.connect() as conn:
            probe = conn.exec_driver_sql(
                "SELECT CONVERT_TZ('2026-07-15 12:00:00', 'America/New_York', '+00:00')"
            ).scalar_one()
        if probe is None:
            pytest.skip("the database has no time zone tables loaded")
        monkeypatch.setenv(MIGRATION.SOURCE_TZ_ENV, "America/New_York")
        monkeypatch.setenv(MIGRATION.CUTOFF_ENV, "2027-01-01 00:00:00")
        _build(scratch.engine, scratch.prefix)
        with scratch.engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {scratch.prefix}fiscal_years VALUES "
                "('winter', '2026-01-15 09:00:00'), ('summer', '2026-07-15 09:00:00')"
            )
            conn.commit()

        _run(scratch.engine, MIGRATION.upgrade)

        rows = _rows(scratch.engine, f"{scratch.prefix}fiscal_years")
        assert rows["winter"]["created_at"] == datetime(2026, 1, 15, 14, 0, 0)
        assert rows["summer"]["created_at"] == datetime(2026, 7, 15, 13, 0, 0)

    def test_the_system_zone_is_accepted_by_convert_tz(self, scratch):
        """The default source on a real server is SYSTEM, the host's own zone.

        CI's database host runs in UTC, so the probe must call it UTC; what is
        pinned is that the syntax is accepted (an unsupported zone name would
        come back NULL and raise instead).
        """
        with scratch.engine.connect() as conn:
            system_zone = conn.exec_driver_sql("SELECT @@system_time_zone").scalar_one()
            if system_zone not in ("UTC", "+00:00", "GMT"):
                pytest.skip(f"database host is not on UTC ({system_zone})")

            assert MIGRATION._is_utc(conn, "SYSTEM") is True
