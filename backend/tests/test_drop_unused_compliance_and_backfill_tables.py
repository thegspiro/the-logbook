"""Migration d75ecbc15bae drops eight tables no code reads (owner, 2026-11-01).

Three are the bookkeeping the 2026-10-11 folder backfills kept so their
downgrades could move documents back; five are the compliance tables from
``20260201_0016`` that nothing under ``app/`` ever used. See "Upgraded and
Fresh Databases Still Differ" in ``docs/KNOWN_LIMITATIONS.md``.

CI's database user may not CREATE DATABASE, so the DB-backed tests run the
migration against prefixed copies of the eight tables in the suite's own
database; the real names are never touched.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

_REVISION = "d75ecbc15bae"
_PREFIX = "dropunusedmig_"

EIGHT = {
    "document_unfiled_backfill",
    "facility_document_refile_backfill",
    "facility_folder_tier_backfill",
    "compliance_policies",
    "policy_acknowledgments",
    "compliance_checklists",
    "checklist_submissions",
    "compliance_incidents",
}
_UNRELATED = _PREFIX + "documents"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("drop_unused_tables", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.unit
class TestWhatIsDropped:
    def test_the_migration_names_exactly_the_eight_tables(self):
        assert set(_load_migration().TABLES) == EIGHT

    def test_children_are_dropped_before_the_tables_they_reference(self):
        order = list(_load_migration().TABLES)
        assert order.index("policy_acknowledgments") < order.index(
            "compliance_policies"
        )
        assert order.index("checklist_submissions") < order.index(
            "compliance_checklists"
        )

    def test_no_model_declares_any_of_them(self):
        import main
        from app.core.database import Base

        main._import_all_models()
        assert EIGHT.isdisjoint(Base.metadata.tables)

    def test_startup_no_longer_recreates_the_compliance_tables(self):
        # main.py used to replay 20260201_0016 on every fresh install and on
        # every schema repair, which would have rebuilt the dropped tables.
        source = (Path(__file__).resolve().parents[1] / "main.py").read_text()
        assert "20260201_0016_create_compliance_tables" not in source
        for table in EIGHT:
            assert f'"{table}"' not in source


def _prefixed(module):
    module.TABLES = tuple(_PREFIX + name for name in module.TABLES)
    return module


def _run(engine, step: str) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _prefixed(_load_migration())
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _ours():
    # Children first, so a cleanup works whatever state a failed run left.
    return [_PREFIX + n for n in _load_migration().TABLES] + [_UNRELATED]


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)

    def _clean():
        with engine.begin() as conn:
            for name in _ours():
                conn.execute(text(f"DROP TABLE IF EXISTS {name}"))

    _clean()
    yield engine
    _clean()
    engine.dispose()


def _make_tables(engine) -> None:
    """The eight tables, the two foreign keys between them, a row in each."""
    p = _PREFIX
    with engine.begin() as conn:
        for name in sorted(EIGHT - {"policy_acknowledgments", "checklist_submissions"}):
            conn.execute(
                text(
                    f"CREATE TABLE {p}{name} (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
                )
            )
        for child, parent, column in (
            ("policy_acknowledgments", "compliance_policies", "policy_id"),
            ("checklist_submissions", "compliance_checklists", "checklist_id"),
        ):
            conn.execute(
                text(
                    f"CREATE TABLE {p}{child} (id VARCHAR(36) PRIMARY KEY, "
                    f"{column} VARCHAR(36) NOT NULL, "
                    f"FOREIGN KEY ({column}) REFERENCES {p}{parent} (id) "
                    "ON DELETE CASCADE) ENGINE=InnoDB"
                )
            )
        for name in sorted(EIGHT - {"policy_acknowledgments", "checklist_submissions"}):
            conn.execute(text(f"INSERT INTO {p}{name} (id) VALUES ('row-1')"))
        conn.execute(
            text(
                f"INSERT INTO {p}policy_acknowledgments (id, policy_id) "
                "VALUES ('row-1', 'row-1')"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {p}checklist_submissions (id, checklist_id) "
                "VALUES ('row-1', 'row-1')"
            )
        )
        conn.execute(text(f"CREATE TABLE {_UNRELATED} (id VARCHAR(36) PRIMARY KEY)"))
        conn.execute(text(f"INSERT INTO {_UNRELATED} (id) VALUES ('kept')"))


def _tables(engine) -> set:
    with engine.connect() as conn:
        return set(sa.inspect(conn).get_table_names())


@pytest.mark.integration
class TestDropOnADatabaseThatHasThem:
    def test_upgrade_drops_the_eight_and_nothing_else(self, scratch_engine):
        _make_tables(scratch_engine)
        before = _tables(scratch_engine)
        assert {_PREFIX + n for n in EIGHT} <= before

        _run(scratch_engine, "upgrade")

        after = _tables(scratch_engine)
        assert after == before - {_PREFIX + n for n in EIGHT}
        with scratch_engine.connect() as conn:
            kept = conn.execute(text(f"SELECT id FROM {_UNRELATED}")).scalars().all()
        assert kept == ["kept"]

    def test_a_second_upgrade_changes_nothing(self, scratch_engine):
        _make_tables(scratch_engine)
        _run(scratch_engine, "upgrade")
        first = _tables(scratch_engine)

        _run(scratch_engine, "upgrade")

        assert _tables(scratch_engine) == first

    def test_downgrade_does_not_bring_them_back(self, scratch_engine):
        _make_tables(scratch_engine)
        _run(scratch_engine, "upgrade")
        first = _tables(scratch_engine)

        _run(scratch_engine, "downgrade")

        assert _tables(scratch_engine) == first


@pytest.mark.integration
class TestDropOnADatabaseThatNeverHadThem:
    def test_upgrade_is_a_no_op(self, scratch_engine):
        before = _tables(scratch_engine)
        assert before.isdisjoint({_PREFIX + n for n in EIGHT})

        _run(scratch_engine, "upgrade")

        assert _tables(scratch_engine) == before
