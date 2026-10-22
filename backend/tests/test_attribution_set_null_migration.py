"""Migration cbe0de50f202: examiner / filing-officer keys become SET NULL.

The DDL autocommits, so the migration runs against throwaway copies of the two
tables under a prefix in the suite's own database (the shape
``test_meetings_meeting_type_migration.py`` uses); the real tables are never
altered. The copies reference the real ``users`` table, because the migration
finds its keys by ``referenced_table_name = 'users'``.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

from app.models.skills_testing import SkillTest
from app.models.training import ShiftCompletionReport

pytestmark = [pytest.mark.integration]

_REVISION = "cbe0de50f202"
_PREFIX = "attrnullmig_"
_TABLES = {
    _PREFIX + "skill_tests": "examiner_id",
    _PREFIX + "shift_completion_reports": "officer_id",
}


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("attribution_set_null", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop_scratch(conn) -> None:
    for table in _TABLES:
        conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


@pytest.fixture
def scratch():
    """Scratch tables plus one committed member to point them at."""
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        _drop_scratch(conn)
        conn.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Mig FD', 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "slug": f"mig-{org_id[:8]}"},
        )
        conn.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
                "'Mig', 'Examiner', :em, 'hashed', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"mig_{user_id[:8]}",
                "em": f"mig_{user_id[:8]}@test.com",
            },
        )
        for table, column in _TABLES.items():
            conn.execute(
                text(
                    f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, "
                    f"{column} VARCHAR(36) NOT NULL, "
                    f"FOREIGN KEY ({column}) REFERENCES users (id) "
                    "ON DELETE CASCADE) "
                    "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                )
            )
            conn.execute(
                text(f"INSERT INTO {table} VALUES ('row-1', :u)"), {"u": user_id}
            )
    yield engine, user_id
    with engine.begin() as conn:
        _drop_scratch(conn)
        conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        conn.execute(text("DELETE FROM organizations WHERE id = :id"), {"id": org_id})
    engine.dispose()


def _run(engine, step: str) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module._COLUMNS = [
        (table, column, f"fk_{table}_{column}") for table, column in _TABLES.items()
    ]
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _state(engine, table: str, column: str) -> tuple[list[str], str]:
    with engine.connect() as conn:
        rules = conn.execute(
            text(
                "SELECT r.delete_rule FROM information_schema.key_column_usage k "
                "JOIN information_schema.referential_constraints r "
                "  ON r.constraint_schema = k.constraint_schema "
                " AND r.constraint_name = k.constraint_name "
                " AND r.table_name = k.table_name "
                "WHERE k.table_schema = DATABASE() AND k.table_name = :t "
                "  AND k.column_name = :c AND k.referenced_table_name = 'users'"
            ),
            {"t": table, "c": column},
        ).scalars()
        nullable = conn.execute(
            text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = :t "
                "AND column_name = :c"
            ),
            {"t": table, "c": column},
        ).scalar_one()
    return sorted(rules), nullable


class TestUpgrade:
    def test_keys_become_set_null_and_rows_survive_the_delete(self, scratch):
        engine, user_id = scratch

        _run(engine, "upgrade")

        for table, column in _TABLES.items():
            assert _state(engine, table, column) == (["SET NULL"], "YES")
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        with engine.connect() as conn:
            for table, column in _TABLES.items():
                assert conn.execute(
                    text(f"SELECT id, {column} FROM {table}")
                ).all() == [("row-1", None)]

    def test_a_second_upgrade_changes_nothing(self, scratch):
        engine, _ = scratch
        _run(engine, "upgrade")

        _run(engine, "upgrade")

        for table, column in _TABLES.items():
            assert _state(engine, table, column) == (["SET NULL"], "YES")


class TestDowngrade:
    def test_restores_cascade_and_not_null_when_no_row_is_orphaned(self, scratch):
        engine, _ = scratch
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        for table, column in _TABLES.items():
            assert _state(engine, table, column) == (["CASCADE"], "NO")

    def test_keeps_orphaned_rows_and_leaves_the_column_nullable(self, scratch):
        engine, user_id = scratch
        _run(engine, "upgrade")
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})

        _run(engine, "downgrade")

        with engine.connect() as conn:
            for table, column in _TABLES.items():
                assert _state(engine, table, column) == (["CASCADE"], "YES")
                assert conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() == 1


def test_a_database_without_the_tables_is_skipped():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        with engine.begin() as conn:
            _drop_scratch(conn)
        _run(engine, "upgrade")
        _run(engine, "downgrade")
    finally:
        engine.dispose()


class TestModelsMatchMigration:
    @pytest.mark.parametrize(
        "column",
        [
            SkillTest.__table__.c.examiner_id,
            ShiftCompletionReport.__table__.c.officer_id,
        ],
    )
    def test_column_is_nullable_with_set_null_key(self, column):
        assert column.nullable is True  # CLAUDE.md pitfall #2
        (fk,) = column.foreign_keys
        assert fk.column.table.name == "users"
        assert fk.ondelete == "SET NULL"
