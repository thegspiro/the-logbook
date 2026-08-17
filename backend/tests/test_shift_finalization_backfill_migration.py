"""The legacy-shift finalization backfill, driven through a real Alembic context.

The member-hours report counts only finalized shifts, but is_finalized was
added (20260328_0100) with server_default="0" and no backfill — so every
shift worked before the finalization feature existed reads as zero hours.
The backfill marks pre-cutoff shifts finalized while leaving finalized_at
NULL; that NULL is what makes the downgrade exact, since the finalize
workflow always stamps finalized_at. These tests pin the cutoff semantics,
idempotency, and the downgrade's precision.

SQLite is enough: the migration inspects table names and issues a plain
UPDATE with COALESCE, nothing dialect-specific. Datetimes are seeded naive
(they are UTC everywhere in this schema) so SQLite's lexical datetime
comparison matches MySQL's.
"""

import importlib.util
from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

# Located by suffix, not by full filename: the date prefix gets renumbered
# whenever main lands a migration claiming this one's revision id or parent.
_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_backfill_legacy_shift_finalization.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"
MIGRATION = _MATCHES[0]

# The finalization feature shipped 2026-03-28 (revision 20260328_0100).
BEFORE_CUTOFF = datetime(2026, 3, 27, 18, 0)
AFTER_CUTOFF = datetime(2026, 4, 2, 6, 0)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "backfill_legacy_shift_finalization", MIGRATION
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _shifts_table(metadata: sa.MetaData) -> sa.Table:
    """The subset of the real table the migration touches."""
    return sa.Table(
        "shifts",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("start_time", sa.DateTime()),
        sa.Column("end_time", sa.DateTime()),
        sa.Column("is_finalized", sa.Boolean(), nullable=False, default=False),
        sa.Column("finalized_at", sa.DateTime(), nullable=True),
    )


@pytest.fixture
def engine():
    return sa.create_engine("sqlite://")


@pytest.fixture
def shifts(engine):
    metadata = sa.MetaData()
    table = _shifts_table(metadata)
    table.create(engine)
    return table


def _seed(engine, table, rows):
    with engine.begin() as conn:
        for row in rows:
            conn.execute(table.insert().values(**row))


def _run(engine, direction: str):
    module = _load_migration()
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(module, direction)()
        conn.commit()


def _shift(engine, shift_id: str):
    with engine.connect() as conn:
        return conn.execute(
            sa.text("SELECT is_finalized, finalized_at FROM shifts WHERE id = :id"),
            {"id": shift_id},
        ).one()


class TestUpgrade:
    def test_is_a_no_op_when_the_table_does_not_exist(self, engine):
        """shifts can be model-only on fresh installs; create_all runs later."""
        _run(engine, "upgrade")

        assert not sa.inspect(engine).has_table("shifts")

    def test_finalizes_a_shift_that_ended_before_the_cutoff(self, engine, shifts):
        _seed(
            engine,
            shifts,
            [
                {
                    "id": "s1",
                    "start_time": datetime(2026, 3, 27, 6, 0),
                    "end_time": BEFORE_CUTOFF,
                    "is_finalized": False,
                }
            ],
        )

        _run(engine, "upgrade")

        row = _shift(engine, "s1")
        assert row.is_finalized
        # finalized_at stays NULL: no officer closed this shift, and the NULL
        # is what lets downgrade() identify backfilled rows.
        assert row.finalized_at is None

    def test_falls_back_to_start_time_when_end_time_is_null(self, engine, shifts):
        _seed(
            engine,
            shifts,
            [
                {
                    "id": "s1",
                    "start_time": BEFORE_CUTOFF,
                    "end_time": None,
                    "is_finalized": False,
                }
            ],
        )

        _run(engine, "upgrade")

        assert _shift(engine, "s1").is_finalized

    def test_leaves_post_cutoff_shifts_for_the_workflow(self, engine, shifts):
        _seed(
            engine,
            shifts,
            [
                {
                    "id": "s1",
                    "start_time": datetime(2026, 4, 1, 18, 0),
                    "end_time": AFTER_CUTOFF,
                    "is_finalized": False,
                }
            ],
        )

        _run(engine, "upgrade")

        assert not _shift(engine, "s1").is_finalized

    def test_is_idempotent(self, engine, shifts):
        _seed(
            engine,
            shifts,
            [
                {
                    "id": "s1",
                    "start_time": datetime(2026, 3, 27, 6, 0),
                    "end_time": BEFORE_CUTOFF,
                    "is_finalized": False,
                }
            ],
        )

        _run(engine, "upgrade")
        _run(engine, "upgrade")

        row = _shift(engine, "s1")
        assert row.is_finalized
        assert row.finalized_at is None


class TestDowngrade:
    def test_is_a_no_op_when_the_table_does_not_exist(self, engine):
        _run(engine, "downgrade")

        assert not sa.inspect(engine).has_table("shifts")

    def test_reverts_exactly_the_rows_the_upgrade_touched(self, engine, shifts):
        _seed(
            engine,
            shifts,
            [
                {
                    "id": "backfilled",
                    "start_time": datetime(2026, 3, 27, 6, 0),
                    "end_time": BEFORE_CUTOFF,
                    "is_finalized": False,
                }
            ],
        )
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert not _shift(engine, "backfilled").is_finalized

    def test_keeps_workflow_finalized_shifts(self, engine, shifts):
        """finalize_shift always stamps finalized_at, so a pre-cutoff shift an
        officer finalized (e.g. between introduction and this backfill via a
        manual correction) survives the rollback."""
        _seed(
            engine,
            shifts,
            [
                {
                    "id": "officer_closed",
                    "start_time": datetime(2026, 3, 27, 6, 0),
                    "end_time": BEFORE_CUTOFF,
                    "is_finalized": True,
                    "finalized_at": datetime(2026, 3, 29, 8, 0),
                }
            ],
        )

        _run(engine, "downgrade")

        assert _shift(engine, "officer_closed").is_finalized

    def test_keeps_post_cutoff_finalized_shifts(self, engine, shifts):
        _seed(
            engine,
            shifts,
            [
                {
                    "id": "recent",
                    "start_time": datetime(2026, 4, 1, 18, 0),
                    "end_time": AFTER_CUTOFF,
                    "is_finalized": True,
                    "finalized_at": datetime(2026, 4, 2, 7, 0),
                }
            ],
        )

        _run(engine, "downgrade")

        assert _shift(engine, "recent").is_finalized
