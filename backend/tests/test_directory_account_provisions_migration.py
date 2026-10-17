"""Migration 73594b326e68 generalizes google_account_provisions.

Run against throwaway tables under a prefix in the suite's own database; the
real table is never altered. The scratch table carries a foreign key and
indexes named the way the naming convention names them, so the rename of
those names is exercised too.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "73594b326e68"
# A one-character prefix: the longest real constraint name is 61 of MySQL's
# 64 characters, so a longer one pushes the scratch names past the limit.
_OLD = "x_google_account_provisions"
_NEW = "x_directory_account_provisions"
_ORG_ID = "dirmig-org-0000-0000-000000000001"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("directory_accounts", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)

    def drop():
        with engine.begin() as conn:
            conn.execute(text(f"DROP TABLE IF EXISTS {_OLD}"))
            conn.execute(text(f"DROP TABLE IF EXISTS {_NEW}"))

    drop()
    yield engine
    drop()
    engine.dispose()


def _make_old_table(engine, rows, table=_OLD):
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {table} ("
                "id VARCHAR(36) PRIMARY KEY, "
                "organization_id VARCHAR(36) NOT NULL, "
                "status VARCHAR(20) NOT NULL, "
                "google_user_id VARCHAR(64) NULL, "
                f"CONSTRAINT fk_{table}_organization_id_organizations "
                "FOREIGN KEY (organization_id) REFERENCES organizations (id) "
                "ON DELETE CASCADE)"
            )
        )
        conn.execute(text(f"CREATE INDEX ix_{table}_org ON {table} (organization_id)"))
        for row_id, google_id in rows:
            conn.execute(
                text(
                    f"INSERT INTO {table} (id, organization_id, status, "
                    "google_user_id) VALUES (:id, :org, 'created', :gid)"
                ),
                {"id": row_id, "org": _ORG_ID, "gid": google_id},
            )


@pytest.fixture(autouse=True)
def _scratch_org(scratch_engine):
    with scratch_engine.begin() as conn:
        conn.execute(text("DELETE FROM organizations WHERE id = :id"), {"id": _ORG_ID})
        conn.execute(
            text(
                "INSERT INTO organizations (id, name, slug, organization_type, "
                "timezone, active, created_at, updated_at) VALUES (:id, "
                "'Migration Test', :slug, 'fire_department', 'UTC', 1, NOW(), "
                "NOW())"
            ),
            {"id": _ORG_ID, "slug": _ORG_ID},
        )
    yield
    with scratch_engine.begin() as conn:
        # The scratch tables reference the organization; drop them first.
        conn.execute(text(f"DROP TABLE IF EXISTS {_OLD}"))
        conn.execute(text(f"DROP TABLE IF EXISTS {_NEW}"))
        conn.execute(text("DELETE FROM organizations WHERE id = :id"), {"id": _ORG_ID})


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.OLD_TABLE = _OLD
    module.NEW_TABLE = _NEW
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _shape(engine, table):
    inspector = sa.inspect(engine)
    if table not in inspector.get_table_names():
        return None
    return (
        {c["name"] for c in inspector.get_columns(table)},
        {fk["name"] for fk in inspector.get_foreign_keys(table)},
        {ix["name"] for ix in inspector.get_indexes(table)},
    )


def _rows(engine, table, *cols):
    with engine.connect() as conn:
        return {
            r[0]: tuple(r[1:])
            for r in conn.execute(
                text(f"SELECT id, {', '.join(cols)} FROM {table} ORDER BY id")
            ).all()
        }


class TestDirectoryAccountProvisionsMigration:
    def test_upgrade_renames_everything_and_keeps_every_row_as_google(
        self, scratch_engine
    ):
        _make_old_table(scratch_engine, [("a", "g-1"), ("b", None)])

        _run(scratch_engine, "upgrade")

        assert _shape(scratch_engine, _OLD) is None
        columns, fks, indexes = _shape(scratch_engine, _NEW)
        assert {"provider", "external_user_id"} <= columns
        assert "google_user_id" not in columns
        assert fks == {f"fk_{_NEW}_organization_id_organizations"}
        assert f"ix_{_NEW}_org" in indexes
        assert not any(_OLD in name for name in indexes)
        assert _rows(scratch_engine, _NEW, "provider", "external_user_id") == {
            "a": ("google", "g-1"),
            "b": ("google", None),
        }

    def test_the_foreign_key_still_cascades(self, scratch_engine):
        _make_old_table(scratch_engine, [("a", "g-1")])
        _run(scratch_engine, "upgrade")

        with scratch_engine.begin() as conn:
            conn.execute(
                text("DELETE FROM organizations WHERE id = :id"), {"id": _ORG_ID}
            )

        assert _rows(scratch_engine, _NEW, "provider") == {}

    def test_a_second_upgrade_changes_nothing(self, scratch_engine):
        _make_old_table(scratch_engine, [("a", "g-1")])
        _run(scratch_engine, "upgrade")
        before = _shape(scratch_engine, _NEW)

        _run(scratch_engine, "upgrade")

        assert _shape(scratch_engine, _NEW) == before
        assert _rows(scratch_engine, _NEW, "provider") == {"a": ("google",)}

    def test_an_empty_table_create_all_built_is_replaced(self, scratch_engine):
        _make_old_table(scratch_engine, [("a", "g-1")])
        with scratch_engine.begin() as conn:
            conn.execute(
                text(
                    f"CREATE TABLE {_NEW} (id VARCHAR(36) PRIMARY KEY, "
                    "provider VARCHAR(20) NOT NULL DEFAULT 'google')"
                )
            )

        _run(scratch_engine, "upgrade")

        assert _shape(scratch_engine, _OLD) is None
        assert _rows(scratch_engine, _NEW, "external_user_id") == {"a": ("g-1",)}

    def test_two_populated_tables_are_left_for_a_person(self, scratch_engine):
        _make_old_table(scratch_engine, [("a", "g-1")])
        with scratch_engine.begin() as conn:
            conn.execute(
                text(
                    f"CREATE TABLE {_NEW} (id VARCHAR(36) PRIMARY KEY, "
                    "provider VARCHAR(20) NOT NULL DEFAULT 'google', "
                    "external_user_id VARCHAR(64) NULL)"
                )
            )
            conn.execute(text(f"INSERT INTO {_NEW} (id) VALUES ('z')"))

        _run(scratch_engine, "upgrade")

        assert _rows(scratch_engine, _OLD, "google_user_id") == {"a": ("g-1",)}
        assert _rows(scratch_engine, _NEW, "provider") == {"z": ("google",)}

    def test_upgrade_without_the_table_does_nothing(self, scratch_engine):
        _run(scratch_engine, "upgrade")

        assert _shape(scratch_engine, _OLD) is None
        assert _shape(scratch_engine, _NEW) is None

    def test_downgrade_restores_the_old_shape_and_drops_other_directories(
        self, scratch_engine
    ):
        _make_old_table(scratch_engine, [("a", "g-1")])
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO {_NEW} (id, organization_id, status, provider) "
                    "VALUES ('m', :org, 'created', 'microsoft')"
                ),
                {"org": _ORG_ID},
            )

        _run(scratch_engine, "downgrade")

        assert _shape(scratch_engine, _NEW) is None
        columns, fks, indexes = _shape(scratch_engine, _OLD)
        assert "google_user_id" in columns
        assert not {"provider", "external_user_id"} & columns
        assert fks == {f"fk_{_OLD}_organization_id_organizations"}
        assert f"ix_{_OLD}_org" in indexes
        # A Microsoft row would read back as a Google account; it is gone.
        assert _rows(scratch_engine, _OLD, "google_user_id") == {"a": ("g-1",)}
