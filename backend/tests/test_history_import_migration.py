"""``5d1e7c3a9b20`` adds the History import and merge tables.

Run for real against MySQL/MariaDB on uniquely prefixed scratch tables in the
test database (DDL cannot ride in a rolled-back transaction; the pattern of
``test_attendance_waiver_migration.py``). Pinned:

* existing ``historical_members`` rows survive the upgrade and read as "not
  created by an import" (pitfall #35: the migration meets rows that exist);
* upgrade, downgrade, upgrade, and a re-run of either step changes nothing;
* deleting an import clears the column pointing at it rather than refusing;
* the names and enum values are the models'.
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
from app.models.history import (
    HistoricalMember,
    HistoryImport,
    HistoryImportDecision,
    HistoryImportRow,
    HistoryImportStatus,
    HistoryImportTitleMapping,
    HistoryRecordRedirect,
    HistoryTitleAction,
)

_PATH = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_5d1e7c3a9b20_*.py"
    )
)


def _migration():
    spec = importlib.util.spec_from_file_location("_history_import", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_PREFIXED = (
    "ORGANIZATIONS",
    "USERS",
    "TITLES",
    "MEMBERS",
    "IMPORTS",
    "ROWS",
    "MAPPINGS",
    "REDIRECTS",
)
_NEW = ("IMPORTS", "ROWS", "MAPPINGS", "REDIRECTS")


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_table_names(self):
        assert MIGRATION.IMPORTS == HistoryImport.__tablename__
        assert MIGRATION.ROWS == HistoryImportRow.__tablename__
        assert MIGRATION.MAPPINGS == HistoryImportTitleMapping.__tablename__
        assert MIGRATION.REDIRECTS == HistoryRecordRedirect.__tablename__
        assert MIGRATION.MEMBERS == HistoricalMember.__tablename__

    def test_index_names(self):
        assert {i.name for i in HistoryImport.__table__.indexes} == {
            MIGRATION.IX_IMPORTS_ORG_STATUS,
            MIGRATION.IX_IMPORTS_STATUS_EXPIRES,
        }
        assert {i.name for i in HistoryImportRow.__table__.indexes} == {
            MIGRATION.IX_ROWS_IMPORT
        }
        assert {i.name for i in HistoryRecordRedirect.__table__.indexes} == {
            MIGRATION.IX_REDIRECTS_NEW
        }
        assert MIGRATION.IX_MEMBERS_IMPORT in {
            i.name for i in HistoricalMember.__table__.indexes
        }

    def test_the_enums_are_frozen_copies_of_the_models(self):
        assert MIGRATION._IMPORT_STATUS == tuple(e.value for e in HistoryImportStatus)
        assert MIGRATION._DECISION == tuple(e.value for e in HistoryImportDecision)
        assert MIGRATION._TITLE_ACTION == tuple(e.value for e in HistoryTitleAction)


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
            for attr in _PREFIXED:
                conn.exec_driver_sql(
                    f"DROP TABLE IF EXISTS `{getattr(MIGRATION, attr)}`"
                )
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _existing_archive(engine) -> None:
    """The tables phase 1 left, with records already in them."""
    with engine.connect() as conn:
        for attr in ("ORGANIZATIONS", "USERS", "TITLES"):
            conn.exec_driver_sql(
                f"CREATE TABLE {getattr(MIGRATION, attr)} "
                "(id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
            )
        conn.exec_driver_sql(
            f"CREATE TABLE {MIGRATION.MEMBERS} (id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL, last_name VARCHAR(100) NOT NULL, "
            "revision_number INT NOT NULL DEFAULT 1) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {MIGRATION.ORGANIZATIONS} VALUES ('org')")
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.MEMBERS} (id, organization_id, last_name, "
            "revision_number) VALUES ('p1', 'org', 'Smith', 4), "
            "('p2', 'org', 'Jones', 1)"
        )
        conn.commit()


def _tables(engine) -> set:
    with engine.connect() as conn:
        return set(sa.inspect(conn).get_table_names())


def _columns(engine, table) -> set:
    with engine.connect() as conn:
        return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _members(engine) -> list:
    with engine.connect() as conn:
        return conn.exec_driver_sql(
            f"SELECT id, last_name, revision_number, import_id, "
            f"import_revision_number FROM {MIGRATION.MEMBERS} ORDER BY id"
        ).all()


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_existing_records_survive_and_read_as_not_imported(self, scratch):
        _existing_archive(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        assert [tuple(r) for r in _members(scratch.engine)] == [
            ("p1", "Smith", 4, None, None),
            ("p2", "Jones", 1, None, None),
        ]

    def test_upgrade_downgrade_upgrade_and_reruns(self, scratch):
        _existing_archive(scratch.engine)
        new_tables = {getattr(MIGRATION, attr) for attr in _NEW}
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.upgrade)
        assert new_tables <= _tables(scratch.engine)
        assert {"import_id", "import_revision_number"} <= _columns(
            scratch.engine, MIGRATION.MEMBERS
        )

        _run(scratch.engine, MIGRATION.downgrade)
        _run(scratch.engine, MIGRATION.downgrade)
        assert not new_tables & _tables(scratch.engine)
        assert "import_id" not in _columns(scratch.engine, MIGRATION.MEMBERS)
        assert len(_members_without_import(scratch.engine)) == 2

        _run(scratch.engine, MIGRATION.upgrade)
        assert new_tables <= _tables(scratch.engine)

    def test_deleting_an_import_clears_the_records_pointing_at_it(self, scratch):
        _existing_archive(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        with scratch.engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {MIGRATION.IMPORTS} (id, organization_id, "
                "source_filename, headers, column_mapping) "
                "VALUES ('imp', 'org', 'roster.csv', '[]', '{}')"
            )
            conn.exec_driver_sql(
                f"UPDATE {MIGRATION.MEMBERS} SET import_id = 'imp', "
                "import_revision_number = 1 WHERE id = 'p2'"
            )
            conn.exec_driver_sql(f"DELETE FROM {MIGRATION.IMPORTS} WHERE id = 'imp'")
            conn.commit()
        rows = {r[0]: r for r in _members(scratch.engine)}
        assert rows["p2"][3] is None


def _members_without_import(engine) -> list:
    with engine.connect() as conn:
        return conn.exec_driver_sql(
            f"SELECT id, last_name FROM {MIGRATION.MEMBERS}"
        ).all()
