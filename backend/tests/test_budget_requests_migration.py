"""``9effb8790488`` adds ``fiscal_years.request_deadline`` and ``budget_requests``.

Run for real against MySQL/MariaDB — the DDL cannot ride in the rolled-back
``db_session`` transaction, because MySQL commits implicitly around it. CI's
database user may create tables only inside the test database, so each test
points the migration at uniquely prefixed scratch tables there and drops them
afterwards (the pattern of ``test_budget_amendments_migration.py``). Pinned:

* an empty database (CI's ``alembic upgrade head`` before ``create_all``) is
  a no-op both ways — the finance tables are built by no migration;
* ``fiscal_years`` without the rest of the finance tables gets its column and
  no request table (a key to a missing table cannot be created);
* over an installation's tables the column arrives nullable and the table
  with every key — cascade from the organization and the fiscal year, SET
  NULL (and nullable) from everything else — and one index per key column;
  a re-run changes nothing;
* the downgrade drops both and leaves the fiscal years and lines alone;
* the names are the ones ``create_all`` gives the models.
"""

import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings
from app.models.finance import BudgetRequest, FiscalYear

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261008_2016_9effb8790488_budget_requests_and_fiscal_year_request_.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_budget_requests", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

# Columns the model has gained since this revision, each added by a later
# migration that owns its own test; this revision builds the table without them.
_ADDED_BY_LATER_REVISIONS = {
    # 5c8be05f2f0f: senior leadership's review of a decided request.
    "review_amount",
    "review_note",
    "reviewed_by",
    "reviewed_at",
}

_KEYS = {
    "organization_id": ("organizations", "CASCADE", "FK_ORGANIZATION"),
    "fiscal_year_id": ("fiscal_years", "CASCADE", "FK_FISCAL_YEAR"),
    "budget_id": ("budgets", "SET NULL", "FK_BUDGET"),
    "category_id": ("budget_categories", "SET NULL", "FK_CATEGORY"),
    "station_id": ("facilities", "SET NULL", "FK_STATION"),
    "owner_position_id": ("positions", "SET NULL", "FK_OWNER_POSITION"),
    "submitted_by": ("users", "SET NULL", "FK_SUBMITTED_BY"),
    "decided_by": ("users", "SET NULL", "FK_DECIDED_BY"),
}

_TABLE_NAMES = (
    "TABLE",
    "FISCAL_YEARS",
    "BUDGETS",
    "CATEGORIES",
    "FACILITIES",
    "POSITIONS",
    "ORGANIZATIONS",
    "USERS",
)
_CONSTRAINT_NAMES = tuple(v[2] for v in _KEYS.values()) + (
    "IX_ORGANIZATION",
    "IX_FISCAL_YEAR",
    "IX_BUDGET",
    "IX_OWNER_POSITION",
)
_REFERENCED = (
    "organizations",
    "users",
    "positions",
    "facilities",
    "budget_categories",
    "fiscal_years",
    "budgets",
)


@pytest.mark.unit
class TestNamesMatchTheModel:
    def test_table_key_and_index_names_are_create_alls(self):
        table = BudgetRequest.__table__
        assert MIGRATION.TABLE == table.name
        for column, (referred, ondelete, attr) in _KEYS.items():
            (foreign_key,) = table.c[column].foreign_keys
            assert foreign_key.constraint.name == getattr(MIGRATION, attr)
            assert foreign_key.column.table.name == referred
            assert foreign_key.ondelete == ondelete
            # CLAUDE.md pitfall #2: SET NULL needs a nullable column.
            assert table.c[column].nullable is (ondelete == "SET NULL")
        assert {index.name for index in table.indexes} == {
            MIGRATION.IX_ORGANIZATION,
            MIGRATION.IX_FISCAL_YEAR,
            MIGRATION.IX_BUDGET,
            MIGRATION.IX_OWNER_POSITION,
        }
        statuses = tuple(table.c.status.type.enums)
        assert statuses == MIGRATION.STATUSES

    def test_the_deadline_column_is_a_nullable_date(self):
        column = FiscalYear.__table__.c[MIGRATION.DEADLINE]
        assert isinstance(column.type, sa.Date)
        assert column.nullable is True


@pytest.fixture
def scratch(monkeypatch):
    """The migration aimed at scratch tables of the test's own."""
    prefix = f"r{uuid.uuid4().hex[:6]}_"
    for attr in _TABLE_NAMES + _CONSTRAINT_NAMES:
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for table in ("budget_requests",) + _REFERENCED:
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{prefix}{table}`")
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _tables(engine, prefix: str) -> list:
    with engine.connect() as conn:
        return [t for t in sa.inspect(conn).get_table_names() if t.startswith(prefix)]


def _columns(engine, table: str) -> dict:
    with engine.connect() as conn:
        return {c["name"]: c for c in sa.inspect(conn).get_columns(table)}


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _build(engine, prefix: str, tables=_REFERENCED) -> None:
    """The referenced tables as an installation has them before this revision."""
    with engine.connect() as conn:
        for table in tables:
            extra = ", status VARCHAR(20)" if table == "fiscal_years" else ""
            conn.exec_driver_sql(
                f"CREATE TABLE {prefix}{table} (id VARCHAR(36) PRIMARY KEY{extra}) "
                "ENGINE=InnoDB"
            )
        for table in tables:
            if table == "fiscal_years":
                conn.exec_driver_sql(
                    f"INSERT INTO {prefix}{table} VALUES ('x-1', 'draft')"
                )
            else:
                conn.exec_driver_sql(f"INSERT INTO {prefix}{table} VALUES ('x-1')")
        conn.commit()


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        _run(scratch.engine, MIGRATION.upgrade)
        assert _tables(scratch.engine, scratch.prefix) == []
        _run(scratch.engine, MIGRATION.downgrade)
        assert _tables(scratch.engine, scratch.prefix) == []

    def test_fiscal_years_alone_gets_the_column_and_no_table(self, scratch):
        p = scratch.prefix
        _build(scratch.engine, p, tables=("fiscal_years",))
        _run(scratch.engine, MIGRATION.upgrade)
        assert _tables(scratch.engine, p) == [f"{p}fiscal_years"]
        assert "request_deadline" in _columns(scratch.engine, f"{p}fiscal_years")
        _run(scratch.engine, MIGRATION.downgrade)
        assert "request_deadline" not in _columns(scratch.engine, f"{p}fiscal_years")

    def test_upgrade_over_existing_tables_then_downgrade(self, scratch):
        engine = scratch.engine
        p = scratch.prefix
        table = f"{p}budget_requests"
        _build(engine, p)

        for _ in range(2):  # the second run must change nothing
            _run(engine, MIGRATION.upgrade)
            deadline = _columns(engine, f"{p}fiscal_years")["request_deadline"]
            assert deadline["nullable"] is True
            assert isinstance(deadline["type"], sa.Date)
            with engine.connect() as conn:
                inspector = sa.inspect(conn)
                columns = {c["name"]: c for c in inspector.get_columns(table)}
                keys = {
                    fk["constrained_columns"][0]: fk
                    for fk in inspector.get_foreign_keys(table)
                }
                indexed = sorted(
                    i["column_names"][0] for i in inspector.get_indexes(table)
                )
            assert (
                set(columns)
                == {c.name for c in BudgetRequest.__table__.columns}
                - _ADDED_BY_LATER_REVISIONS
            )
            for column, (referred, ondelete, _attr) in _KEYS.items():
                assert keys[column]["referred_table"] == f"{p}{referred}"
                assert keys[column]["options"].get("ondelete") == ondelete
                assert columns[column]["nullable"] is (ondelete == "SET NULL")
            assert columns["requested_amount"]["nullable"] is False
            assert columns["justification"]["nullable"] is False
            # One index per key column (MySQL keeps its own for the keys the
            # migration does not index by name, as create_all leaves them).
            assert indexed == sorted(_KEYS)

        with engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {table} (id, organization_id, fiscal_year_id, "
                "budget_id, category_id, station_id, owner_position_id, "
                "requested_amount, justification, status, submitted_by) VALUES "
                "('br-1', 'x-1', 'x-1', 'x-1', 'x-1', 'x-1', 'x-1', 10.00, 'j', "
                "'submitted', 'x-1')"
            )
            # Losing the line, position or member keeps the request.
            for referenced in ("budgets", "positions", "users"):
                conn.exec_driver_sql(f"DELETE FROM {p}{referenced}")
            row = conn.exec_driver_sql(
                f"SELECT budget_id, owner_position_id, submitted_by FROM {table}"
            ).one()
            assert tuple(row) == (None, None, None)
            # Deleting the fiscal year takes its requests with it.
            conn.exec_driver_sql(f"DELETE FROM {p}fiscal_years")
            assert conn.exec_driver_sql(f"SELECT COUNT(*) FROM {table}").scalar() == 0
            conn.commit()

        _run(engine, MIGRATION.downgrade)
        assert sorted(_tables(engine, p)) == sorted(f"{p}{t}" for t in _REFERENCED)
        assert "request_deadline" not in _columns(engine, f"{p}fiscal_years")
        # And a second downgrade has nothing left to do.
        _run(engine, MIGRATION.downgrade)
