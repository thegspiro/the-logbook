"""Migration 2794794bda6e: the one-time status backfill, and its reversal.

Run against a real (SQLite) connection. What matters is the boundary of the
rule: only ``active`` and ``probationary`` move, only between each other,
every change leaves an audit row naming the revision, and the downgrade
restores exactly the rows it wrote — not one an officer has changed since.
"""

import importlib.util
import json
import sqlite3
from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

# Python 3.12 deprecated sqlite3's implicit datetime adapter, which the
# migration relies on when it binds a datetime. Registering the same
# conversion explicitly keeps the stored text identical.
sqlite3.register_adapter(datetime, lambda value: value.isoformat(" "))

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_2794794bda6e_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _migration():
    spec = importlib.util.spec_from_file_location("status_backfill", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("username", sa.String),
        sa.Column("status", sa.String),
        sa.Column("membership_type", sa.String),
        sa.Column("deleted_at", sa.DateTime),
        sa.Column("status_changed_at", sa.DateTime),
        sa.Column("status_change_reason", sa.Text),
    )
    sa.Table(
        "audit_logs",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.DateTime),
        sa.Column("timestamp_nanos", sa.BigInteger),
        sa.Column("event_type", sa.String),
        sa.Column("event_category", sa.String),
        sa.Column("severity", sa.String),
        sa.Column("user_id", sa.String),
        sa.Column("username", sa.String),
        sa.Column("organization_id", sa.String),
        sa.Column("event_data", sa.Text),
        sa.Column("created_at", sa.DateTime),
        sa.Column("chain_seq", sa.BigInteger),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _user(conn, user_id, status, membership_type, deleted=False):
    conn.execute(
        sa.text(
            "INSERT INTO users (id, organization_id, username, status, "
            "membership_type, deleted_at) VALUES (:id, 'org-1', :id, :status, "
            ":type, :deleted)"
        ),
        {
            "id": user_id,
            "status": status,
            "type": membership_type,
            "deleted": datetime(2026, 1, 1) if deleted else None,
        },
    )


def _statuses(engine):
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT id, status, status_change_reason FROM users ORDER BY id")
        ).all()
    return {row[0]: (row[1], row[2]) for row in rows}


def _audit_rows(engine):
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text(
                "SELECT event_type, organization_id, event_data FROM audit_logs ORDER BY id"
            )
        ).all()
    return [(row[0], row[1], json.loads(row[2])) for row in rows]


def _seed(engine):
    with engine.begin() as conn:
        _user(conn, "probie-active", "active", "probationary")
        _user(conn, "regular-probie", "probationary", "active")
        _user(conn, "senior-probie", "probationary", "senior")
        _user(conn, "in-step", "probationary", "probationary")
        _user(conn, "regular", "active", "active")
        _user(conn, "on-leave", "leave", "probationary")
        _user(conn, "retired", "retired", "probationary")
        _user(conn, "deleted", "active", "probationary", deleted=True)


def test_upgrade_moves_only_between_active_and_probationary(engine):
    _seed(engine)
    _run(engine)
    after = _statuses(engine)
    assert after["probie-active"][0] == "probationary"
    assert after["regular-probie"][0] == "active"
    assert after["senior-probie"][0] == "active"
    assert after["in-step"] == ("probationary", None)
    assert after["regular"] == ("active", None)
    assert after["on-leave"] == ("leave", None)
    assert after["retired"] == ("retired", None)
    assert after["deleted"] == ("active", None)
    assert after["probie-active"][1] == "Follows membership type 'probationary'"


def test_every_change_is_logged_with_the_revision(engine):
    _seed(engine)
    _run(engine)
    rows = _audit_rows(engine)
    assert len(rows) == 3
    assert {row[0] for row in rows} == {"account_status_backfilled"}
    assert {row[1] for row in rows} == {"org-1"}
    by_user = {row[2]["target_user_id"]: row[2] for row in rows}
    assert by_user["probie-active"]["previous_status"] == "active"
    assert by_user["probie-active"]["new_status"] == "probationary"
    assert by_user["regular-probie"]["new_status"] == "active"
    assert all(row[2]["revision"] == _migration().revision for row in rows)
    assert all(row[2]["direction"] == "upgrade" for row in rows)


def test_downgrade_restores_what_the_upgrade_wrote_and_nothing_else(engine):
    _seed(engine)
    _run(engine)
    # An officer moved one of the backfilled members on since the upgrade;
    # the downgrade must leave that decision alone.
    with engine.begin() as conn:
        conn.execute(
            sa.text("UPDATE users SET status = 'leave' WHERE id = 'regular-probie'")
        )
    _run(engine, "downgrade")
    after = _statuses(engine)
    assert after["probie-active"][0] == "active"
    assert after["senior-probie"][0] == "probationary"
    assert after["regular-probie"][0] == "leave"
    assert after["probie-active"][1] == "Restored by downgrade of 2794794bda6e"
    # Audit rows are chain members: the upgrade's stay, the reversals are added.
    rows = _audit_rows(engine)
    directions = [row[2]["direction"] for row in rows]
    assert directions.count("upgrade") == 3
    assert directions.count("downgrade") == 2


def test_an_empty_database_is_a_no_op_both_ways(engine):
    _run(engine)
    _run(engine, "downgrade")
    assert _audit_rows(engine) == []


def test_a_database_without_the_tables_is_skipped():
    database = sa.create_engine("sqlite://")
    try:
        _run(database)
        _run(database, "downgrade")
    finally:
        database.dispose()
