"""Contract tests for the four migrations that ran before the roles rename.

``20260528_0001``, ``20260610_0002``, ``20260720_0002`` and ``20260801_0010``
each queried a table named ``positions`` at a point in the chain where it was
still named ``roles``. The models were renamed to ``Position``/``positions``
long before the database was, so each was written against the model name; when
that made a fresh-chain ``alembic upgrade head`` fail, existence guards were
added (2026-07-29) which turned the crash into a silent no-op.
``20260805_0008`` renamed the table six days later and the guards were never
revisited, so on every upgrade path these four did nothing at all.

Nothing tested them, which is why that survived. CLAUDE.md pitfall #23 says to
verify a migration by running it against a real table rather than by reading
it, so each test below drives the real ``upgrade()`` body against a
``roles``-shaped table and asserts the rows actually changed.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _load(glob: str):
    matches = sorted(VERSIONS.glob(glob))
    assert len(matches) == 1, f"expected exactly one match for {glob}, got {matches}"
    spec = importlib.util.spec_from_file_location(f"_prerename_{glob}", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


COORDINATOR = "20260528_0001_*.py"
SETTINGS = "20260610_0002_*.py"
TARGET_ROLES = "20260720_0002_*.py"
CHECK_SUBMIT = "20260801_0010_*.py"


def _run(engine, glob: str, direction: str = "upgrade"):
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            getattr(_load(glob), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    try:
        yield database
    finally:
        database.dispose()


def _make_roles(engine, name="roles", unique=True):
    metadata = sa.MetaData()
    table = sa.Table(
        name,
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("name", sa.String),
        sa.Column("slug", sa.String),
        sa.Column("permissions", sa.Text),
        sa.Column("is_system", sa.Boolean),
    )
    if unique:
        # idx_role_org_slug, from the initial schema. Without it a collision
        # bug would pass here and only surface on MySQL.
        sa.Index(
            f"idx_{name}_org_slug", table.c.organization_id, table.c.slug, unique=True
        )
    metadata.create_all(engine)
    return table


def _make_messages(engine):
    metadata = sa.MetaData()
    table = sa.Table(
        "department_messages",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("target_type", sa.String),
        sa.Column("target_roles", sa.Text),
    )
    metadata.create_all(engine)
    return table


def _insert(engine, table, **values):
    with engine.begin() as connection:
        connection.execute(table.insert().values(**values))


def _rows(engine, table):
    with engine.begin() as connection:
        return {r.id: r for r in connection.execute(sa.select(table))}


class TestTheCoordinatorRename:
    def test_it_renames_the_row_in_roles(self):
        """The regression: this is what silently did not happen."""
        engine = sa.create_engine("sqlite://")
        roles = _make_roles(engine)
        _insert(
            engine,
            roles,
            id="r1",
            organization_id="org1",
            name="Membership Committee Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )

        _run(engine, COORDINATOR)

        row = _rows(engine, roles)["r1"]
        assert row.slug == "membership_coordinator"
        assert row.name == "Membership Coordinator"

    def test_it_skips_an_org_that_already_holds_the_target_slug(self):
        """``idx_role_org_slug`` is UNIQUE on (organization_id, slug), so a
        blind UPDATE would raise and take the whole upgrade down."""
        engine = sa.create_engine("sqlite://")
        roles = _make_roles(engine)
        _insert(
            engine,
            roles,
            id="old",
            organization_id="org1",
            name="Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            roles,
            id="new",
            organization_id="org1",
            name="Coordinator",
            slug="membership_coordinator",
            permissions="[]",
            is_system=True,
        )

        _run(engine, COORDINATOR)

        assert _rows(engine, roles)["old"].slug == "membership_committee_chair"

    def test_another_orgs_row_is_still_renamed(self):
        """Skipping one organization must not skip everybody."""
        engine = sa.create_engine("sqlite://")
        roles = _make_roles(engine)
        _insert(
            engine,
            roles,
            id="blocked",
            organization_id="org1",
            name="Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            roles,
            id="taken",
            organization_id="org1",
            name="Coord",
            slug="membership_coordinator",
            permissions="[]",
            is_system=True,
        )
        _insert(
            engine,
            roles,
            id="free",
            organization_id="org2",
            name="Chair",
            slug="membership_committee_chair",
            permissions="[]",
            is_system=True,
        )

        _run(engine, COORDINATOR)

        rows = _rows(engine, roles)
        assert rows["blocked"].slug == "membership_committee_chair"
        assert rows["free"].slug == "membership_coordinator"

    def test_downgrade_restores_the_old_slug(self):
        engine = sa.create_engine("sqlite://")
        roles = _make_roles(engine)
        _insert(
            engine,
            roles,
            id="r1",
            organization_id="org1",
            name="Coordinator",
            slug="membership_coordinator",
            permissions="[]",
            is_system=True,
        )

        _run(engine, COORDINATOR, "downgrade")

        assert _rows(engine, roles)["r1"].slug == "membership_committee_chair"


class TestThePositionSettingsColumn:
    def test_it_adds_settings_to_roles(self):
        engine = sa.create_engine("sqlite://")
        _make_roles(engine)

        _run(engine, SETTINGS)

        assert "settings" in {
            c["name"] for c in sa.inspect(engine).get_columns("roles")
        }

    def test_it_is_a_no_op_when_the_column_is_already_there(self):
        """20260805_0008 also adds it, and create_all carries it from the
        model, so this must tolerate finding its own work already done."""
        engine = sa.create_engine("sqlite://")
        _make_roles(engine)
        _run(engine, SETTINGS)

        _run(engine, SETTINGS)  # must not raise

        assert "settings" in {
            c["name"] for c in sa.inspect(engine).get_columns("roles")
        }


class TestTheTargetRolesBackfill:
    def test_it_rewrites_names_to_ids(self):
        engine = sa.create_engine("sqlite://")
        roles = _make_roles(engine)
        messages = _make_messages(engine)
        _insert(
            engine,
            roles,
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

        _run(engine, TARGET_ROLES)

        assert json.loads(_rows(engine, messages)["m1"].target_roles) == ["r-member"]

    def test_an_unresolvable_name_is_left_alone(self):
        """The service keeps a name-match fallback for a deleted position."""
        engine = sa.create_engine("sqlite://")
        _make_roles(engine)
        messages = _make_messages(engine)
        _insert(
            engine,
            messages,
            id="m1",
            organization_id="org1",
            target_type="roles",
            target_roles=json.dumps(["Gone"]),
        )

        _run(engine, TARGET_ROLES)

        assert json.loads(_rows(engine, messages)["m1"].target_roles) == ["Gone"]

    def test_a_name_from_another_org_does_not_resolve(self):
        """The map is keyed on (organization_id, name); matching on name alone
        would target one department's message at another's position."""
        engine = sa.create_engine("sqlite://")
        roles = _make_roles(engine)
        messages = _make_messages(engine)
        _insert(
            engine,
            roles,
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

        _run(engine, TARGET_ROLES)

        assert json.loads(_rows(engine, messages)["m1"].target_roles) == ["Member"]


class TestTheMemberCheckSubmitGrant:
    def test_it_grants_the_permission(self):
        engine = sa.create_engine("sqlite://")
        roles = _make_roles(engine)
        _insert(
            engine,
            roles,
            id="r1",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps(["members.view"]),
            is_system=True,
        )

        _run(engine, CHECK_SUBMIT)

        assert "equipment_check.submit" in json.loads(
            _rows(engine, roles)["r1"].permissions
        )

    @pytest.mark.parametrize("wildcard", ["*", "equipment_check.*"])
    def test_a_wildcard_row_is_left_alone(self, wildcard):
        engine = sa.create_engine("sqlite://")
        roles = _make_roles(engine)
        _insert(
            engine,
            roles,
            id="r1",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps([wildcard]),
            is_system=True,
        )

        _run(engine, CHECK_SUBMIT)

        assert json.loads(_rows(engine, roles)["r1"].permissions) == [wildcard]

    def test_a_department_created_position_is_left_alone(self):
        engine = sa.create_engine("sqlite://")
        roles = _make_roles(engine)
        _insert(
            engine,
            roles,
            id="r1",
            organization_id="org1",
            name="Member",
            slug="member",
            permissions=json.dumps([]),
            is_system=False,
        )

        _run(engine, CHECK_SUBMIT)

        assert json.loads(_rows(engine, roles)["r1"].permissions) == []


class TestTheTableItActuallyTargets:
    """The bug itself, stated directly: which table do these four write to?"""

    @pytest.mark.parametrize(
        "glob", [COORDINATOR, SETTINGS, TARGET_ROLES, CHECK_SUBMIT]
    )
    def test_roles_is_preferred_when_both_tables_exist(self, glob):
        """The shape 20260805_0008 calls "shape 2": a chain-built database that
        has since started against current code carries an EMPTY ``positions``
        beside the populated ``roles``. Writing to ``positions`` there is the
        no-op this whole change set exists to end.
        """
        engine = sa.create_engine("sqlite://")
        _make_roles(engine, "roles")
        _make_roles(engine, "positions", unique=False)

        with engine.connect() as connection:
            assert _load(glob)._positions_table(connection) == "roles"

    @pytest.mark.parametrize(
        "glob", [COORDINATOR, SETTINGS, TARGET_ROLES, CHECK_SUBMIT]
    )
    def test_positions_is_used_once_the_rename_has_happened(self, glob):
        """After 20260805_0008 there is no ``roles`` left. A downgrade walks
        back through these revisions and must still find the rows."""
        engine = sa.create_engine("sqlite://")
        _make_roles(engine, "positions", unique=False)

        with engine.connect() as connection:
            assert _load(glob)._positions_table(connection) == "positions"

    @pytest.mark.parametrize(
        "glob", [COORDINATOR, SETTINGS, TARGET_ROLES, CHECK_SUBMIT]
    )
    def test_neither_table_present_is_a_clean_no_op(self, glob):
        engine = sa.create_engine("sqlite://")

        with engine.connect() as connection:
            assert _load(glob)._positions_table(connection) is None
