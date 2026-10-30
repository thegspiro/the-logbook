"""Migration d8f1a4c27b93: ``positions.kind`` and the seeded committees.

Run against a real (SQLite) connection, with the rows CI's empty database
never has (pitfall #35): a department's own position that shares a seeded
slug, an organization that already holds one of the committees, and a
committee somebody is serving on when the migration is reversed.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_d8f1a4c27b93_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

COMMITTEES = {
    "community_outreach_team",
    "history_committee",
    "fundraising_committee",
    "membership_committee",
}


def _migration():
    spec = importlib.util.spec_from_file_location("positions_kind", MATCHES[0])
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
        "organizations",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("name", sa.String),
    )
    sa.Table(
        "positions",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("name", sa.String),
        sa.Column("slug", sa.String),
        sa.Column("description", sa.Text),
        sa.Column("permissions", sa.Text),
        sa.Column("is_system", sa.Boolean),
        sa.Column("priority", sa.Integer),
        sa.Column("settings", sa.Text),
    )
    sa.Table(
        "user_positions",
        metadata,
        sa.Column("user_id", sa.String, primary_key=True),
        sa.Column("position_id", sa.String, primary_key=True),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _position(conn, pid, org, slug, is_system):
    conn.execute(
        sa.text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions, "
            "is_system, priority) VALUES (:id, :org, :name, :slug, '[]', :sys, 10)"
        ),
        {"id": pid, "org": org, "name": slug.title(), "slug": slug, "sys": is_system},
    )


def _seed(engine):
    with engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO organizations (id, name) VALUES ('A', 'A')"))
        conn.execute(sa.text("INSERT INTO organizations (id, name) VALUES ('B', 'B')"))
        _position(conn, "a-captain", "A", "captain", True)
        _position(conn, "a-own-captain", "A", "captain", False)
        _position(conn, "a-member", "A", "member", True)
        _position(conn, "a-it", "A", "it_manager", True)
        _position(conn, "a-treasurer", "A", "treasurer", True)
        _position(conn, "b-history", "B", "history_committee", True)
        _position(conn, "b-member", "B", "member", True)


def _rows(engine):
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT id, organization_id, slug, kind, is_system FROM positions")
        ).all()
    return {row[0]: (row[1], row[2], row[3], bool(row[4])) for row in rows}


def _by_org_slug(rows):
    return {(org, slug): (pid, kind) for pid, (org, slug, kind, _s) in rows.items()}


def test_upgrade_tags_kinds_and_seeds_every_organization(engine):
    _seed(engine)
    _run(engine)
    rows = _rows(engine)

    assert rows["a-captain"][2] == "system"
    # A department's own position under a seeded name is its own office.
    assert rows["a-own-captain"][2] == "office"
    assert rows["a-member"][2] == "system"
    assert rows["a-it"][2] == "system"
    assert rows["a-treasurer"][2] == "office"
    # The row org B already had is tagged, not duplicated.
    assert rows["b-history"][2] == "committee"

    by_key = _by_org_slug(rows)
    for org in ("A", "B"):
        for slug in COMMITTEES:
            assert (org, slug) in by_key, f"{org} is missing {slug}"
            assert by_key[(org, slug)][1] == "committee"
    with engine.connect() as conn:
        inserted = conn.execute(
            sa.text(
                "SELECT permissions FROM positions WHERE organization_id = 'A' "
                "AND slug = 'fundraising_committee'"
            )
        ).scalar_one()
    assert "storefront.view" in inserted
    assert "storefront.order" in inserted
    assert (
        sum(1 for (_o, slug, _k, _s) in rows.values() if slug == "history_committee")
        == 2
    )


def test_upgrade_is_safe_to_run_twice(engine):
    _seed(engine)
    _run(engine)
    first = _rows(engine)
    _run(engine)
    assert _rows(engine) == first


def test_downgrade_removes_only_committees_nobody_holds(engine):
    _seed(engine)
    _run(engine)
    rows = _rows(engine)
    held_id = _by_org_slug(rows)[("A", "history_committee")][0]
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO user_positions (user_id, position_id) VALUES ('gene', :pid)"
            ),
            {"pid": held_id},
        )

    _run(engine, "downgrade")

    with engine.connect() as conn:
        columns = {c["name"] for c in sa.inspect(conn).get_columns("positions")}
        remaining = {
            (row[0], row[1])
            for row in conn.execute(
                sa.text("SELECT organization_id, slug FROM positions")
            )
        }
    assert "kind" not in columns
    # Gene's committee survives; every unheld seeded committee is gone.
    assert ("A", "history_committee") in remaining
    assert ("A", "fundraising_committee") not in remaining
    assert ("B", "history_committee") not in remaining
    assert ("A", "treasurer") in remaining
