"""``4d8e2b6f1c93`` adds the History document tables.

Run for real against MySQL/MariaDB on uniquely prefixed scratch tables in the
test database (DDL cannot ride in a rolled-back transaction; the pattern of
``test_history_media_migration.py``). Pinned:

* existing ``documents``, ``historical_members`` and ``history_albums`` rows
  survive the upgrade untouched (pitfall #35: the migration meets rows that
  exist);
* upgrade, downgrade, upgrade, and a re-run of either step changes nothing;
* deleting a ``documents`` row takes its catalogue, files, tags and album
  places with it;
* the transcription and PDF text columns hold more than TEXT's 64 KB;
* the names, columns and enum values are the models'.
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
    DocumentKind,
    HistoryAlbumDocument,
    HistoryDocument,
    HistoryDocumentFile,
    HistoryDocumentTag,
    HistoryDocumentType,
    MediaFileRole,
)

_PATH = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_4d8e2b6f1c93_*.py"
    )
)


def _migration():
    spec = importlib.util.spec_from_file_location("_history_documents", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_PREFIXED = (
    "ORGANIZATIONS",
    "USERS",
    "DOCUMENTS",
    "MEMBERS",
    "SOURCES",
    "ALBUMS",
    "TYPES",
    "HISTORY_DOCUMENTS",
    "FILES",
    "TAGS",
    "ALBUM_DOCUMENTS",
)
_NEW = ("TYPES", "HISTORY_DOCUMENTS", "FILES", "TAGS", "ALBUM_DOCUMENTS")


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_table_names(self):
        assert MIGRATION.TYPES == HistoryDocumentType.__tablename__
        assert MIGRATION.HISTORY_DOCUMENTS == HistoryDocument.__tablename__
        assert MIGRATION.FILES == HistoryDocumentFile.__tablename__
        assert MIGRATION.TAGS == HistoryDocumentTag.__tablename__
        assert MIGRATION.ALBUM_DOCUMENTS == HistoryAlbumDocument.__tablename__

    def test_index_names(self):
        assert {i.name for i in HistoryDocument.__table__.indexes} == {
            MIGRATION.IX_DOCS_ORG_LEVEL,
            MIGRATION.IX_DOCS_ORG_TYPE,
            MIGRATION.IX_DOCS_ORG_DATE,
            MIGRATION.IX_DOCS_SOURCE,
        }
        assert {i.name for i in HistoryDocumentTag.__table__.indexes} == {
            MIGRATION.IX_TAGS_MEMBER
        }
        assert {i.name for i in HistoryAlbumDocument.__table__.indexes} == {
            MIGRATION.IX_ALBUM_DOCUMENTS_DOCUMENT
        }

    def test_the_enums_are_frozen_copies_of_the_models(self):
        assert MIGRATION._KIND == tuple(e.value for e in DocumentKind)
        assert MIGRATION._ROLE == tuple(e.value for e in MediaFileRole)


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


def _existing(engine) -> None:
    """The tables this migration points at, with rows already in them."""
    m = MIGRATION
    with engine.connect() as conn:
        for table in (m.ORGANIZATIONS, m.USERS):
            conn.exec_driver_sql(
                f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
            )
        for table in (m.DOCUMENTS, m.SOURCES, m.ALBUMS):
            conn.exec_driver_sql(
                f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, "
                "organization_id VARCHAR(36) NOT NULL, name VARCHAR(255) NOT NULL) "
                "ENGINE=InnoDB"
            )
        conn.exec_driver_sql(
            f"CREATE TABLE {m.MEMBERS} (id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL, last_name VARCHAR(100) NOT NULL) "
            "ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {m.ORGANIZATIONS} VALUES ('org')")
        conn.exec_driver_sql(
            f"INSERT INTO {m.DOCUMENTS} VALUES ('d1', 'org', 'Minutes 1962'), "
            "('d2', 'org', 'Letter')"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {m.MEMBERS} VALUES ('p1', 'org', 'Smith'), "
            "('p2', 'org', 'Jones')"
        )
        conn.exec_driver_sql(f"INSERT INTO {m.ALBUMS} VALUES ('a1', 'org', 'Parade')")
        conn.commit()


def _tables(engine) -> set:
    with engine.connect() as conn:
        return set(sa.inspect(conn).get_table_names())


def _count(engine, table, where="1=1") -> int:
    with engine.connect() as conn:
        return conn.exec_driver_sql(
            f"SELECT COUNT(*) FROM {table} WHERE {where}"
        ).scalar_one()


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_existing_rows_survive(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        assert _count(scratch.engine, MIGRATION.DOCUMENTS) == 2
        assert _count(scratch.engine, MIGRATION.MEMBERS) == 2
        assert _count(scratch.engine, MIGRATION.ALBUMS) == 1
        # Nothing is catalogued by the migration itself.
        assert _count(scratch.engine, MIGRATION.HISTORY_DOCUMENTS) == 0

    def test_upgrade_downgrade_upgrade_and_reruns(self, scratch):
        _existing(scratch.engine)
        new_tables = {getattr(MIGRATION, attr) for attr in _NEW}
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.upgrade)
        assert new_tables <= _tables(scratch.engine)
        _run(scratch.engine, MIGRATION.downgrade)
        _run(scratch.engine, MIGRATION.downgrade)
        assert not new_tables & _tables(scratch.engine)
        assert _count(scratch.engine, MIGRATION.DOCUMENTS) == 2
        _run(scratch.engine, MIGRATION.upgrade)
        assert new_tables <= _tables(scratch.engine)

    def test_the_catalogue_has_every_column_the_model_maps(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        with scratch.engine.connect() as conn:
            columns = {
                c["name"]: c
                for c in sa.inspect(conn).get_columns(MIGRATION.HISTORY_DOCUMENTS)
            }
        assert set(columns) == {c.name for c in HistoryDocument.__table__.columns}

    def test_the_searched_text_holds_more_than_text(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        long_text = "x" * 100_000
        with scratch.engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {MIGRATION.HISTORY_DOCUMENTS} (document_id, "
                "organization_id, kind, title, original_filename, transcription, "
                "extracted_text) VALUES ('d1', 'org', 'pdf', 'Minutes', 'm.pdf', "
                "%(t)s, %(t)s)",
                {"t": long_text},
            )
            conn.commit()
            stored = conn.exec_driver_sql(
                f"SELECT LENGTH(transcription), LENGTH(extracted_text) "
                f"FROM {MIGRATION.HISTORY_DOCUMENTS}"
            ).one()
        assert tuple(stored) == (100_000, 100_000)

    def test_deleting_the_document_takes_what_hangs_off_it(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        with scratch.engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {m.HISTORY_DOCUMENTS} (document_id, organization_id, "
                "kind, title, original_filename) "
                "VALUES ('d1', 'org', 'pdf', 'Minutes', 'm.pdf')"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {m.FILES} (id, document_id, role, file_path, "
                "mime_type, size_bytes, sha256) VALUES ('f1', 'd1', 'display', 'x', "
                "'application/pdf', 1, 'abc')"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {m.TAGS} (document_id, member_id) VALUES ('d1', 'p1')"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {m.ALBUM_DOCUMENTS} (album_id, document_id) "
                "VALUES ('a1', 'd1')"
            )
            conn.exec_driver_sql(f"DELETE FROM {m.DOCUMENTS} WHERE id = 'd1'")
            conn.commit()
        assert _count(scratch.engine, m.HISTORY_DOCUMENTS) == 0
        assert _count(scratch.engine, m.FILES) == 0
        assert _count(scratch.engine, m.TAGS) == 0
        assert _count(scratch.engine, m.ALBUM_DOCUMENTS) == 0
        assert _count(scratch.engine, m.ALBUMS) == 1
        assert _count(scratch.engine, m.MEMBERS) == 2
