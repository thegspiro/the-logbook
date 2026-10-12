"""``dcb8a46ac50c`` files every unfiled document into its organization's
General Documents root.

Run for real against MySQL/MariaDB: the record table's DDL cannot ride in the
rolled-back ``db_session`` transaction, because MySQL commits implicitly
around it. Each test points the migration at uniquely prefixed copies of
``documents`` and ``document_folders`` (``CREATE TABLE … LIKE``) in the test
database and drops them afterwards. Pinned:

* a database without the tables is a no-op both ways;
* unfiled documents move into the organization's existing General root;
  documents already in a folder are not touched;
* an organization without a General root gets one, with the system fields;
* the downgrade returns a moved document to no folder only while it is still
  in General, and removes only a root it created and only if it is empty;
* a second upgrade after a downgrade files the documents again.
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

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261011_1356_dcb8a46ac50c_file_unfiled_documents_into_general.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_unfiled_documents", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"u{uuid.uuid4().hex[:6]}_"
    monkeypatch.setattr(MIGRATION, "DOCUMENTS", f"{prefix}documents")
    monkeypatch.setattr(MIGRATION, "FOLDERS", f"{prefix}document_folders")
    monkeypatch.setattr(MIGRATION, "RECORD", f"{prefix}unfiled_backfill")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            for table in ("documents", "document_folders", "unfiled_backfill"):
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{prefix}{table}`")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _build(engine, prefix: str) -> None:
    """Org A has a General root and a Finance root; org B has neither."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE {prefix}document_folders LIKE document_folders"
        )
        conn.exec_driver_sql(f"CREATE TABLE {prefix}documents LIKE documents")
        conn.exec_driver_sql(
            f"INSERT INTO {prefix}document_folders "
            "(id, organization_id, name, slug, is_system, sort_order, parent_id, "
            "visibility, created_at, updated_at) VALUES "
            "('gen-a', 'org-a', 'General Documents', 'general', 1, 6, NULL, "
            "'organization', NOW(), NOW()), "
            "('fin-a', 'org-a', 'Finance', 'finance', 1, 9, NULL, "
            "'organization', NOW(), NOW())"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {prefix}documents (id, organization_id, name, folder_id) "
            "VALUES ('a1', 'org-a', 'one', NULL), ('a2', 'org-a', 'two', NULL), "
            "('a3', 'org-a', 'receipt', 'fin-a'), ('b1', 'org-b', 'three', NULL)"
        )
        conn.commit()


def _folders_of(engine, prefix: str) -> dict:
    with engine.connect() as conn:
        rows = conn.exec_driver_sql(
            f"SELECT id, folder_id FROM {prefix}documents"
        ).all()
    return {row[0]: row[1] for row in rows}


def _general_of(engine, prefix: str, org: str):
    with engine.connect() as conn:
        return conn.exec_driver_sql(
            f"SELECT id, name, is_system, visibility, parent_id "
            f"FROM {prefix}document_folders "
            "WHERE organization_id = %s AND slug = 'general'",
            (org,),
        ).all()


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_missing_tables_are_a_no_op_both_ways(self, scratch):
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.downgrade)
        with scratch.engine.connect() as conn:
            assert MIGRATION.RECORD not in sa.inspect(conn).get_table_names()

    def test_unfiled_documents_are_filed_into_general(self, scratch):
        _build(scratch.engine, scratch.prefix)

        _run(scratch.engine, MIGRATION.upgrade)

        folders = _folders_of(scratch.engine, scratch.prefix)
        assert folders["a1"] == "gen-a"
        assert folders["a2"] == "gen-a"
        assert folders["a3"] == "fin-a"  # already filed: untouched
        created = _general_of(scratch.engine, scratch.prefix, "org-b")
        assert len(created) == 1
        general_b, name, is_system, visibility, parent_id = created[0]
        assert folders["b1"] == general_b
        assert (name, is_system, visibility, parent_id) == (
            "General Documents",
            1,
            "organization",
            None,
        )

    def test_downgrade_restores_only_what_it_moved(self, scratch):
        _build(scratch.engine, scratch.prefix)
        _run(scratch.engine, MIGRATION.upgrade)
        # Somebody files a2 elsewhere after the upgrade.
        with scratch.engine.connect() as conn:
            conn.exec_driver_sql(
                f"UPDATE {scratch.prefix}documents SET folder_id = 'fin-a' "
                "WHERE id = 'a2'"
            )
            conn.commit()

        _run(scratch.engine, MIGRATION.downgrade)

        folders = _folders_of(scratch.engine, scratch.prefix)
        assert folders == {"a1": None, "a2": "fin-a", "a3": "fin-a", "b1": None}
        # Org A's own General root stays; the one created for org B goes.
        assert len(_general_of(scratch.engine, scratch.prefix, "org-a")) == 1
        assert _general_of(scratch.engine, scratch.prefix, "org-b") == []
        with scratch.engine.connect() as conn:
            assert MIGRATION.RECORD not in sa.inspect(conn).get_table_names()

    def test_a_created_root_with_content_survives_the_downgrade(self, scratch):
        _build(scratch.engine, scratch.prefix)
        _run(scratch.engine, MIGRATION.upgrade)
        general_b = _general_of(scratch.engine, scratch.prefix, "org-b")[0][0]
        with scratch.engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {scratch.prefix}documents "
                "(id, organization_id, name, folder_id) VALUES (%s, %s, %s, %s)",
                ("b2", "org-b", "uploaded later", general_b),
            )
            conn.commit()

        _run(scratch.engine, MIGRATION.downgrade)

        assert len(_general_of(scratch.engine, scratch.prefix, "org-b")) == 1
        assert _folders_of(scratch.engine, scratch.prefix)["b2"] == general_b

    def test_upgrade_after_downgrade_files_them_again(self, scratch):
        _build(scratch.engine, scratch.prefix)
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.downgrade)

        _run(scratch.engine, MIGRATION.upgrade)

        folders = _folders_of(scratch.engine, scratch.prefix)
        assert None not in folders.values()
