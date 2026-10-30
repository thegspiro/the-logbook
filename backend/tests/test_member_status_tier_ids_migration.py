"""Migration c4d7e2a91b60: ``member_status`` widened to hold membership tier ids.

Run against a real (SQLite) connection. The rows that matter are the ones CI's
empty database never has (pitfall #35): a member on a department tier whose
ladder column is NULL or stale, a member the earlier split already settled, and
a tier id longer than the old column.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_c4d7e2a91b60_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

LONG_TIER = "distinguished_service_member_x"  # 30 characters


def _migration():
    spec = importlib.util.spec_from_file_location("tier_ids", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("membership_type", sa.String(50)),
        sa.Column("member_class", sa.String(20)),
        sa.Column("member_status", sa.String(20)),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _seed(engine):
    rows = [
        ("senior-null", "senior", None, None),
        ("senior-stale", "senior", "operational", "regular"),
        ("senior-admin", "senior", "administrative", "regular"),
        ("already", "senior", "operational", "senior"),
        ("regular", "active", "operational", "regular"),
        ("administrative", "administrative", "administrative", "regular"),
        ("spaced", " Senior ", "operational", "regular"),
        ("blank", "", None, None),
        ("none", None, None, None),
    ]
    with engine.begin() as conn:
        for row in rows:
            conn.execute(
                sa.text(
                    "INSERT INTO users (id, membership_type, member_class, "
                    "member_status) VALUES (:id, :type, :cls, :status)"
                ),
                {"id": row[0], "type": row[1], "cls": row[2], "status": row[3]},
            )


def _rows(engine):
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT id, member_class, member_status FROM users ORDER BY id")
        ).all()
    return {row[0]: (row[1], row[2]) for row in rows}


def test_upgrade_settles_tier_members_onto_their_tier(engine):
    _seed(engine)
    _run(engine)
    after = _rows(engine)
    # The tier id lands on the ladder column; the class is never touched.
    assert after["senior-null"] == (None, "senior")
    assert after["senior-stale"] == ("operational", "senior")
    assert after["senior-admin"] == ("administrative", "senior")
    assert after["already"] == ("operational", "senior")
    assert after["spaced"] == ("operational", "senior")
    # The seven legacy words were settled by the split migration and stay.
    assert after["regular"] == ("operational", "regular")
    assert after["administrative"] == ("administrative", "regular")
    assert after["blank"] == (None, None)
    assert after["none"] == (None, None)


def test_the_widened_column_takes_a_long_tier_id(engine):
    _seed(engine)
    _run(engine)
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO users (id, membership_type, member_status) "
                "VALUES ('long', :tier, :tier)"
            ),
            {"tier": LONG_TIER},
        )
    assert _rows(engine)["long"] == (None, LONG_TIER)


def test_upgrade_is_safe_to_run_twice(engine):
    _seed(engine)
    _run(engine)
    first = _rows(engine)
    _run(engine)
    assert _rows(engine) == first


def test_downgrade_narrows_and_nulls_only_what_would_not_fit(engine):
    _seed(engine)
    _run(engine)
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO users (id, membership_type, member_status) "
                "VALUES ('long', :tier, :tier)"
            ),
            {"tier": LONG_TIER},
        )
    _run(engine, "downgrade")
    after = _rows(engine)
    assert after["long"] == (None, None)
    # A tier id that fits is kept: it is exactly what the legacy column holds.
    assert after["senior-null"] == (None, "senior")
    assert after["regular"] == ("operational", "regular")
