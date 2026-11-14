"""``7a3c9e1d5b42`` adds the History photo and media tables.

Run for real against MySQL/MariaDB on uniquely prefixed scratch tables in the
test database (DDL cannot ride in a rolled-back transaction; the pattern of
``test_history_import_migration.py``). Pinned:

* existing ``historical_members`` rows survive the upgrade untouched (pitfall
  #35: the migration meets rows that exist);
* upgrade, downgrade, upgrade, and a re-run of either step changes nothing;
* deleting a media item takes its files, tags and album places with it, and
  clears an album cover rather than refusing;
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
    AlbumLevel,
    HistoryAlbum,
    HistoryAlbumItem,
    HistoryMedia,
    HistoryMediaFile,
    HistoryMediaTag,
    HistorySource,
    MediaFileRole,
    MediaKind,
)

_PATH = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_7a3c9e1d5b42_*.py"
    )
)


def _migration():
    spec = importlib.util.spec_from_file_location("_history_media", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_PREFIXED = (
    "ORGANIZATIONS",
    "USERS",
    "MEMBERS",
    "SOURCES",
    "MEDIA",
    "FILES",
    "TAGS",
    "ALBUMS",
    "ALBUM_ITEMS",
)
_NEW = ("SOURCES", "MEDIA", "FILES", "TAGS", "ALBUMS", "ALBUM_ITEMS")


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_table_names(self):
        assert MIGRATION.SOURCES == HistorySource.__tablename__
        assert MIGRATION.MEDIA == HistoryMedia.__tablename__
        assert MIGRATION.FILES == HistoryMediaFile.__tablename__
        assert MIGRATION.TAGS == HistoryMediaTag.__tablename__
        assert MIGRATION.ALBUMS == HistoryAlbum.__tablename__
        assert MIGRATION.ALBUM_ITEMS == HistoryAlbumItem.__tablename__

    def test_index_names(self):
        assert {i.name for i in HistoryMedia.__table__.indexes} == {
            MIGRATION.IX_MEDIA_ORG_LEVEL,
            MIGRATION.IX_MEDIA_ORG_KIND,
            MIGRATION.IX_MEDIA_ORG_DATE,
            MIGRATION.IX_MEDIA_SOURCE,
        }
        assert {i.name for i in HistoryMediaTag.__table__.indexes} == {
            MIGRATION.IX_TAGS_MEMBER
        }
        assert {i.name for i in HistoryAlbum.__table__.indexes} == {
            MIGRATION.IX_ALBUMS_ORG_LEVEL
        }
        assert {i.name for i in HistoryAlbumItem.__table__.indexes} == {
            MIGRATION.IX_ALBUM_ITEMS_MEDIA
        }

    def test_the_enums_are_frozen_copies_of_the_models(self):
        assert MIGRATION._KIND == tuple(e.value for e in MediaKind)
        assert MIGRATION._ROLE == tuple(e.value for e in MediaFileRole)
        assert MIGRATION._ALBUM_LEVEL == tuple(e.value for e in AlbumLevel)


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
    with engine.connect() as conn:
        for attr in ("ORGANIZATIONS", "USERS"):
            conn.exec_driver_sql(
                f"CREATE TABLE {getattr(MIGRATION, attr)} "
                "(id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
            )
        conn.exec_driver_sql(
            f"CREATE TABLE {MIGRATION.MEMBERS} (id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL, last_name VARCHAR(100) NOT NULL) "
            "ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {MIGRATION.ORGANIZATIONS} VALUES ('org')")
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.MEMBERS} VALUES ('p1', 'org', 'Smith'), "
            "('p2', 'org', 'Jones')"
        )
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
    def test_existing_records_survive(self, scratch):
        _existing_archive(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        with scratch.engine.connect() as conn:
            rows = conn.exec_driver_sql(
                f"SELECT id, last_name FROM {MIGRATION.MEMBERS} ORDER BY id"
            ).all()
        assert [tuple(r) for r in rows] == [("p1", "Smith"), ("p2", "Jones")]

    def test_upgrade_downgrade_upgrade_and_reruns(self, scratch):
        _existing_archive(scratch.engine)
        new_tables = {getattr(MIGRATION, attr) for attr in _NEW}
        _run(scratch.engine, MIGRATION.upgrade)
        _run(scratch.engine, MIGRATION.upgrade)
        assert new_tables <= _tables(scratch.engine)
        _run(scratch.engine, MIGRATION.downgrade)
        _run(scratch.engine, MIGRATION.downgrade)
        assert not new_tables & _tables(scratch.engine)
        assert _count(scratch.engine, MIGRATION.MEMBERS) == 2
        _run(scratch.engine, MIGRATION.upgrade)
        assert new_tables <= _tables(scratch.engine)

    def test_the_media_table_has_every_column_the_model_maps(self, scratch):
        """The migration builds history_media; a column the model gained (the
        recording length) and the migration lacked would fail the first
        upload on an upgraded install."""
        _existing_archive(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        with scratch.engine.connect() as conn:
            built = {c["name"] for c in sa.inspect(conn).get_columns(MIGRATION.MEDIA)}
        assert {c.name for c in HistoryMedia.__table__.columns} == built

    def test_deleting_an_item_takes_what_hangs_off_it(self, scratch):
        _existing_archive(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        with scratch.engine.connect() as conn:
            conn.exec_driver_sql(
                f"INSERT INTO {m.MEDIA} (id, organization_id, kind, title, "
                "original_filename) VALUES ('m1', 'org', 'photo', 'Parade', 'p.jpg')"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {m.FILES} (id, media_id, role, file_path, mime_type, "
                "size_bytes, sha256) VALUES ('f1', 'm1', 'original', 'x', "
                "'image/jpeg', 1, 'abc')"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {m.TAGS} (media_id, member_id) VALUES ('m1', 'p1')"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {m.ALBUMS} (id, organization_id, name, cover_media_id) "
                "VALUES ('a1', 'org', 'Parades', 'm1')"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {m.ALBUM_ITEMS} (album_id, media_id) VALUES ('a1', 'm1')"
            )
            conn.exec_driver_sql(f"DELETE FROM {m.MEDIA} WHERE id = 'm1'")
            conn.commit()
        assert _count(scratch.engine, m.FILES) == 0
        assert _count(scratch.engine, m.TAGS) == 0
        assert _count(scratch.engine, m.ALBUM_ITEMS) == 0
        assert _count(scratch.engine, m.ALBUMS, "cover_media_id IS NULL") == 1
        assert _count(scratch.engine, m.MEMBERS) == 2
