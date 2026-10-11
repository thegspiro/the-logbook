"""Migration 990e288940bc: archive the former members the shift import made inactive.

Run against a real (SQLite) connection. What matters is which members it
leaves alone: one a department made inactive by hand, an import record somebody
turned into a login, and one whose status an administrator has changed since.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_990e288940bc_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

IMPORTED_AT = "2026-06-01 12:00:00"
IMPORT_REASON = "Created by shift history import of roster_1998.csv"


def _migration():
    spec = importlib.util.spec_from_file_location("archive_import_members", MATCHES[0])
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
        sa.Column("status", sa.String),
        sa.Column("password_hash", sa.String),
        sa.Column("status_changed_at", sa.String),
        sa.Column("status_change_reason", sa.Text),
        sa.Column("archived_at", sa.String),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _member(
    engine,
    user_id,
    *,
    status="inactive",
    password_hash=None,
    reason=IMPORT_REASON,
):
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO users (id, status, password_hash, status_changed_at, "
                "status_change_reason, archived_at) "
                "VALUES (:id, :status, :password_hash, :changed, :reason, NULL)"
            ),
            {
                "id": user_id,
                "status": status,
                "password_hash": password_hash,
                "changed": IMPORTED_AT,
                "reason": reason,
            },
        )


def _row(engine, user_id):
    with engine.connect() as connection:
        return connection.execute(
            sa.text("SELECT status, archived_at FROM users WHERE id = :id"),
            {"id": user_id},
        ).one()


def test_archives_an_import_record_as_of_its_import(engine):
    _member(engine, "imported")

    _run(engine)

    assert tuple(_row(engine, "imported")) == ("archived", IMPORTED_AT)


def test_leaves_a_member_made_inactive_by_hand(engine):
    _member(engine, "by-hand", reason="Stopped attending")
    _member(engine, "no-reason", reason=None)

    _run(engine)

    assert _row(engine, "by-hand").status == "inactive"
    assert _row(engine, "no-reason").status == "inactive"


def test_leaves_an_import_record_somebody_turned_into_a_login(engine):
    _member(engine, "login", password_hash="$argon2id$hash")

    _run(engine)

    assert _row(engine, "login").status == "inactive"


def test_leaves_an_import_record_whose_status_was_changed_since(engine):
    _member(engine, "reactivated", status="active", reason=IMPORT_REASON)

    _run(engine)

    assert _row(engine, "reactivated").status == "active"


def test_the_prefix_is_not_a_wildcard_pattern(engine):
    _member(engine, "lookalike", reason="Created by shift_history_import of x.csv")

    _run(engine)

    assert _row(engine, "lookalike").status == "inactive"


def test_downgrade_returns_import_records_to_inactive_only(engine):
    _member(engine, "imported")
    _member(engine, "separated", status="archived", reason="Separated")

    _run(engine)
    _run(engine, "downgrade")

    assert tuple(_row(engine, "imported")) == ("inactive", None)
    assert _row(engine, "separated").status == "archived"
