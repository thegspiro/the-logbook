"""Migration c4ee38cd931c: ``pending`` external shifts and the open-swap ledger.

Run against throwaway tables in the suite's own database; the real tables are
never altered. The rows a department already has are the point (Pitfall #35):
every entry that counted before the upgrade must still count after it.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "c4ee38cd931c"
_ENTRIES = "x_appr_external_shift_hours"
_NOTICES = "x_appr_open_swap_notices"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("external_approval", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)

    def drop():
        with engine.begin() as conn:
            conn.execute(text(f"DROP TABLE IF EXISTS {_NOTICES}"))
            conn.execute(text(f"DROP TABLE IF EXISTS {_ENTRIES}"))

    drop()
    yield engine
    drop()
    engine.dispose()


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.ENTRIES = _ENTRIES
    module.NOTICES = _NOTICES
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _create_old_shape(engine, constraint_name: str):
    """The table as ``f03c9f236904`` left it: two states only."""
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_ENTRIES} ("
                "id VARCHAR(36) PRIMARY KEY, "
                "status VARCHAR(20) NOT NULL DEFAULT 'counted', "
                "rejection_reason TEXT NULL, "
                f"CONSTRAINT {constraint_name} "
                "CHECK (status IN ('counted', 'rejected')))"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {_ENTRIES} (id, status, rejection_reason) VALUES "
                "('c1', 'counted', NULL), ('c2', 'counted', NULL), "
                "('r1', 'rejected', 'Wrong date')"
            )
        )


def _rows(engine) -> dict:
    with engine.connect() as conn:
        return {
            r.id: (r.status, r.rejection_reason)
            for r in conn.execute(
                text(f"SELECT id, status, rejection_reason FROM {_ENTRIES}")
            )
        }


def _insert_status(engine, entry_id: str, status: str):
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO {_ENTRIES} (id, status) VALUES (:id, :status)"),
            {"id": entry_id, "status": status},
        )


def _insert_pending(engine):
    _insert_status(engine, "p1", "pending")


@pytest.mark.parametrize(
    "constraint_name",
    # The plain name a migration-built table carries, and the doubled one the
    # naming convention gives a create_all-built table.
    ["ck_x_appr_status", "ck_x_appr_ck_x_appr_status"],
)
class TestExternalShiftApprovalMigration:
    def test_existing_rows_keep_their_state_and_pending_becomes_legal(
        self, scratch_engine, constraint_name
    ):
        _create_old_shape(scratch_engine, constraint_name)
        with pytest.raises(sa.exc.DBAPIError):
            _insert_pending(scratch_engine)

        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")  # a re-run changes nothing

        assert _rows(scratch_engine) == {
            "c1": ("counted", None),
            "c2": ("counted", None),
            "r1": ("rejected", "Wrong date"),
        }
        _insert_pending(scratch_engine)
        with pytest.raises(sa.exc.DBAPIError):
            _insert_status(scratch_engine, "x", "bogus")
        names = {
            c["name"]
            for c in sa.inspect(scratch_engine).get_check_constraints(_ENTRIES)
        }
        assert constraint_name in names

    def test_downgrade_rejects_pending_rather_than_crediting_it(
        self, scratch_engine, constraint_name
    ):
        _create_old_shape(scratch_engine, constraint_name)
        _run(scratch_engine, "upgrade")
        _insert_pending(scratch_engine)

        _run(scratch_engine, "downgrade")

        rows = _rows(scratch_engine)
        assert rows["p1"][0] == "rejected"
        assert "never counted" in (rows["p1"][1] or "")
        assert rows["c1"] == ("counted", None)
        assert rows["r1"] == ("rejected", "Wrong date")
        with pytest.raises(sa.exc.DBAPIError):
            _insert_pending(scratch_engine)


def test_notice_ledger_is_created_and_dropped(scratch_engine):
    _run(scratch_engine, "upgrade")
    inspector = sa.inspect(scratch_engine)
    assert _NOTICES in inspector.get_table_names()
    uniques = inspector.get_unique_constraints(_NOTICES)
    assert any(
        u["column_names"] == ["offering_shift_id", "offered_by_id", "recipient_id"]
        for u in uniques
    )
    _run(scratch_engine, "downgrade")
    assert _NOTICES not in sa.inspect(scratch_engine).get_table_names()
