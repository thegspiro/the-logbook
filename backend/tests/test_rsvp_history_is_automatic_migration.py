"""The rsvp_history.is_automatic migration (W19-3), through a real Alembic context.

SQLite is enough: the migration only inspects table and column names and adds
or drops one boolean column, nothing dialect-specific. ``rsvp_history`` is
built by ``create_all`` and by no migration, so the absent-table case is the
one CI's empty-database upgrade actually takes.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

# Located by suffix, not by full filename: the date prefix can be renumbered
# when the chain is re-parented.
_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_rsvp_history_is_automatic.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"
MIGRATION = _MATCHES[0]


def _run(engine, direction: str) -> None:
    spec = importlib.util.spec_from_file_location(
        "rsvp_history_is_automatic", MIGRATION
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(module, direction)()
        conn.commit()


def _columns(engine) -> set:
    return {c["name"] for c in sa.inspect(engine).get_columns("rsvp_history")}


@pytest.fixture
def engine():
    return sa.create_engine("sqlite://")


@pytest.fixture
def history(engine):
    metadata = sa.MetaData()
    table = sa.Table(
        "rsvp_history",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("old_status", sa.String(20)),
        sa.Column("new_status", sa.String(20), nullable=False),
        sa.Column("changed_by", sa.String(36)),
    )
    metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(table.insert().values(id="h1", new_status="going"))
    return table


def test_is_a_no_op_when_the_table_does_not_exist(engine):
    _run(engine, "upgrade")
    assert not sa.inspect(engine).has_table("rsvp_history")
    _run(engine, "downgrade")


def test_existing_rows_read_as_not_automatic(engine, history):
    _run(engine, "upgrade")

    assert "is_automatic" in _columns(engine)
    with engine.connect() as conn:
        value = conn.execute(
            sa.text("SELECT is_automatic FROM rsvp_history WHERE id = 'h1'")
        ).scalar_one()
    assert not value


def test_rerun_is_a_no_op(engine, history):
    _run(engine, "upgrade")
    _run(engine, "upgrade")
    assert "is_automatic" in _columns(engine)


def test_downgrade_drops_only_the_column(engine, history):
    _run(engine, "upgrade")
    _run(engine, "downgrade")

    assert "is_automatic" not in _columns(engine)
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM rsvp_history")).scalar() == 1
    _run(engine, "downgrade")
