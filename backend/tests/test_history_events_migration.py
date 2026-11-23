"""``9cce83b31c70`` adds History events, apparatus and the timeline columns.

Run for real against MySQL/MariaDB on uniquely prefixed scratch tables in the
test database (DDL cannot ride in a rolled-back transaction; the pattern of
``test_history_documents_migration.py``). Pinned:

* existing title and title-held rows survive, and the new columns settle
  them by their defaults: no title is on the timeline and no held title has
  dates (pitfall #35: the migration meets rows that exist);
* upgrade, downgrade, upgrade, and a re-run of either step changes nothing;
* deleting an event or apparatus takes its links with it; deleting a fleet
  truck clears the History record's pointer and keeps the record;
* one History record per fleet truck;
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
    ApparatusDisposition,
    HistoricalMemberPeriodTitle,
    HistoryApparatus,
    HistoryApparatusDesignation,
    HistoryApparatusType,
    HistoryDocumentApparatusTag,
    HistoryEvent,
    HistoryEventApparatus,
    HistoryEventDocument,
    HistoryEventMedia,
    HistoryEventMember,
    HistoryEventType,
    HistoryMediaApparatusTag,
    HistoryStation,
    HistoryTitle,
)

_PATH = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_9cce83b31c70_*.py"
    )
)


def _migration():
    spec = importlib.util.spec_from_file_location("_history_events", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_PREFIXED = (
    "ORGANIZATIONS",
    "USERS",
    "FLEET",
    "MEMBERS",
    "SOURCES",
    "MEDIA",
    "DOCUMENTS",
    "TITLES",
    "PERIOD_TITLES",
    "STATIONS",
    "APPARATUS_TYPES",
    "EVENT_TYPES",
    "APPARATUS",
    "DESIGNATIONS",
    "EVENTS",
    "EVENT_MEMBERS",
    "EVENT_APPARATUS",
    "EVENT_MEDIA",
    "EVENT_DOCUMENTS",
    "MEDIA_APPARATUS",
    "DOCUMENT_APPARATUS",
)
_NEW = (
    "STATIONS",
    "APPARATUS_TYPES",
    "EVENT_TYPES",
    "APPARATUS",
    "DESIGNATIONS",
    "EVENTS",
    "EVENT_MEMBERS",
    "EVENT_APPARATUS",
    "EVENT_MEDIA",
    "EVENT_DOCUMENTS",
    "MEDIA_APPARATUS",
    "DOCUMENT_APPARATUS",
)


def _index_names(model) -> set:
    return {i.name for i in model.__table__.indexes}


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_table_names(self):
        m = MIGRATION
        pairs = {
            m.STATIONS: HistoryStation,
            m.APPARATUS_TYPES: HistoryApparatusType,
            m.EVENT_TYPES: HistoryEventType,
            m.APPARATUS: HistoryApparatus,
            m.DESIGNATIONS: HistoryApparatusDesignation,
            m.EVENTS: HistoryEvent,
            m.EVENT_MEMBERS: HistoryEventMember,
            m.EVENT_APPARATUS: HistoryEventApparatus,
            m.EVENT_MEDIA: HistoryEventMedia,
            m.EVENT_DOCUMENTS: HistoryEventDocument,
            m.MEDIA_APPARATUS: HistoryMediaApparatusTag,
            m.DOCUMENT_APPARATUS: HistoryDocumentApparatusTag,
            m.TITLES: HistoryTitle,
            m.PERIOD_TITLES: HistoricalMemberPeriodTitle,
        }
        for table, model in pairs.items():
            assert table == model.__tablename__

    def test_index_names(self):
        m = MIGRATION
        assert _index_names(HistoryApparatus) == {
            m.IX_APPARATUS_ORG_LEVEL,
            m.IX_APPARATUS_ORG_TYPE,
            m.IX_APPARATUS_ORG_IN_SERVICE,
            m.IX_APPARATUS_SOURCE,
        }
        assert _index_names(HistoryApparatusDesignation) == {
            m.IX_DESIGNATIONS_APPARATUS,
            m.IX_DESIGNATIONS_STATION,
        }
        assert _index_names(HistoryEvent) == {
            m.IX_EVENTS_ORG_LEVEL,
            m.IX_EVENTS_ORG_START,
            m.IX_EVENTS_ORG_TYPE,
            m.IX_EVENTS_STATION,
            m.IX_EVENTS_SOURCE,
        }
        assert _index_names(HistoryEventMember) == {m.IX_EVENT_MEMBERS_MEMBER}
        assert _index_names(HistoryEventApparatus) == {m.IX_EVENT_APPARATUS_APPARATUS}
        assert _index_names(HistoryEventMedia) == {m.IX_EVENT_MEDIA_MEDIA}
        assert _index_names(HistoryEventDocument) == {m.IX_EVENT_DOCUMENTS_DOCUMENT}
        assert _index_names(HistoryMediaApparatusTag) == {
            m.IX_MEDIA_APPARATUS_APPARATUS
        }
        assert _index_names(HistoryDocumentApparatusTag) == {
            m.IX_DOCUMENT_APPARATUS_APPARATUS
        }

    def test_the_added_columns_are_the_models(self):
        assert set(MIGRATION.TITLE_COLUMNS) <= {
            c.name for c in HistoryTitle.__table__.columns
        }
        assert set(MIGRATION.PERIOD_TITLE_COLUMNS) <= {
            c.name for c in HistoricalMemberPeriodTitle.__table__.columns
        }

    def test_the_enum_is_a_frozen_copy_of_the_model(self):
        assert MIGRATION._DISPOSITION == tuple(e.value for e in ApparatusDisposition)


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
    """The tables this migration points at or alters, with rows in them."""
    m = MIGRATION
    with engine.connect() as conn:
        for table in (m.ORGANIZATIONS, m.USERS):
            conn.exec_driver_sql(
                f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
            )
        for table in (m.FLEET, m.MEMBERS, m.SOURCES, m.MEDIA, m.TITLES):
            conn.exec_driver_sql(
                f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, "
                "organization_id VARCHAR(36) NOT NULL, name VARCHAR(150) NOT NULL) "
                "ENGINE=InnoDB"
            )
        conn.exec_driver_sql(
            f"CREATE TABLE {m.DOCUMENTS} (document_id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE {m.PERIOD_TITLES} (period_id VARCHAR(36) NOT NULL, "
            f"title_id VARCHAR(36) NOT NULL REFERENCES {m.TITLES} (id), "
            "PRIMARY KEY (period_id, title_id)) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(f"INSERT INTO {m.ORGANIZATIONS} VALUES ('org')")
        conn.exec_driver_sql(
            f"INSERT INTO {m.TITLES} VALUES ('chief', 'org', 'Chief'), "
            "('capt', 'org', 'Captain')"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {m.PERIOD_TITLES} VALUES ('p1', 'chief'), ('p1', 'capt'), "
            "('p2', 'capt')"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {m.FLEET} VALUES ('e1', 'org', 'Engine 1'), "
            "('e2', 'org', 'Engine 2')"
        )
        conn.exec_driver_sql(f"INSERT INTO {m.MEMBERS} VALUES ('m1', 'org', 'Smith')")
        conn.exec_driver_sql(f"INSERT INTO {m.MEDIA} VALUES ('ph1', 'org', 'Parade')")
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


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_existing_rows_are_settled_by_the_defaults(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        assert _count(scratch.engine, m.TITLES) == 2
        assert _count(scratch.engine, m.TITLES, "show_on_timeline = 0") == 2
        assert _count(scratch.engine, m.PERIOD_TITLES) == 3
        # No held title is given dates it never had.
        assert (
            _count(
                scratch.engine,
                m.PERIOD_TITLES,
                "held_from_date IS NULL AND held_to_date IS NULL "
                "AND held_from_precision = 'year' AND held_to_precision = 'year' "
                "AND held_from_circa = 0 AND held_to_circa = 0",
            )
            == 3
        )

    def test_upgrade_downgrade_upgrade_and_reruns(self, scratch):
        _existing(scratch.engine)
        m = MIGRATION
        new_tables = {getattr(m, attr) for attr in _NEW}
        _run(scratch.engine, m.upgrade)
        _run(scratch.engine, m.upgrade)
        assert new_tables <= _tables(scratch.engine)
        assert set(m.PERIOD_TITLE_COLUMNS) <= _columns(scratch.engine, m.PERIOD_TITLES)
        _run(scratch.engine, m.downgrade)
        _run(scratch.engine, m.downgrade)
        assert not new_tables & _tables(scratch.engine)
        assert not set(m.PERIOD_TITLE_COLUMNS) & _columns(
            scratch.engine, m.PERIOD_TITLES
        )
        assert "show_on_timeline" not in _columns(scratch.engine, m.TITLES)
        assert _count(scratch.engine, m.PERIOD_TITLES) == 3
        _run(scratch.engine, m.upgrade)
        assert new_tables <= _tables(scratch.engine)

    def test_the_records_have_every_column_their_models_map(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        for table, model in (
            (m.APPARATUS, HistoryApparatus),
            (m.EVENTS, HistoryEvent),
            (m.DESIGNATIONS, HistoryApparatusDesignation),
        ):
            assert _columns(scratch.engine, table) == {
                c.name for c in model.__table__.columns
            }

    def test_deleting_an_event_or_apparatus_takes_its_links(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        _execute(
            scratch.engine,
            f"INSERT INTO {m.APPARATUS} (id, organization_id, name) "
            "VALUES ('a1', 'org', 'Old pumper')",
            f"INSERT INTO {m.DESIGNATIONS} (id, apparatus_id, designation) "
            "VALUES ('g1', 'a1', 'Engine 1')",
            f"INSERT INTO {m.EVENTS} (id, organization_id, title, start_date) "
            "VALUES ('ev1', 'org', 'Mill fire', '1911-01-01')",
            f"INSERT INTO {m.EVENT_MEMBERS} (event_id, member_id, role) "
            "VALUES ('ev1', 'm1', 'commanded')",
            f"INSERT INTO {m.EVENT_APPARATUS} (event_id, apparatus_id) "
            "VALUES ('ev1', 'a1')",
            f"INSERT INTO {m.EVENT_MEDIA} (event_id, media_id) VALUES ('ev1', 'ph1')",
            f"INSERT INTO {m.EVENT_DOCUMENTS} (event_id, document_id) "
            "VALUES ('ev1', 'd1')",
            f"INSERT INTO {m.MEDIA_APPARATUS} (media_id, apparatus_id) "
            "VALUES ('ph1', 'a1')",
            f"INSERT INTO {m.DOCUMENT_APPARATUS} (document_id, apparatus_id) "
            "VALUES ('d1', 'a1')",
            f"DELETE FROM {m.EVENTS} WHERE id = 'ev1'",
        )
        for table in (m.EVENT_MEMBERS, m.EVENT_APPARATUS, m.EVENT_MEDIA):
            assert _count(scratch.engine, table) == 0
        assert _count(scratch.engine, m.EVENT_DOCUMENTS) == 0
        # The photo, document and person an event pointed at stay.
        assert _count(scratch.engine, m.MEDIA) == 1
        assert _count(scratch.engine, m.DOCUMENTS) == 1
        assert _count(scratch.engine, m.MEMBERS) == 1
        _execute(scratch.engine, f"DELETE FROM {m.APPARATUS} WHERE id = 'a1'")
        for table in (m.DESIGNATIONS, m.MEDIA_APPARATUS, m.DOCUMENT_APPARATUS):
            assert _count(scratch.engine, table) == 0

    def test_a_deleted_fleet_truck_leaves_its_history_record(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        _execute(
            scratch.engine,
            f"INSERT INTO {m.APPARATUS} (id, organization_id, name, "
            "fleet_apparatus_id) VALUES ('a1', 'org', 'Engine 1', 'e1')",
            f"DELETE FROM {m.FLEET} WHERE id = 'e1'",
        )
        assert _count(scratch.engine, m.APPARATUS, "fleet_apparatus_id IS NULL") == 1

    def test_one_history_record_per_fleet_truck(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        m = MIGRATION
        _execute(
            scratch.engine,
            f"INSERT INTO {m.APPARATUS} (id, organization_id, name, "
            "fleet_apparatus_id) VALUES ('a1', 'org', 'Engine 2', 'e2')",
            # Records entered from scratch have no fleet truck and never clash.
            f"INSERT INTO {m.APPARATUS} (id, organization_id, name) "
            "VALUES ('a2', 'org', 'Hand pumper'), ('a3', 'org', 'Steamer')",
        )
        with pytest.raises(sa.exc.IntegrityError):
            _execute(
                scratch.engine,
                f"INSERT INTO {m.APPARATUS} (id, organization_id, name, "
                "fleet_apparatus_id) VALUES ('a4', 'org', 'Engine 2 again', 'e2')",
            )

    def test_an_event_needs_a_start_date(self, scratch):
        _existing(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        with pytest.raises(sa.exc.DBAPIError):
            _execute(
                scratch.engine,
                f"INSERT INTO {MIGRATION.EVENTS} (id, organization_id, title) "
                "VALUES ('ev1', 'org', 'Undated')",
            )
