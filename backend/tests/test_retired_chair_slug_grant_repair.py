"""Contract tests for the grants the retired chair slug caused to be missed.

Two consequences of the pre-rename `positions` no-ops repaired in #2265, each
left out of that PR because it is a decision about who holds which permission
rather than a spelling correction:

* ``20260825_1500`` skipped every chain-upgraded department's ``member`` row,
  because its frozen comparison set contains the grant ``20260801_0010`` never
  added -- so those members never got the storefront grants.
* ``20260825_1400`` and ``20260826_0345`` never *selected* a row still slugged
  ``membership_committee_chair``, so renaming it later does not grant what they
  skipped.

The two halves are gated differently on purpose, and that asymmetry is what
these tests pin: the member row has an exact shape to match, the coordinator
row does not.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_repair_grants_the_retired_chair_slug_missed.py"))
assert len(MATCHES) == 1, f"expected exactly one repair migration, found {MATCHES}"
MIGRATION = MATCHES[0]


def _load_revision(glob: str):
    """Load a sibling revision so its own constants can be read.

    Reading them rather than restating them is what keeps the derivation below
    honest: if one of those migrations changes, this test moves with it.
    """
    matches = sorted(VERSIONS.glob(glob))
    assert len(matches) == 1, f"expected one match for {glob}, got {matches}"
    spec = importlib.util.spec_from_file_location(matches[0].stem, matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _migration():
    spec = importlib.util.spec_from_file_location("_chair_slug_repair", MIGRATION)
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
def positions(engine):
    metadata = sa.MetaData()
    table = sa.Table(
        "positions",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("name", sa.String),
        sa.Column("slug", sa.String),
        sa.Column("permissions", sa.Text),
        sa.Column("is_system", sa.Boolean),
    )
    metadata.create_all(engine)
    return table


def _insert(engine, table, **values):
    with engine.begin() as connection:
        connection.execute(table.insert().values(**values))


def _perms(engine, table, row_id="r1"):
    with engine.begin() as connection:
        row = connection.execute(
            sa.select(table).where(table.c.id == row_id)
        ).fetchone()
    return set(json.loads(row.permissions))


def _add_member(engine, table, permissions, row_id="r1", is_system=True):
    _insert(
        engine,
        table,
        id=row_id,
        organization_id="org1",
        name="Member",
        slug="member",
        permissions=json.dumps(sorted(permissions)),
        is_system=is_system,
    )


def _add_coordinator(engine, table, permissions, row_id="r1", is_system=True):
    _insert(
        engine,
        table,
        id=row_id,
        organization_id="org1",
        name="Membership Coordinator",
        slug="membership_coordinator",
        permissions=json.dumps(sorted(permissions)),
        is_system=is_system,
    )


class TestTheFrozenMemberShape:
    """Guard the constant the whole member gate rests on.

    ``_MEMBER_UNREPAIRED`` was obtained empirically -- staging a database
    before ``20260801_0010``, seeding an affected department, running the chain
    to head -- not assembled by hand. It is frozen so the migration keeps
    matching the rows it was written to match, but a frozen constant with
    nothing checking it is how a snapshot silently stops describing reality
    (CLAUDE.md pitfall #23, three times over now).
    """

    def test_the_repair_lands_exactly_on_the_seeded_member_set(self):
        """The invariant that makes the gate meaningful: the frozen shape is
        the registry's member set minus exactly the two grants this migration
        adds, so repairing an affected row leaves it identical to a row a new
        organization is seeded with today.

        If this fails because the registry gained a member permission, the
        frozen shape needs re-deriving against a real chain run -- it is a
        prompt to re-measure, not a licence to edit the constant to match.
        """
        from app.core.permissions import DEFAULT_POSITIONS

        module = _migration()
        seeded = set(DEFAULT_POSITIONS["member"]["permissions"])
        unrepaired = set(module._MEMBER_UNREPAIRED)

        assert seeded - unrepaired == set(module._STOREFRONT)
        assert unrepaired | set(module._STOREFRONT) == seeded

    def test_the_frozen_shape_is_what_the_chain_actually_produces(self):
        """Derive the shape from the migrations that transform it, not from the
        constant under test.

        Comparing the constant only against today's registry is circular: a
        wrong snapshot that happened to equal the defaults minus the storefront
        grants would pass while every real affected row failed the gate. This
        rebuilds it from six independent sources -- the frozen set
        ``20260825_1500`` compares against, the grant ``20260801_0010`` failed
        to add, the three later revocations, and the permission the previous
        repair adds -- and matches it against the observed chain result.
        """
        m1500 = _load_revision("20260825_1500_*.py")
        notifications = _load_revision("20260825_2015_a1f7c34e9b02_*.py")
        facilities = _load_revision("20260826_1700_e4f5a6b7c8d9_*.py")
        apparatus = _load_revision("20260905_1420_b6e4a0d17c93_*.py")
        previous = _load_revision("20260905_1600_e8a1c04f6b27_*.py")

        derived = set(m1500._PRIOR_DEFAULTS["member"])
        # The grant 20260801_0010 was meant to add and never did -- the whole
        # reason 20260825_1500's comparison failed on these rows.
        derived -= {"equipment_check.submit"}
        derived -= {notifications._PERMISSION}
        derived -= {facilities._PERMISSION}
        derived -= set(apparatus._REVOKE["member"])
        # ...and what e8a1c04f6b27 has since added to exactly these rows.
        derived |= {previous._PERMISSION}

        assert derived == set(_migration()._MEMBER_UNREPAIRED)

    def test_it_does_not_grant_anything_the_registry_withholds(self):
        """A repair may restore what a new organization gets. It may not invent
        authority beyond that."""
        from app.core.permissions import DEFAULT_POSITIONS

        module = _migration()

        assert set(module._STOREFRONT) <= set(
            DEFAULT_POSITIONS["member"]["permissions"]
        )
        coordinator = set(DEFAULT_POSITIONS["membership_coordinator"]["permissions"])
        assert set(module._STOREFRONT) | {module._TRAINING} <= coordinator


class TestTheMemberStorefrontRepair:
    """Whole-set gated, as 20260825_1500 and 20260826_0345 both are."""

    def test_an_unrepaired_row_gets_both_grants(self, engine, positions):
        _add_member(engine, positions, _migration()._MEMBER_UNREPAIRED)

        _run(engine)

        assert {"storefront.view", "storefront.order"} <= _perms(engine, positions)

    def test_the_marker_less_wizard_shape_gets_the_order_grant(self, engine, positions):
        """A department that unticked all four onboarding heuristic markers
        holds a wizard-written row that 20260904_2050 documents as permanently
        unable to order: the storefront.order restoration in 20260904_1640 is
        marker-gated, while the wizard did write storefront.view. Requiring
        both grants to be absent would leave exactly those members able to
        browse, fill a cart and fail at checkout."""
        shape = set(_migration()._MEMBER_UNREPAIRED) | {"storefront.view"}
        _add_member(engine, positions, shape)

        _run(engine)

        assert _perms(engine, positions) == shape | {"storefront.order"}

    def test_a_row_that_already_has_them_is_untouched(self, engine, positions):
        healthy = set(_migration()._MEMBER_UNREPAIRED) | {
            "storefront.view",
            "storefront.order",
        }
        _add_member(engine, positions, healthy)

        _run(engine)

        assert _perms(engine, positions) == healthy

    @pytest.mark.parametrize("edit", ["added", "removed"])
    def test_a_customized_row_is_left_alone(self, engine, positions, edit):
        """The whole-set gate is the point: a department that has edited its
        member position owns that row, and skipping costs it the status quo
        rather than a regression."""
        stored = set(_migration()._MEMBER_UNREPAIRED)
        if edit == "added":
            stored.add("reports.view")
        else:
            stored.discard("training.view")
        _add_member(engine, positions, stored)

        _run(engine)

        assert _perms(engine, positions) == stored

    def test_a_department_created_position_is_left_alone(self, engine, positions):
        _add_member(engine, positions, _migration()._MEMBER_UNREPAIRED, is_system=False)

        _run(engine)

        assert "storefront.view" not in _perms(engine, positions)


class TestTheCoordinatorRepair:
    """Gated on the row holding NONE of the three.

    That is positive evidence rather than absence: 20260825_1400 grants
    training.configure to this slug unconditionally and 20260826_0345 grants
    both storefront permissions together, so a row those two reached holds all
    three and a row still slugged membership_committee_chair holds none.
    Holding *some* means it was reached and has since been edited.
    """

    def test_a_row_holding_none_of_the_three_gets_all_three(self, engine, positions):
        _add_coordinator(engine, positions, {"prospective_members.manage"})

        _run(engine)

        assert _perms(engine, positions) == {
            "prospective_members.manage",
            "storefront.view",
            "storefront.order",
            "training.configure",
        }

    @pytest.mark.parametrize(
        "held",
        ["storefront.view", "storefront.order", "training.configure"],
    )
    def test_a_row_holding_any_of_them_is_left_alone(self, engine, positions, held):
        """The finding this gate answers: on a department that was never
        affected, an administrator may have removed one of these deliberately.
        Absence alone cannot tell that from "never received it", so a row
        carrying any of the three is treated as reached-and-since-edited and
        left as the department set it."""
        stored = {"prospective_members.manage", held}
        _add_coordinator(engine, positions, stored)

        _run(engine)

        assert _perms(engine, positions) == stored

    @pytest.mark.parametrize("wildcard", ["*", "storefront.*", "training.*"])
    def test_a_wildcard_holder_is_left_alone(self, engine, positions, wildcard):
        """A wildcard already conveys at least one of the three, so the row was
        reached and is the department's own."""
        _add_coordinator(engine, positions, {wildcard})

        _run(engine)

        assert _perms(engine, positions) == {wildcard}

    def test_a_department_created_position_is_left_alone(self, engine, positions):
        _add_coordinator(
            engine, positions, {"prospective_members.manage"}, is_system=False
        )

        _run(engine)

        assert _perms(engine, positions) == {"prospective_members.manage"}

    def test_a_fully_granted_row_is_untouched(self, engine, positions):
        held = {
            "prospective_members.manage",
            "storefront.view",
            "storefront.order",
            "training.configure",
        }
        _add_coordinator(engine, positions, held)

        _run(engine)

        assert _perms(engine, positions) == held


class TestRunningItTwice:
    def test_a_second_application_changes_nothing(self, engine, positions):
        _add_member(engine, positions, _migration()._MEMBER_UNREPAIRED, row_id="m")
        _add_coordinator(engine, positions, {"prospective_members.manage"}, row_id="c")

        _run(engine)
        first = (_perms(engine, positions, "m"), _perms(engine, positions, "c"))
        _run(engine)

        assert first == (_perms(engine, positions, "m"), _perms(engine, positions, "c"))


class TestTheDowngrade:
    def test_it_is_a_documented_no_op(self, engine, positions):
        """Revoking would strip the store and training configuration from
        departments this migration never touched."""
        held = {
            "prospective_members.manage",
            "storefront.view",
            "storefront.order",
            "training.configure",
        }
        _add_coordinator(engine, positions, held)

        _run(engine, "downgrade")

        assert _perms(engine, positions) == held
