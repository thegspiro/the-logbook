"""Migration 61e85742f52b: filed election results can be superseded.

Run against MySQL with rows present (CLAUDE.md Pitfall #35): the old unique pair
is swapped for one on the standing slot, every existing row has to keep its
slot, and a result filed before its election was rolled back from closed is
superseded from the election's own rollback record.

The DDL autocommits, so the migration runs against throwaway tables under a
prefix in the suite's own database; the real tables are never altered.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

pytestmark = [pytest.mark.integration]

_REVISION = "61e85742f52b"
_PREFIX = "elcormig_"
_USERS = _PREFIX + "users"
_ELECTIONS = _PREFIX + "elections"
_RESULTS = _PREFIX + "results"
_FK = _PREFIX + "superseded_by_fk"

_MINUTES = "minutes-1"
_PERFORMER = "user-officer"


def _rollback(when: str, *, reason: str, performer: str = _PERFORMER, frm="closed"):
    return {
        "timestamp": when,
        "performed_by": performer,
        "from_status": frm,
        "to_status": "open" if frm == "closed" else "draft",
        "reason": reason,
    }


# election id -> rollback history
_ELECTION_HISTORY = {
    # Rolled back after its result was filed: stale today.
    "e-stale": [_rollback("2026-10-20T15:30:00+00:00", reason="Miscounted ballots")],
    # Rolled back before the result was filed: the result is the re-run's.
    "e-refiled": [_rollback("2026-10-01T09:00:00+00:00", reason="Too early")],
    "e-clean": None,
    # Two rollbacks after filing, by a member since deleted: the first one dates
    # the correction, and the missing member is not referenced.
    "e-twice": [
        _rollback("2026-10-25T10:00:00+00:00", reason="Second", performer="user-gone"),
        _rollback("2026-10-21T10:00:00+00:00", reason="First", performer="user-gone"),
    ],
    # Rolled back from open to draft only: there was never a result to undo.
    "e-open-only": [
        _rollback("2026-10-21T10:00:00+00:00", reason="Draft again", frm="open")
    ],
}

# (row id, election id, filed at)
_ROWS = [
    ("r-stale", "e-stale", "2026-10-19 12:00:00"),
    ("r-refiled", "e-refiled", "2026-10-02 12:00:00"),
    ("r-clean", "e-clean", "2026-10-02 12:00:00"),
    ("r-twice", "e-twice", "2026-10-20 12:00:00"),
    ("r-open-only", "e-open-only", "2026-10-20 12:00:00"),
    # Its election was deleted (election_id SET NULL).
    ("r-orphan", None, "2026-10-20 12:00:00"),
]


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("election_correction", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop_scratch(conn) -> None:
    for table in (_RESULTS, _ELECTIONS, _USERS):
        conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


@pytest.fixture
def scratch():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        _drop_scratch(conn)
        conn.execute(text(f"CREATE TABLE {_USERS} (id VARCHAR(36) PRIMARY KEY)"))
        conn.execute(
            text(
                f"CREATE TABLE {_ELECTIONS} (id VARCHAR(36) PRIMARY KEY, "
                "rollback_history JSON NULL)"
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {_RESULTS} (id VARCHAR(36) PRIMARY KEY, "
                "minutes_id VARCHAR(36) NOT NULL, election_id VARCHAR(36) NULL, "
                "is_addendum TINYINT(1) NOT NULL DEFAULT 0, "
                "created_at DATETIME NOT NULL, "
                "CONSTRAINT uq_minutes_election_results_pair "
                "UNIQUE (minutes_id, election_id))"
            )
        )
        conn.execute(
            text(f"INSERT INTO {_USERS} (id) VALUES (:id)"), {"id": _PERFORMER}
        )
        for election_id, history in _ELECTION_HISTORY.items():
            conn.execute(
                text(
                    f"INSERT INTO {_ELECTIONS} (id, rollback_history) "
                    "VALUES (:id, :history)"
                ),
                {
                    "id": election_id,
                    "history": json.dumps(history) if history else None,
                },
            )
        for row_id, election_id, filed in _ROWS:
            conn.execute(
                text(
                    f"INSERT INTO {_RESULTS} (id, minutes_id, election_id, "
                    "created_at) VALUES (:id, :m, :e, :at)"
                ),
                {"id": row_id, "m": _MINUTES, "e": election_id, "at": filed},
            )
    yield engine
    with engine.begin() as conn:
        _drop_scratch(conn)
    engine.dispose()


def _run(engine, step: str) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.TABLE = _RESULTS
    module.ELECTIONS = _ELECTIONS
    module.USERS = _USERS
    module.SUPERSEDED_BY_FK = _FK
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _rows(engine) -> dict:
    with engine.connect() as conn:
        return {
            r.id: r
            for r in conn.execute(
                text(
                    "SELECT id, election_id, current_election_id, superseded_at, "
                    f"superseded_reason, superseded_by FROM {_RESULTS}"
                )
            )
        }


def _insert(engine, row_id: str, election_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {_RESULTS} (id, minutes_id, election_id, "
                "current_election_id, created_at) VALUES (:id, :m, :e, :e, NOW())"
            ),
            {"id": row_id, "m": _MINUTES, "e": election_id},
        )


class TestUpgrade:
    def test_a_result_filed_before_its_rollback_is_superseded_from_the_record(
        self, scratch
    ):
        _run(scratch, "upgrade")

        row = _rows(scratch)["r-stale"]
        assert row.current_election_id is None
        assert str(row.superseded_at) == "2026-10-20 15:30:00"
        assert row.superseded_reason == "Miscounted ballots"
        assert row.superseded_by == _PERFORMER

    def test_the_first_rollback_after_filing_dates_it_and_a_gone_member_is_not_named(
        self, scratch
    ):
        _run(scratch, "upgrade")

        row = _rows(scratch)["r-twice"]
        assert str(row.superseded_at) == "2026-10-21 10:00:00"
        assert row.superseded_reason == "First"
        assert row.superseded_by is None

    def test_every_other_result_keeps_its_standing_slot(self, scratch):
        _run(scratch, "upgrade")

        rows = _rows(scratch)
        for row_id in ("r-refiled", "r-clean", "r-open-only"):
            assert rows[row_id].current_election_id == rows[row_id].election_id
            assert rows[row_id].superseded_at is None
        assert rows["r-orphan"].current_election_id is None
        assert rows["r-orphan"].superseded_at is None

    def test_a_superseded_result_frees_the_slot_and_a_standing_one_does_not(
        self, scratch
    ):
        _run(scratch, "upgrade")

        _insert(scratch, "r-stale-rerun", "e-stale")
        with pytest.raises(IntegrityError):
            _insert(scratch, "r-clean-again", "e-clean")

    def test_running_it_twice_changes_nothing(self, scratch):
        _run(scratch, "upgrade")
        before = _rows(scratch)

        _run(scratch, "upgrade")

        assert _rows(scratch) == before


class TestDowngrade:
    def test_it_keeps_the_standing_result_and_restores_the_old_pair(self, scratch):
        _run(scratch, "upgrade")
        _insert(scratch, "r-stale-rerun", "e-stale")

        _run(scratch, "downgrade")

        with scratch.connect() as conn:
            ids = set(conn.execute(text(f"SELECT id FROM {_RESULTS}")).scalars())
            columns = {c["name"] for c in sa.inspect(conn).get_columns(_RESULTS)}
        assert "r-stale" not in ids
        assert {"r-stale-rerun", "r-twice", "r-clean"} <= ids
        assert "current_election_id" not in columns
        assert "superseded_at" not in columns
        with pytest.raises(IntegrityError), scratch.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO {_RESULTS} (id, minutes_id, election_id, "
                    "created_at) VALUES ('dup', :m, 'e-clean', NOW())"
                ),
                {"m": _MINUTES},
            )
