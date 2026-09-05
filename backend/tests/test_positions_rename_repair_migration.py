"""Contract tests for the repair of the pre-rename `positions` no-ops.

``20260528_0001``, ``20260720_0002`` and ``20260801_0010`` each named
``positions`` while the table was still called ``roles``, so their guards
always fired and they did nothing. Their bodies stay exactly as they ran --
an already-deployed migration is not edited to change its behaviour
(AGENTS.md), and a database already past them would never execute a rewritten
body anyway (CLAUDE.md pitfall #23). ``e8a1c04f6b27`` is the repair, so it is
the thing that has to be right.

What matters is that it is safe against a database in *any* state: one that
missed all three transformations, one that already has them, and one where a
department has since edited the rows.
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


def _targets(engine, messages, message_id="m1"):
    return json.loads(_rows(engine, messages)[message_id].target_roles)


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

    def test_another_orgs_row_is_still_renamed(self, engine, tables):
        positions, _ = tables
        _insert(
            engine,
            positions,
            id="blocked",
            organization_id="org1",
            name="Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            positions,
            id="taken",
            organization_id="org1",
            name="Coord",
            slug="membership_coordinator",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            positions,
            id="free",
            organization_id="org2",
            name="Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )

        _run(engine)

        rows = _rows(engine, positions)
        assert rows["blocked"].slug == "membership_committee_chair"
        assert rows["free"].slug == "membership_coordinator"

    def test_a_department_created_row_is_left_alone(self, engine, tables):
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
            permissions="[]",
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

        assert _targets(engine, messages) == ["r-member"]

    def test_a_message_targeting_the_former_coordinator_name_still_resolves(
        self, engine, tables
    ):
        """The ordering the migration depends on.

        An affected organization is exactly the one whose position is still
        named "Membership Committee Chair" AND whose messages target that
        string. Renaming before building the name map would leave the map
        holding only "Membership Coordinator", so this message would resolve
        to nothing and stay undeliverable -- the very failure the backfill
        exists to end.
        """
        positions, messages = tables
        _insert(
            engine,
            positions,
            id="r-chair",
            organization_id="org1",
            name="Membership Committee Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            messages,
            id="m1",
            organization_id="org1",
            target_type="roles",
            target_roles=json.dumps(["Membership Committee Chair"]),
        )

        _run(engine)

        assert _targets(engine, messages) == ["r-chair"]
        assert _rows(engine, positions)["r-chair"].slug == "membership_coordinator"

    def test_an_ambiguous_name_is_left_unconverted(self, engine, tables):
        """Two positions may share a display name -- create_role suffixes only
        the duplicate slug. The name fallback reaches holders of both, so
        collapsing to one id would silently drop the other's members."""
        positions, messages = tables
        for pid, slug in (("p1", "safety_officer"), ("p2", "safety_officer_2")):
            _insert(
                engine,
                positions,
                id=pid,
                organization_id="org1",
                name="Safety Officer",
                slug=slug,
                permissions="[]",
                is_system=False,
            )
        _insert(
            engine,
            messages,
            id="m1",
            organization_id="org1",
            target_type="roles",
            target_roles=json.dumps(["Safety Officer"]),
        )

        _run(engine)

        assert _targets(engine, messages) == ["Safety Officer"]

    def test_an_unresolvable_name_is_left_alone(self, engine, tables):
        positions, messages = tables
        _insert(
            engine,
            messages,
            id="m1",
            organization_id="org1",
            target_type="roles",
            target_roles=json.dumps(["Gone"]),
        )

        _run(engine)

        assert _targets(engine, messages) == ["Gone"]

    def test_a_name_from_another_org_does_not_resolve(self, engine, tables):
        positions, messages = tables
        _insert(
            engine,
            positions,
            id="r-other",
            organization_id="org2",
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
            target_roles=json.dumps(["Member"]),
        )

        _run(engine)

        assert _targets(engine, messages) == ["Member"]

    def test_an_already_converted_message_is_untouched(self, engine, tables):
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

        _run(engine)

        assert _targets(engine, messages) == ["r-member"]


class TestTheMemberGrant:
    def test_it_grants_the_renamed_permission(self, engine, tables):
        """20260830_0001 moved equipment_check.* to inventory.check_*. Granting
        the retired spelling would add a string nothing resolves."""
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
        positions, messages = tables
        _insert(
            engine,
            positions,
            id="r-chair",
            organization_id="org1",
            name="Membership Committee Chair",
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

        for before, after in zip(first, second):
            assert [dict(r._mapping) for r in before.values()] == [
                dict(r._mapping) for r in after.values()
            ]


class TestTheDowngrade:
    """Documented as irreversible, and that is a correctness property.

    A department built by create_all has always held the grant and the
    coordinator slug, and its messages have always been id-targeted, so the
    upgrade is a no-op there. An unconditional reverse would strip a grant this
    migration never gave and rename a slug it never renamed -- data loss on
    exactly the departments that were never broken.
    """

    def test_it_leaves_a_healthy_department_untouched(self, engine, tables):
        positions, messages = tables
        _insert(
            engine,
            positions,
            id="r-coord",
            organization_id="org1",
            name="Membership Coordinator",
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
        _insert(
            engine,
            messages,
            id="m1",
            organization_id="org1",
            target_type="roles",
            target_roles=json.dumps(["r-member"]),
        )
        before = (_rows(engine, positions), _rows(engine, messages))

        _run(engine, "downgrade")

        after = (_rows(engine, positions), _rows(engine, messages))
        for was, now in zip(before, after):
            assert [dict(r._mapping) for r in was.values()] == [
                dict(r._mapping) for r in now.values()
            ]

    def test_it_does_not_revoke_the_grant(self, engine, tables):
        positions, _ = tables
        _insert(
            engine,
            positions,
            id="r1",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps(["inventory.check_submit"]),
            is_system=True,
        )

        _run(engine, "downgrade")

        assert "inventory.check_submit" in _perms(_rows(engine, positions)["r1"])
