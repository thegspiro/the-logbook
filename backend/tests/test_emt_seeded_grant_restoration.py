"""What the setup screen's checkboxes could never say, for an EMT row.

``expand_module_checkboxes`` emits ``{module}.view``, ``{module}.manage``,
``{module}.*`` and one implied grant. The registry had no ``emt`` entry, so
``save_session_roles`` took its create branch and stored exactly that — and four
of the grants the EMT rank carries have no checkbox to come from.

``b4d1c8e37f52`` supplies them. The set is asserted against the registry rather
than restated, so the migration's frozen tuple cannot drift from what
``DEFAULT_POSITIONS["emt"]`` means (CLAUDE.md pitfall #20 keeps the tuple frozen;
this keeps it honest).
"""

import importlib.util
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from app.api.v1.onboarding import expand_module_checkboxes
from app.core.permissions import DEFAULT_POSITIONS

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_PATH = _VERSIONS / "20260905_0130_b4d1c8e37f52_restore_emt_seeded_grants.py"

_SEEDED_GRANTS_TS = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "config"
    / "seededPositionGrants.ts"
)


def _emt_modules():
    """The modules EMT actually gets a checkbox for.

    Read from the generated map as text, in the manner of
    ``test_onboarding_position_template_parity.py``, rather than derived from
    the registry's permissions. The two differ, and the difference is the whole
    point: the editor only knows the modules in its own registry, so
    ``locations``, ``meetings`` and ``organization`` have no box to tick even
    though the rank grants a view on each.
    """
    source = _SEEDED_GRANTS_TS.read_text()
    block = re.search(r"\n  emt: \{\s*view: \[(.*?)\],", source, re.S)
    assert block, f"no emt entry in {_SEEDED_GRANTS_TS.name}"
    return sorted(re.findall(r"'([^']+)'", block.group(1)))


def _editor_output():
    """Everything the position editor could have stored for an EMT row."""
    submitted = {
        module: SimpleNamespace(view=True, manage=False) for module in _emt_modules()
    }
    return set(expand_module_checkboxes(submitted))


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _migration():
    return _load(_PATH, "_restore_emt")


class _Op:
    """Stands in for ``alembic.op``, which only exists inside a real upgrade.

    The module is loaded by path and never registered in ``sys.modules``, so
    replacing its ``op`` cannot leak into another test (CLAUDE.md pitfall #22).
    """

    def __init__(self, bind):
        self._bind = bind

    def get_bind(self):
        return self._bind


@pytest.fixture
def engine():
    engine = sa.create_engine("sqlite://")
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def positions_table(engine):
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "CREATE TABLE positions ("
                "  id VARCHAR(36) PRIMARY KEY,"
                "  slug VARCHAR(100),"
                "  is_system BOOLEAN,"
                "  permissions TEXT"
                ")"
            )
        )
    return engine


def _run_upgrade(engine):
    module = _migration()
    with engine.begin() as conn:
        module.op = _Op(conn)
        module.upgrade()


def _restore_row(engine, slug, permissions, is_system=True):
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO positions (id, slug, is_system, permissions) "
                "VALUES ('row', :slug, :is_system, :permissions)"
            ),
            {
                "slug": slug,
                "is_system": is_system,
                "permissions": json.dumps(list(permissions)),
            },
        )
    _run_upgrade(engine)
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT permissions FROM positions WHERE id = 'row'")
        ).scalar_one()
    return json.loads(raw)


class TestTheGate:
    """Recognized by what the row is *missing*, not by its whole shape.

    An addition needs positive evidence the row is an unrepaired seed (CLAUDE.md
    pitfall #23), and that pitfall bans the obvious way of getting it: matching
    the entire stored list, which a later migration or a different build moves
    the row out of. What survives both is that no checkbox in any build can emit
    the four — so holding none of them is evidence no merge or seed ever reached
    the row, and holding any of them is evidence one did.
    """

    def test_a_row_holding_none_of_them_is_repaired(self, positions_table):
        stored = sorted(_editor_output())

        result = _restore_row(positions_table, "emt", stored)

        assert set(result) == set(stored) | set(_migration()._RESTORE)

    @pytest.mark.parametrize("kept", list(_migration()._RESTORE))
    def test_a_row_holding_any_one_of_them_is_left_alone(self, positions_table, kept):
        """The likely edit: an administrator took some of the four off. The row
        cannot say which were deliberate, so none are put back."""
        stored = sorted(_editor_output()) + [kept]

        assert _restore_row(positions_table, "emt", stored) == stored

    def test_an_emptied_row_is_left_alone(self, positions_table):
        """A position stripped to nothing is not a row the wizard built, and
        furnishing it with four grants would be inventing a decision."""
        assert _restore_row(positions_table, "emt", []) == []

    def test_an_unrelated_edit_does_not_block_the_repair(self, positions_table):
        """The deliberate loosening. Under the whole-list gate this row was
        skipped; the grant an administrator added says nothing about whether the
        four ever arrived, and they still have not."""
        stored = sorted(_editor_output()) + ["compliance.view"]

        result = _restore_row(positions_table, "emt", stored)

        assert set(result) == set(stored) | set(_migration()._RESTORE)


class TestItSurvivesADifferentModuleList:
    """The finding this gate exists to answer.

    ``moduleRegistry.ts`` did not exist before 2026-08-31, and the module set
    moves as the product grows. A gate keyed on the editor's whole output is
    therefore pinned to one build: a row written by any other one differs by a
    permission or two and is skipped silently, while the code reads as though it
    covers the population. These rows are what that gate missed.
    """

    def test_a_row_from_a_build_with_fewer_modules(self, positions_table):
        stored = sorted(_editor_output())[2:]

        result = _restore_row(positions_table, "emt", stored)

        assert set(result) == set(stored) | set(_migration()._RESTORE)

    def test_a_row_from_a_build_with_a_module_since_renamed(self, positions_table):
        stored = sorted(set(_editor_output()) - {"inventory.view"} | {"gear.view"})

        result = _restore_row(positions_table, "emt", stored)

        assert set(result) == set(stored) | set(_migration()._RESTORE)

    def test_a_row_carrying_a_manage_box_somebody_ticked(self, positions_table):
        stored = sorted(_editor_output()) + ["events.manage", "events.*"]

        result = _restore_row(positions_table, "emt", stored)

        assert set(result) == set(stored) | set(_migration()._RESTORE)


class TestTheRestoredSet:
    def test_it_is_exactly_what_the_editor_could_not_express(self):
        """Derived here, frozen there — a drift in either is a failure.

        If a grant becomes reachable through a checkbox, or the rank's list
        changes, this catches it rather than letting the migration quietly
        restore the wrong thing.
        """
        seeded = set(DEFAULT_POSITIONS["emt"]["permissions"])

        assert set(_migration()._RESTORE) == seeded - _editor_output()

    def test_none_of_it_is_something_the_editor_emits(self):
        assert not set(_migration()._RESTORE) & _editor_output()


class TestARowFromTheCreateBranch:
    def test_it_gains_the_four_grants(self, positions_table):
        wizard = sorted(_editor_output())

        result = _restore_row(positions_table, "emt", wizard)

        assert set(result) == set(wizard) | set(_migration()._RESTORE)

    def test_it_ends_equal_to_the_registry(self, positions_table):
        """The point of the whole exercise: a wizard row, once the over-grants
        are gone, becomes exactly what the rank carries."""
        wizard = sorted(_editor_output())

        result = _restore_row(positions_table, "emt", wizard)

        assert sorted(result) == sorted(DEFAULT_POSITIONS["emt"]["permissions"])

    def test_what_was_already_there_keeps_its_order(self, positions_table):
        wizard = sorted(_editor_output())

        result = _restore_row(positions_table, "emt", wizard)

        assert result[: len(wizard)] == wizard

    def test_a_complete_row_is_byte_identical(self, positions_table):
        seeded = list(DEFAULT_POSITIONS["emt"]["permissions"])

        assert _restore_row(positions_table, "emt", seeded) == seeded

    def test_each_grant_appears_once(self, positions_table):
        result = _restore_row(positions_table, "emt", sorted(_editor_output()))

        assert len(result) == len(set(result))

    def test_it_is_idempotent(self, positions_table):
        with positions_table.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO positions (id, slug, is_system, permissions) "
                    "VALUES ('row', 'emt', 1, :p)"
                ),
                {"p": json.dumps(sorted(_editor_output()))},
            )
        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            once = conn.execute(
                sa.text("SELECT permissions FROM positions WHERE id = 'row'")
            ).scalar_one()
        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            assert (
                conn.execute(
                    sa.text("SELECT permissions FROM positions WHERE id = 'row'")
                ).scalar_one()
                == once
            )


class TestWhatItMustNotTouch:
    def test_a_department_created_position_is_left_alone(self, positions_table):
        stored = sorted(_editor_output())

        assert _restore_row(positions_table, "emt", stored, is_system=False) == stored

    @pytest.mark.parametrize("slug", ["member", "firefighter", "engineer", "captain"])
    def test_other_slugs_are_left_alone(self, positions_table, slug):
        """They were seeded throughout, so their saves went through the update
        branch and ``_merge_default_permissions`` kept these grants."""
        stored = sorted(_editor_output())

        assert _restore_row(positions_table, slug, stored) == stored

    def test_it_no_ops_when_the_table_does_not_exist(self, engine):
        _run_upgrade(engine)


class TestItIsWiredIn:
    def test_the_chain(self):
        module = _migration()
        assert module.revision == "b4d1c8e37f52"
        assert module.down_revision == "a2e9f6b04c71"
