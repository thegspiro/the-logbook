"""``0961ffc2cdf1`` keeps a display-only reference from a reversal to its target.

Run for real against MySQL/MariaDB, on uniquely prefixed scratch tables (the
shape of ``test_budget_amendment_reversals_migration.py``): DDL commits
implicitly, so it cannot ride in the rolled-back ``db_session``. Pinned, with
rows present (CLAUDE.md pitfall #35):

* an empty database is a no-op both ways;
* a reversal still linked gets its link copied into the reference;
* a reversal whose link a rejection cleared gets it back from the audit log --
  but only when the named amendment is on the same line; a foreign id, an
  unknown id, or an event about a positive row fills nothing;
* ordinary amendments stay NULL; a re-run changes nothing;
* the downgrade drops the column and keeps every row;
* the column is the model's: nullable, with no foreign or unique key.
"""

import importlib.util
import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings
from app.models.finance import BudgetAmendment

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261106_0432_0961ffc2cdf1_budget_amendment_reversal_display_.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_amendment_reversal_ref", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
class TestTheColumnIsTheModels:
    def test_nullable_with_no_keys(self):
        table = BudgetAmendment.__table__
        assert MIGRATION.TABLE == table.name
        column = table.c[MIGRATION.COLUMN]
        assert column.nullable is True
        assert not column.foreign_keys
        assert not column.unique
        assert isinstance(column.type, sa.String)
        assert column.type.length == 36


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"x{uuid.uuid4().hex[:6]}_"
    monkeypatch.setattr(MIGRATION, "TABLE", f"{prefix}budget_amendments")
    monkeypatch.setattr(MIGRATION, "AUDIT", f"{prefix}audit_logs")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            for table in ("budget_amendments", "audit_logs"):
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{prefix}{table}`")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _event(event_type: str, **data) -> tuple:
    return (event_type, json.dumps(data))


def _build_existing(engine, prefix: str) -> None:
    """``budget_amendments`` as ``0a55dae43a0a`` left it, with every kind of row."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}budget_amendments ("
            "id VARCHAR(36) PRIMARY KEY, budget_id VARCHAR(36) NOT NULL, "
            "amount NUMERIC(12, 2) NOT NULL, "
            "reverses_amendment_id VARCHAR(36) NULL, "
            "status VARCHAR(20) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {prefix}budget_amendments VALUES "
            # Line b-1: two amendments, a linked reversal, a rejected one.
            "('am-1', 'b-1', 2500.00, NULL, 'confirmed'), "
            "('am-2', 'b-1', 250.00, NULL, 'confirmed'), "
            "('rev-linked', 'b-1', -250.00, 'am-2', 'pending'), "
            "('rev-rejected', 'b-1', -2500.00, NULL, 'rejected'), "
            # Its audit event names an amendment on another line.
            "('rev-foreign', 'b-1', -10.00, NULL, 'rejected'), "
            # No audit event at all.
            "('rev-unknown', 'b-1', -5.00, NULL, 'rejected'), "
            # Line b-2.
            "('am-3', 'b-2', 10.00, NULL, 'confirmed')"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}audit_logs (id INT AUTO_INCREMENT PRIMARY KEY, "
            # LONGTEXT, not JSON, so a malformed row can be stored: the
            # migration must skip one rather than fail on it.
            "event_type VARCHAR(100) NOT NULL, event_data LONGTEXT NOT NULL) "
            "ENGINE=InnoDB"
        )
        events = [
            _event(
                "finance.budget_amendment_reversed",
                amendment_id="rev-rejected",
                reversed_amendment_id="am-1",
            ),
            _event(
                "finance.budget_amendment_rejected",
                amendment_id="rev-rejected",
                reversed_amendment_id="am-1",
            ),
            _event(
                "finance.budget_amendment_rejected",
                amendment_id="rev-foreign",
                reversed_amendment_id="am-3",
            ),
            # A positive row is never a reversal, whatever an event says.
            _event(
                "finance.budget_amendment_reversed",
                amendment_id="am-2",
                reversed_amendment_id="am-1",
            ),
            _event("finance.budget_amended", amendment_id="am-1"),
            ("finance.budget_amendment_rejected", "not json"),
        ]
        for event_type, data in events:
            conn.execute(
                sa.text(
                    f"INSERT INTO {prefix}audit_logs (event_type, event_data) "
                    "VALUES (:t, :d)"
                ),
                {"t": event_type, "d": data},
            )
        conn.commit()


def _refs(engine, table: str) -> dict:
    with engine.connect() as conn:
        return dict(
            conn.exec_driver_sql(
                f"SELECT id, reverses_amendment_ref FROM {table}"
            ).fetchall()
        )


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.downgrade)
        with scratch.engine.connect() as conn:
            assert not [
                t
                for t in sa.inspect(conn).get_table_names()
                if t.startswith(scratch.prefix)
            ]

    def test_existing_rows_are_settled_then_kept_on_downgrade(self, scratch):
        engine = scratch.engine
        table = f"{scratch.prefix}budget_amendments"
        _build_existing(engine, scratch.prefix)

        expected = {
            "am-1": None,
            "am-2": None,
            "rev-linked": "am-2",
            "rev-rejected": "am-1",
            "rev-foreign": None,
            "rev-unknown": None,
            "am-3": None,
        }
        for _ in range(2):  # the second run must change nothing
            _run(engine, MIGRATION.upgrade)
            assert _refs(engine, table) == expected
        with engine.connect() as conn:
            column = {c["name"]: c for c in sa.inspect(conn).get_columns(table)}[
                "reverses_amendment_ref"
            ]
            assert column["nullable"] is True

        _run(engine, MIGRATION.downgrade)
        with engine.connect() as conn:
            columns = {c["name"] for c in sa.inspect(conn).get_columns(table)}
            count = conn.exec_driver_sql(f"SELECT COUNT(*) FROM {table}").scalar()
        assert "reverses_amendment_ref" not in columns
        assert count == 7

    def test_without_an_audit_table_the_linked_rows_are_still_settled(
        self, scratch, monkeypatch
    ):
        engine = scratch.engine
        _build_existing(engine, scratch.prefix)
        monkeypatch.setattr(MIGRATION, "AUDIT", f"{scratch.prefix}no_such_table")
        _run(engine, MIGRATION.upgrade)
        refs = _refs(engine, f"{scratch.prefix}budget_amendments")
        assert refs["rev-linked"] == "am-2"
        assert refs["rev-rejected"] is None
