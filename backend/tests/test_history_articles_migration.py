"""``8d4ee6cc92ca`` adds History articles.

Run for real against MySQL/MariaDB on uniquely prefixed scratch tables in the
test database (DDL cannot ride in a rolled-back transaction; the pattern of
``test_history_events_migration.py``). Pinned:

* upgrade, downgrade, upgrade, and a re-run of either step changes nothing,
  and the photos, events, people and documents an article points at survive
  the downgrade;
* deleting an article takes its blocks and links with it; deleting a photo
  leaves the block (and clears the cover) rather than renumbering the body;
* one block per position;
* a text block holds more than TEXT's 64 KB;
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
    ArticleBlockKind,
    ArticlePhotoSize,
    HistoryArticle,
    HistoryArticleApparatus,
    HistoryArticleBlock,
    HistoryArticleDocument,
    HistoryArticleEvent,
    HistoryArticleMember,
    PublicationLevel,
)

_PATH = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_8d4ee6cc92ca_*.py"
    )
)


def _migration():
    spec = importlib.util.spec_from_file_location("_history_articles", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_EXISTING = (
    "ORGANIZATIONS",
    "USERS",
    "MEMBERS",
    "MEDIA",
    "DOCUMENTS",
    "EVENTS",
    "APPARATUS",
)
_NEW = (
    "ARTICLES",
    "BLOCKS",
    "ARTICLE_MEMBERS",
    "ARTICLE_EVENTS",
    "ARTICLE_APPARATUS",
    "ARTICLE_DOCUMENTS",
)


def _index_names(model) -> set:
    return {i.name for i in model.__table__.indexes}


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_table_names(self):
        m = MIGRATION
        pairs = {
            m.ARTICLES: HistoryArticle,
            m.BLOCKS: HistoryArticleBlock,
            m.ARTICLE_MEMBERS: HistoryArticleMember,
            m.ARTICLE_EVENTS: HistoryArticleEvent,
            m.ARTICLE_APPARATUS: HistoryArticleApparatus,
            m.ARTICLE_DOCUMENTS: HistoryArticleDocument,
        }
        for table, model in pairs.items():
            assert table == model.__tablename__

    def test_index_and_key_names(self):
        m = MIGRATION
        assert _index_names(HistoryArticle) == {
            m.IX_ARTICLES_ORG_LEVEL,
            m.IX_ARTICLES_ORG_UPDATED,
            m.IX_ARTICLES_COVER,
        }
        assert _index_names(HistoryArticleBlock) == {m.IX_BLOCKS_MEDIA}
        assert _index_names(HistoryArticleMember) == {m.IX_ARTICLE_MEMBERS_MEMBER}
        assert _index_names(HistoryArticleEvent) == {m.IX_ARTICLE_EVENTS_EVENT}
        assert _index_names(HistoryArticleApparatus) == {
            m.IX_ARTICLE_APPARATUS_APPARATUS
        }
        assert _index_names(HistoryArticleDocument) == {m.IX_ARTICLE_DOCUMENTS_DOCUMENT}
        assert {
            c.name
            for c in HistoryArticleBlock.__table__.constraints
            if isinstance(c, sa.UniqueConstraint)
        } == {m.UQ_BLOCK_POSITION}

    def test_the_enums_are_frozen_copies_of_the_models(self):
        assert MIGRATION._LEVEL == tuple(e.value for e in PublicationLevel)
        assert MIGRATION._BLOCK_KIND == tuple(e.value for e in ArticleBlockKind)
        assert MIGRATION._PHOTO_SIZE == tuple(e.value for e in ArticlePhotoSize)


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for attr in (*_EXISTING, *_NEW):
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine, prefix=prefix)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for attr in (*_EXISTING, *_NEW):
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
    """The tables this migration points at, with rows in them."""
    m = MIGRATION
    with engine.connect() as conn:
        for table in (m.ORGANIZATIONS, m.USERS):
            conn.exec_driver_sql(
                f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
            )
        for table in (m.MEMBERS, m.MEDIA, m.EVENTS, m.APPARATUS):
            conn.exec_driver_sql(
                f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, "
                "organization_id VARCHAR(36) NOT NULL) ENGINE=InnoDB"
            )
        conn.exec_driver_sql(
            f"CREATE TABLE {m.DOCUMENTS} (document_id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {m.ORGANIZATIONS} VALUES ('org')")
        for table, ids in (
            (m.MEMBERS, ("m1",)),
            (m.MEDIA, ("ph1", "ph2")),
            (m.EVENTS, ("ev1",)),
            (m.APPARATUS, ("a1",)),
        ):
            for row_id in ids:
                conn.exec_driver_sql(f"INSERT INTO {table} VALUES ('{row_id}', 'org')")
        conn.exec_driver_sql(f"INSERT INTO {m.DOCUMENTS} VALUES ('d1', 'org')")
        conn.commit()


def _tables(engine) -> set:
    with engine.connect() as conn:
        return set(sa.inspect(conn).get_table_names())


def _columns(engine, table) -> set:
    with engine.connect() as conn:
        return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _count(engine, table, where="1=1") -> int:
    with engine.connect() as conn:
        return conn.exec_driver_sql(
            f"SELECT COUNT(*) FROM {table} WHERE {where}"
        ).scalar_one()


def _execute(engine, *statements) -> None:
    with engine.connect() as conn:
        for statement in statements:
            conn.exec_driver_sql(statement)
        conn.commit()


def _article(engine) -> None:
    m = MIGRATION
    _execute(
        engine,
        f"INSERT INTO {m.ARTICLES} (id, organization_id, title, cover_media_id) "
        "VALUES ('ar1', 'org', 'The mill fire', 'ph1')",
        f"INSERT INTO {m.BLOCKS} (id, article_id, position, kind, html) "
        "VALUES ('b1', 'ar1', 0, 'text', '<p>It began at night.</p>')",
        f"INSERT INTO {m.BLOCKS} (id, article_id, position, kind, media_id, caption) "
        "VALUES ('b2', 'ar1', 1, 'photo', 'ph2', 'The ruins')",
        f"INSERT INTO {m.ARTICLE_MEMBERS} (article_id, member_id) VALUES ('ar1', 'm1')",
        f"INSERT INTO {m.ARTICLE_EVENTS} (article_id, event_id) VALUES ('ar1', 'ev1')",
        f"INSERT INTO {m.ARTICLE_APPARATUS} (article_id, apparatus_id) "
        "VALUES ('ar1', 'a1')",
        f"INSERT INTO {m.ARTICLE_DOCUMENTS} (article_id, document_id) "
        "VALUES ('ar1', 'd1')",
    )


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_upgrade_downgrade_upgrade_and_reruns(self, scratch):
        _existing(scratch.engine)
        m = MIGRATION
        new_tables = {getattr(m, attr) for attr in _NEW}
        _run(scratch.engine, m.upgrade)
        _run(scratch.engine, m.upgrade)
        assert new_tables <= _tables(scratch.engine)
        _article(scratch.engine)
        _run(scratch.engine, m.downgrade)
        _run(scratch.engine, m.downgrade)
        assert not new_tables & _tables(scratch.engine)
        # What an article pointed at is not the article's to take.
        assert _count(scratch.engine, m.MEDIA) == 2
        assert _count(scratch.engine, m.EVENTS) == 1
        assert _count(scratch.engine, m.MEMBERS) == 1
        assert _count(scratch.engine, m.DOCUMENTS) == 1
        _run(scratch.engine, m.upgrade)
        assert new_tables <= _tables(scratch.engine)

    def test_the_tables_have_every_column_their_models_map(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        for table, model in (
            (m.ARTICLES, HistoryArticle),
            (m.BLOCKS, HistoryArticleBlock),
            (m.ARTICLE_MEMBERS, HistoryArticleMember),
            (m.ARTICLE_EVENTS, HistoryArticleEvent),
            (m.ARTICLE_APPARATUS, HistoryArticleApparatus),
            (m.ARTICLE_DOCUMENTS, HistoryArticleDocument),
        ):
            assert _columns(scratch.engine, table) == {
                c.name for c in model.__table__.columns
            }

    def test_deleting_an_article_takes_its_blocks_and_links(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        _article(scratch.engine)
        _execute(scratch.engine, f"DELETE FROM {m.ARTICLES} WHERE id = 'ar1'")
        for table in (
            m.BLOCKS,
            m.ARTICLE_MEMBERS,
            m.ARTICLE_EVENTS,
            m.ARTICLE_APPARATUS,
            m.ARTICLE_DOCUMENTS,
        ):
            assert _count(scratch.engine, table) == 0
        assert _count(scratch.engine, m.MEDIA) == 2

    def test_deleting_a_photo_keeps_its_block_and_clears_the_cover(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        _article(scratch.engine)
        _execute(
            scratch.engine,
            f"DELETE FROM {m.MEDIA} WHERE id IN ('ph1', 'ph2')",
        )
        assert _count(scratch.engine, m.ARTICLES, "cover_media_id IS NULL") == 1
        assert _count(scratch.engine, m.BLOCKS) == 2
        assert _count(scratch.engine, m.BLOCKS, "media_id IS NULL") == 2

    def test_one_block_per_position(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        _article(scratch.engine)
        with pytest.raises(sa.exc.IntegrityError):
            _execute(
                scratch.engine,
                f"INSERT INTO {m.BLOCKS} (id, article_id, position, kind, html) "
                "VALUES ('b3', 'ar1', 1, 'text', '<p>Clash</p>')",
            )

    def test_a_text_block_holds_more_than_text_does(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        _article(scratch.engine)
        long_html = "<p>" + "a" * 90_000 + "</p>"
        with scratch.engine.connect() as conn:
            conn.execute(
                sa.text(f"UPDATE {m.BLOCKS} SET html = :html WHERE id = 'b1'"),
                {"html": long_html},
            )
            conn.commit()
            stored = conn.exec_driver_sql(
                f"SELECT LENGTH(html) FROM {m.BLOCKS} WHERE id = 'b1'"
            ).scalar_one()
        assert stored == len(long_html)
