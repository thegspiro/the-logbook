"""Migration bd8fc0c4a941: training-record match keys, and the fallback types'
name-match cut-off, against tables that already hold rows (pitfall #35).

The DDL autocommits, so the migration runs against throwaway copies of the two
tables under a prefix in the suite's own database; the real tables are never
altered. The module's table names are pointed at the scratch copies.
"""

import importlib.util
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

from app.utils.training_match_key import training_match_key

pytestmark = [pytest.mark.integration]

_REVISION = "bd8fc0c4a941"
_RECORDS = "matchkeymig_training_records"
_REQUIREMENTS = "matchkeymig_training_requirements"
_OLD_CUTOFF = date(2026, 10, 5)

_RECORD_ROWS = [
    # id, course_name, certification_number
    ("rec-recased", "C.P.R.", None),
    ("rec-code", "Firefighter I Academy", "NFPA-1001-0042"),
    ("rec-unicode", "STRAßE Rescue", "İSTANBUL-7"),
    ("rec-unkeyable", " -- ", "  "),
]
_REQUIREMENT_ROWS = [
    # id, requirement_type, name_match_until
    ("req-cert", "certification", _OLD_CUTOFF),
    ("req-hours", "hours", _OLD_CUTOFF),
    ("req-skills-old", "skills_evaluation", _OLD_CUTOFF),
    ("req-checklist-new", "checklist", None),
    ("req-test", "knowledge_test", _OLD_CUTOFF),
]


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("match_keys", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop(conn) -> None:
    conn.execute(text(f"DROP TABLE IF EXISTS {_RECORDS}"))
    conn.execute(text(f"DROP TABLE IF EXISTS {_REQUIREMENTS}"))


@pytest.fixture
def engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        _drop(conn)
    yield engine
    with engine.begin() as conn:
        _drop(conn)
    engine.dispose()


@pytest.fixture
def scratch(engine):
    """Pre-revision copies of both tables, with rows in them."""
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_RECORDS} (id VARCHAR(36) PRIMARY KEY, "
                "user_id VARCHAR(36) NOT NULL DEFAULT 'member', "
                "course_name VARCHAR(255) NOT NULL, "
                "certification_number VARCHAR(100) NULL) "
                "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {_REQUIREMENTS} (id VARCHAR(36) PRIMARY KEY, "
                "requirement_type VARCHAR(30) NOT NULL, "
                "name_match_until DATE NULL) "
                "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {_RECORDS} (id, course_name, certification_number) "
                "VALUES (:id, :name, :number)"
            ),
            [{"id": i, "name": n, "number": c} for i, n, c in _RECORD_ROWS],
        )
        conn.execute(
            text(f"INSERT INTO {_REQUIREMENTS} VALUES (:id, :type, :until)"),
            [{"id": i, "type": t, "until": u} for i, t, u in _REQUIREMENT_ROWS],
        )
    return engine


def _run(engine, step: str) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.RECORDS_TABLE = _RECORDS
    module.REQUIREMENTS_TABLE = _REQUIREMENTS
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _keys(engine) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT id, match_key, certification_key FROM {_RECORDS}")
        ).all()
    return {r.id: (r.match_key, r.certification_key) for r in rows}


def _cutoffs(engine) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT id, name_match_until FROM {_REQUIREMENTS}")
        ).all()
    return {r.id: r.name_match_until for r in rows}


def test_the_revision_targets_the_real_tables():
    module = _load_migration()
    assert module.RECORDS_TABLE == "training_records"
    assert module.REQUIREMENTS_TABLE == "training_requirements"


def test_the_frozen_normalization_still_agrees_with_the_helper():
    # Not a requirement forever — the helper may change and the migration must
    # not — but a change to the helper means stored keys and new keys differ,
    # which needs its own re-keying migration. This test says so the day it
    # happens.
    module = _load_migration()
    for _, name, number in _RECORD_ROWS:
        assert module._key(name) == training_match_key(name)
        assert module._key(number) == training_match_key(number)


def test_upgrade_keys_every_existing_record(scratch):
    _run(scratch, "upgrade")

    assert _keys(scratch) == {
        "rec-recased": ("cpr", None),
        "rec-code": ("firefighteriacademy", "nfpa10010042"),
        "rec-unicode": ("strasserescue", "istanbul7"),
        # No letter or digit: nothing to key, so the record can match only by
        # linked course or training type.
        "rec-unkeyable": (None, None),
    }
    indexes = {
        ix["name"]: ix["column_names"]
        for ix in sa.inspect(scratch).get_indexes(_RECORDS)
    }
    assert indexes["idx_record_user_match_key"] == ["user_id", "match_key"]
    assert indexes["idx_record_user_certification_key"] == [
        "user_id",
        "certification_key",
    ]


def test_upgrade_moves_the_fallback_cutoff_to_today_and_leaves_the_rest(scratch):
    _run(scratch, "upgrade")

    today = datetime.now(timezone.utc).date()
    assert _cutoffs(scratch) == {
        "req-cert": _OLD_CUTOFF,
        "req-hours": _OLD_CUTOFF,
        "req-skills-old": today,
        "req-checklist-new": today,
        "req-test": today,
    }


def test_a_second_upgrade_keeps_keys_already_written(scratch):
    _run(scratch, "upgrade")
    with scratch.begin() as conn:
        conn.execute(
            text(f"UPDATE {_RECORDS} SET match_key = 'kept' WHERE id = 'rec-code'")
        )

    _run(scratch, "upgrade")

    assert _keys(scratch)["rec-code"] == ("kept", "nfpa10010042")


def test_downgrade_drops_the_keys_and_keeps_the_rows(scratch):
    _run(scratch, "upgrade")
    _run(scratch, "downgrade")

    columns = {c["name"] for c in sa.inspect(scratch).get_columns(_RECORDS)}
    assert {"match_key", "certification_key"}.isdisjoint(columns)
    with scratch.connect() as conn:
        assert conn.execute(text(f"SELECT COUNT(*) FROM {_RECORDS}")).scalar() == 4

    _run(scratch, "downgrade")


def test_missing_tables_are_skipped_both_ways(engine):
    _run(engine, "upgrade")
    _run(engine, "downgrade")
    tables = set(sa.inspect(engine).get_table_names())
    assert {_RECORDS, _REQUIREMENTS}.isdisjoint(tables)
