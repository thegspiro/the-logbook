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


def _migration():
    spec = importlib.util.spec_from_file_location("_restore_emt", _PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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
        wizard = ["members.view", "training.view", "events.view"]

        result = _restore_row(positions_table, "emt", wizard)

        assert result[: len(wizard)] == wizard

    def test_a_complete_row_is_byte_identical(self, positions_table):
        seeded = list(DEFAULT_POSITIONS["emt"]["permissions"])

        assert _restore_row(positions_table, "emt", seeded) == seeded

    def test_only_the_missing_ones_are_added(self, positions_table):
        stored = ["members.view", "organization.view"]

        result = _restore_row(positions_table, "emt", stored)

        assert result.count("organization.view") == 1
        assert set(result) == set(stored) | set(_migration()._RESTORE)

    def test_it_is_idempotent(self, positions_table):
        with positions_table.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO positions (id, slug, is_system, permissions) "
                    "VALUES ('row', 'emt', 1, :p)"
                ),
                {"p": json.dumps(["members.view"])},
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
        stored = ["members.view"]

        assert _restore_row(positions_table, "emt", stored, is_system=False) == stored

    @pytest.mark.parametrize("slug", ["member", "firefighter", "engineer", "captain"])
    def test_other_slugs_are_left_alone(self, positions_table, slug):
        """They were seeded throughout, so their saves went through the update
        branch and ``_merge_default_permissions`` kept these grants."""
        stored = ["members.view"]

        assert _restore_row(positions_table, slug, stored) == stored

    def test_it_no_ops_when_the_table_does_not_exist(self, engine):
        _run_upgrade(engine)


class TestItIsWiredIn:
    def test_the_chain(self):
        module = _migration()
        assert module.revision == "b4d1c8e37f52"
        assert module.down_revision == "a2e9f6b04c71"
