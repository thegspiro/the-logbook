"""Contract tests for the repair of the four pre-rename ``positions`` no-ops.

The four migrations corrected alongside this one only help a database that has
not yet stamped them. Alembic records a revision as applied by id, so an
installation already past ``20260801_0010`` never executes the corrected body --
and those installations are precisely the ones carrying the un-transformed rows
(CLAUDE.md pitfall #23). This revision is the half that reaches them, so what
matters here is that it is safe to run against a database in *any* state: one
that missed all three transformations, one that already has them, and one where
a department has since edited the rows.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_repair_prerename_positions_no_ops.py"))
assert len(MATCHES) == 1, f"expected exactly one repair migration, found {MATCHES}"
MIGRATION = MATCHES[0]


def _migration():
    spec = importlib.util.spec_from_file_location("_repair_prerename", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            getattr(_migration(), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    try:
        yield database
    finally:
        database.dispose()


@pytest.fixture
def tables(engine):
    metadata = sa.MetaData()
    positions = sa.Table(
        "positions",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("name", sa.String),
        sa.Column("slug", sa.String),
        sa.Column("permissions", sa.Text),
        sa.Column("is_system", sa.Boolean),
    )
    # idx_position_org_slug. Without it a collision bug passes here and only
    # surfaces on MySQL, which is where it would take an upgrade down.
    sa.Index(
        "idx_position_org_slug",
        positions.c.organization_id,
        positions.c.slug,
        unique=True,
    )
    messages = sa.Table(
        "department_messages",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("target_type", sa.String),
        sa.Column("target_roles", sa.Text),
    )
    metadata.create_all(engine)
    return positions, messages


def _insert(engine, table, **values):
    with engine.begin() as connection:
        connection.execute(table.insert().values(**values))


def _rows(engine, table):
    with engine.begin() as connection:
        return {r.id: r for r in connection.execute(sa.select(table))}


def _perms(row):
    return json.loads(row.permissions)


class TestTheCoordinatorRename:
    def test_it_renames_a_seeded_row(self, engine, tables):
        positions, _ = tables
        _insert(
            engine,
            positions,
            id="r1",
            organization_id="org1",
            name="Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )

        _run(engine)

        row = _rows(engine, positions)["r1"]
        assert (row.slug, row.name) == (
            "membership_coordinator",
            "Membership Coordinator",
        )

    def test_it_skips_an_org_that_already_holds_the_target_slug(self, engine, tables):
        positions, _ = tables
        _insert(
            engine,
            positions,
            id="old",
            organization_id="org1",
            name="Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            positions,
            id="new",
            organization_id="org1",
            name="Coord",
            slug="membership_coordinator",
            permissions="[]",
            is_system=True,
        )

        _run(engine)

        assert _rows(engine, positions)["old"].slug == "membership_committee_chair"

    def test_a_department_created_row_is_left_alone(self, engine, tables):
        """A position a department built for itself is theirs, so the rename
        scopes to is_system -- every row that ever carried the old slug was
        seeded."""
        positions, _ = tables
        _insert(
            engine,
            positions,
            id="r1",
            organization_id="org1",
            name="Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=False,
        )

        _run(engine)

        assert _rows(engine, positions)["r1"].slug == "membership_committee_chair"


class TestTheTargetRolesBackfill:
    def test_it_rewrites_names_to_ids(self, engine, tables):
        positions, messages = tables
        _insert(
            engine,
            positions,
            id="r-member",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps(["inventory.check_submit"]),
            is_system=True,
        )
        _insert(
            engine,
            messages,
            id="m1",
            organization_id="org1",
            target_type="roles",
            target_roles=json.dumps(["Member"]),
        )

        _run(engine)

        assert json.loads(_rows(engine, messages)["m1"].target_roles) == ["r-member"]

    def test_an_already_converted_message_is_untouched(self, engine, tables):
        """The property that makes re-running safe: an id never matches a name."""
        positions, messages = tables
        _insert(
            engine,
            positions,
            id="r-member",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps(["inventory.check_submit"]),
            is_system=True,
        )
        _insert(
            engine,
            messages,
            id="m1",
            organization_id="org1",
            target_type="roles",
            target_roles=json.dumps(["r-member"]),
        )

        _run(engine)

        assert json.loads(_rows(engine, messages)["m1"].target_roles) == ["r-member"]


class TestTheMemberGrant:
    def test_it_grants_the_renamed_permission(self, engine, tables):
        """20260830_0001 moved equipment_check.* to inventory.check_*. Granting
        the retired spelling here would add a string nothing resolves."""
        positions, _ = tables
        _insert(
            engine,
            positions,
            id="r1",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps(["members.view"]),
            is_system=True,
        )

        _run(engine)

        perms = _perms(_rows(engine, positions)["r1"])
        assert "inventory.check_submit" in perms
        assert "equipment_check.submit" not in perms

    @pytest.mark.parametrize("wildcard", ["*", "inventory.*", "equipment_check.*"])
    def test_a_covered_row_is_left_alone(self, engine, tables, wildcard):
        """The equipment_check spelling is covered too: it can still arrive on
        a database restored from a backup older than the rename."""
        positions, _ = tables
        _insert(
            engine,
            positions,
            id="r1",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps([wildcard]),
            is_system=True,
        )

        _run(engine)

        assert _perms(_rows(engine, positions)["r1"]) == [wildcard]

    def test_a_department_created_position_is_left_alone(self, engine, tables):
        positions, _ = tables
        _insert(
            engine,
            positions,
            id="r1",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps([]),
            is_system=False,
        )

        _run(engine)

        assert _perms(_rows(engine, positions)["r1"]) == []


class TestRunningItTwice:
    def test_a_second_application_changes_nothing(self, engine, tables):
        """A repair revision has to tolerate a database that already has some
        of its work -- a department built by create_all has all three."""
        positions, messages = tables
        _insert(
            engine,
            positions,
            id="r-chair",
            organization_id="org1",
            name="Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            positions,
            id="r-member",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps(["members.view"]),
            is_system=True,
        )
        _insert(
            engine,
            messages,
            id="m1",
            organization_id="org1",
            target_type="roles",
            target_roles=json.dumps(["Member"]),
        )

        _run(engine)
        first = (_rows(engine, positions), _rows(engine, messages))
        _run(engine)
        second = (_rows(engine, positions), _rows(engine, messages))

        assert [dict(r._mapping) for r in first[0].values()] == [
            dict(r._mapping) for r in second[0].values()
        ]
        assert [dict(r._mapping) for r in first[1].values()] == [
            dict(r._mapping) for r in second[1].values()
        ]


class TestTheDowngrade:
    def test_it_reverses_the_rename_and_the_grant(self, engine, tables):
        positions, _ = tables
        _insert(
            engine,
            positions,
            id="r-chair",
            organization_id="org1",
            name="Coord",
            slug="membership_coordinator",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            positions,
            id="r-member",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps(["members.view", "inventory.check_submit"]),
            is_system=True,
        )

        _run(engine, "downgrade")

        rows = _rows(engine, positions)
        assert rows["r-chair"].slug == "membership_committee_chair"
        assert "inventory.check_submit" not in _perms(rows["r-member"])

    def test_it_leaves_target_roles_converted(self, engine, tables):
        """Reversing by name would turn a message legitimately targeted by id --
        every message written since 20260720_0002 -- back into a name match it
        never used, losing information the downgrade cannot restore."""
        positions, messages = tables
        _insert(
            engine,
            positions,
            id="r-member",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            messages,
            id="m1",
            organization_id="org1",
            target_type="roles",
            target_roles=json.dumps(["r-member"]),
        )

        _run(engine, "downgrade")

        assert json.loads(_rows(engine, messages)["m1"].target_roles) == ["r-member"]
