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

        assert "storefront.view" not in _perms(engine, positions)


class TestTheCoordinatorRepair:
    """Per-permission, because these rows have no single shape to match."""

    def test_a_row_frozen_before_both_migrations_gets_all_three(
        self, engine, positions
    ):
        _add_coordinator(engine, positions, {"prospective_members.manage"})

        _run(engine)

        assert {
            "storefront.view",
            "storefront.order",
            "training.configure",
        } <= _perms(engine, positions)

    def test_a_partially_granted_row_gets_only_what_it_lacks(self, engine, positions):
        """Per-permission rather than all-or-nothing: 20260826_0345 grants view
        AND order precisely because view alone lets a member browse, fill a
        cart and then fail at submit."""
        _add_coordinator(
            engine, positions, {"prospective_members.manage", "storefront.view"}
        )

        _run(engine)

        assert {"storefront.order", "training.configure"} <= _perms(engine, positions)

    @pytest.mark.parametrize(
        ("wildcard", "expected_added"),
        [
            ("storefront.*", {"training.configure"}),
            ("training.*", {"storefront.view", "storefront.order"}),
        ],
    )
    def test_a_module_wildcard_conveys_its_own_grants_only(
        self, engine, positions, wildcard, expected_added
    ):
        """A module wildcard already conveys that module's grants, so re-adding
        them would clutter the list -- but it says nothing about the other
        module, which must still be repaired."""
        _add_coordinator(engine, positions, {wildcard})

        _run(engine)

        assert _perms(engine, positions) == {wildcard} | expected_added

    def test_a_star_row_is_untouched(self, engine, positions):
        _add_coordinator(engine, positions, {"*"})

        _run(engine)

        assert _perms(engine, positions) == {"*"}

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
