"""``67ad01c43434`` creates ``member_position_terms`` and seeds it.

Run for real against MySQL/MariaDB, on uniquely prefixed scratch tables in the
test database (the DDL cannot ride in a rolled-back transaction). Pinned, with
rows present (CLAUDE.md pitfall #35):

* every ``user_positions`` row gets one open term, ``started_at`` from its
  ``assigned_at``, falling back to the member's ``created_at``;
* the name and kind are copied, and ``assigned_by`` is carried over;
* a re-run opens nothing twice;
* an empty database is a no-op both ways, and the downgrade drops the table
  and leaves ``user_positions`` alone;
* the table, key and index names are the ones ``create_all`` gives the model.
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

from app.core.config import settings
from app.models.member_position_term import MemberPositionTerm

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261106_2323_67ad01c43434_member_position_terms.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_member_position_terms", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_PREFIXED = (
    "TABLE",
    "USERS",
    "POSITIONS",
    "ORGANIZATIONS",
    "USER_POSITIONS",
    "UQ_OPEN",
    "CK_DATE_ORDER",
    "FK_ORGANIZATION",
    "FK_USER",
    "FK_POSITION",
    "FK_ASSIGNED_BY",
    "FK_ENDED_BY",
    "IX_ORG_USER",
    "IX_POSITION",
)


@pytest.mark.unit
class TestNamesMatchTheModel:
    def test_names_are_create_alls(self):
        table = MemberPositionTerm.__table__
        assert MIGRATION.TABLE == table.name
        keys = {
            next(iter(fk.constraint.columns)).name: fk.constraint.name
            for fk in table.foreign_keys
        }
        assert keys == {
            "organization_id": MIGRATION.FK_ORGANIZATION,
            "user_id": MIGRATION.FK_USER,
            "position_id": MIGRATION.FK_POSITION,
            "assigned_by": MIGRATION.FK_ASSIGNED_BY,
            "ended_by": MIGRATION.FK_ENDED_BY,
        }
        assert {i.name for i in table.indexes} == {
            MIGRATION.IX_ORG_USER,
            MIGRATION.IX_POSITION,
        }
        constraint_names = {c.name for c in table.constraints}
        assert MIGRATION.UQ_OPEN in constraint_names
        assert f"ck_{table.name}_{MIGRATION.CK_DATE_ORDER}" in constraint_names


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for attr in _PREFIXED:
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for table in (
                "member_position_terms",
                "user_positions",
                "positions",
                "users",
                "organizations",
            ):
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{prefix}{table}`")
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _tables(engine, prefix: str) -> list[str]:
    with engine.connect() as conn:
        return [t for t in sa.inspect(conn).get_table_names() if t.startswith(prefix)]


def _build_existing(engine, p: str) -> None:
    """The tables as an installation has them, with awkward rows in them."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {p}organizations (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {p}users (id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL, created_at DATETIME NULL) "
            "ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {p}positions (id VARCHAR(36) PRIMARY KEY, "
            "name VARCHAR(100) NOT NULL, kind VARCHAR(20) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {p}user_positions (user_id VARCHAR(36) NOT NULL, "
            "position_id VARCHAR(36) NOT NULL, assigned_at DATETIME NULL, "
            "assigned_by VARCHAR(36) NULL, PRIMARY KEY (user_id, position_id)) "
            "ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {p}organizations VALUES ('org-1')")
        conn.exec_driver_sql(
            f"INSERT INTO {p}users VALUES "
            "('u-1', 'org-1', '2020-01-01 00:00:00'), "
            "('u-2', 'org-1', '2021-06-01 00:00:00'), "
            "('chief', 'org-1', NULL)"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {p}positions VALUES "
            "('p-t', 'Treasurer', 'office'), ('p-h', 'History', 'committee')"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {p}user_positions VALUES "
            "('u-1', 'p-t', '2024-03-04 05:06:07', 'chief'), "
            "('u-1', 'p-h', '2025-01-02 00:00:00', NULL), "
            # assigned_at NULL: falls back to the member's created_at.
            "('u-2', 'p-t', NULL, NULL)"
        )
        conn.commit()


def _terms(engine, p: str) -> list[tuple]:
    with engine.connect() as conn:
        return [
            tuple(r)
            for r in conn.exec_driver_sql(
                "SELECT organization_id, user_id, position_id, position_name, "
                "position_kind, started_at, ended_at, assigned_by, open_marker "
                f"FROM {p}member_position_terms ORDER BY user_id, position_id"
            ).all()
        ]


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_an_empty_database_is_a_no_op_both_ways(self, scratch):
        _run(scratch.engine, MIGRATION.upgrade)
        assert _tables(scratch.engine, scratch.prefix) == []
        _run(scratch.engine, MIGRATION.downgrade)
        assert _tables(scratch.engine, scratch.prefix) == []

    def test_existing_assignments_each_get_one_open_term(self, scratch):
        engine, p = scratch.engine, scratch.prefix
        _build_existing(engine, p)

        expected = [
            (
                "org-1",
                "u-1",
                "p-h",
                "History",
                "committee",
                datetime(2025, 1, 2),
                None,
                None,
                1,
            ),
            (
                "org-1",
                "u-1",
                "p-t",
                "Treasurer",
                "office",
                datetime(2024, 3, 4, 5, 6, 7),
                None,
                "chief",
                1,
            ),
            (
                "org-1",
                "u-2",
                "p-t",
                "Treasurer",
                "office",
                datetime(2021, 6, 1),
                None,
                None,
                1,
            ),
        ]
        for _ in range(2):  # the second run must open nothing twice
            _run(engine, MIGRATION.upgrade)
            assert _terms(engine, p) == expected

        # The database refuses a second open term for the same pair.
        with engine.connect() as conn:
            with pytest.raises(sa.exc.IntegrityError):
                conn.exec_driver_sql(
                    f"INSERT INTO {p}member_position_terms (id, organization_id, "
                    "user_id, position_id, position_name, started_at) VALUES "
                    "('dup', 'org-1', 'u-1', 'p-t', 'Treasurer', NOW())"
                )
            conn.rollback()

        _run(engine, MIGRATION.downgrade)
        assert f"{p}member_position_terms" not in _tables(engine, p)
        with engine.connect() as conn:
            assert (
                conn.exec_driver_sql(f"SELECT COUNT(*) FROM {p}user_positions").scalar()
                == 3
            )
        _run(engine, MIGRATION.downgrade)
