"""Migration 7d2b4e8a1c35: switch on the Compliance boxes seeded inactive.

Run against a real (SQLite) connection. What matters is which boxes it leaves
alone: a department's own box, a seeded box an administrator has saved, and a
seeded box nobody can read.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_7d2b4e8a1c35_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"
SEED_MATCHES = sorted(VERSIONS.glob("*_3c918c06466d_*.py"))
assert len(SEED_MATCHES) == 1, f"expected exactly one seed, found {SEED_MATCHES}"

SEEDED_AT = "2026-09-24 19:30:00"
EDITED_AT = "2026-09-24 19:45:00"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _migration():
    return _load(MATCHES[0], "activate_compliance_boxes")


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "suggestion_boxes",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("name", sa.String),
        sa.Column("description", sa.Text),
        sa.Column("is_active", sa.Boolean),
        sa.Column("created_by", sa.String),
        sa.Column("created_at", sa.String),
        sa.Column("updated_at", sa.String),
    )
    sa.Table(
        "suggestion_box_reviewers",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("box_id", sa.String),
        sa.Column("position_id", sa.String),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _box(
    engine,
    box_id,
    *,
    active=False,
    description=None,
    created_by=None,
    updated_at=SEEDED_AT,
    reviewed=True,
):
    migration = _migration()
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO suggestion_boxes (id, organization_id, name, "
                "description, is_active, created_by, created_at, updated_at) "
                "VALUES (:i, :i, 'Compliance', :d, :a, :c, :created, :updated)"
            ),
            {
                "i": box_id,
                "d": description or migration._BOX_DESCRIPTION,
                "a": active,
                "c": created_by,
                "created": SEEDED_AT,
                "updated": updated_at,
            },
        )
        if reviewed:
            connection.execute(
                sa.text(
                    "INSERT INTO suggestion_box_reviewers (id, box_id, position_id) "
                    "VALUES (:r, :b, 'officer')"
                ),
                {"r": f"r-{box_id}", "b": box_id},
            )


def _active(engine, box_id) -> bool:
    with engine.begin() as connection:
        return bool(
            connection.execute(
                sa.text("SELECT is_active FROM suggestion_boxes WHERE id = :i"),
                {"i": box_id},
            ).scalar()
        )


def test_merges_both_heads_that_forked_from_941e1251ad74():
    assert set(_migration().down_revision) == {"3c918c06466d", "ced0061dedc8"}


def test_matches_what_the_seed_wrote():
    seed = _load(SEED_MATCHES[0], "seed_compliance")
    assert _migration()._BOX_NAME == seed._BOX["name"]
    assert _migration()._BOX_DESCRIPTION == seed._BOX["description"]


def test_switches_on_an_unedited_seeded_box(engine):
    _box(engine, "seeded")
    _run(engine)
    assert _active(engine, "seeded")


def test_is_idempotent(engine):
    _box(engine, "seeded")
    _run(engine)
    _run(engine)
    assert _active(engine, "seeded")


def test_leaves_a_box_an_administrator_has_saved(engine):
    _box(engine, "saved", updated_at=EDITED_AT)
    _run(engine)
    assert not _active(engine, "saved")


def test_leaves_a_departments_own_box(engine):
    _box(engine, "theirs", created_by="admin")
    _box(engine, "reworded", description="Our own wording")
    _run(engine)
    assert not _active(engine, "theirs")
    assert not _active(engine, "reworded")


def test_never_opens_a_box_nobody_can_read(engine):
    _box(engine, "unread", reviewed=False)
    _run(engine)
    assert not _active(engine, "unread")


def test_downgrade_switches_off_only_the_unedited_seed(engine):
    _box(engine, "seeded")
    _box(engine, "saved", active=True, updated_at=EDITED_AT)
    _box(engine, "theirs", active=True, created_by="admin")
    _run(engine)
    _run(engine, "downgrade")
    assert not _active(engine, "seeded")
    assert _active(engine, "saved")
    assert _active(engine, "theirs")
