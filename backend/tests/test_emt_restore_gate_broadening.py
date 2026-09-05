"""``c7a4e91d3b68`` reaches the EMT rows its predecessor could not recognize.

``b4d1c8e37f52`` gates its addition on the row's whole stored permission list
matching a frozen snapshot of the editor's EMT output. That snapshot is pinned
to one build's module list, so a row written by any other build is skipped — the
failure CLAUDE.md pitfall #23 describes, and the reason for this revision.

The gate here is the absence of the four instead, which no registry change can
move a row across. These assert both halves: the rows the predecessor missed are
repaired, and the rows it was right to leave alone are still left alone.

Mirrors the harness in ``test_emt_seeded_grant_restoration.py`` — the migration
is loaded by path and never registered in ``sys.modules``, so replacing its
``op`` cannot leak into another test (CLAUDE.md pitfall #22).
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
_PATH = _VERSIONS / "20260905_1245_c7a4e91d3b68_broaden_emt_restore_gate.py"
_PREDECESSOR = _VERSIONS / "20260905_0130_b4d1c8e37f52_restore_emt_seeded_grants.py"

_SEEDED_GRANTS_TS = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "onboarding"
    / "config"
    / "seededPositionGrants.ts"
)


#: Modules EMT had a checkbox ticked for when these two revisions ran, and which
#: a LATER revision has since taken off the seeded set — ``b6e4a0d17c93`` revoked
#: ``apparatus`` from the rank-and-file slugs on 2026-09-05.
#:
#: Added back rather than trimmed out of ``b4d1c8e37f52``'s frozen
#: ``_UNEDITED_SHAPE``, and the direction is the point: that snapshot is matched
#: against real stored rows, and a row untouched since the create branch wrote it
#: still holds these. Trimming it to a registry that moved on afterwards would
#: stop it matching — which is the very failure this revision exists to fix, and
#: would make ``TestComposedWithItsPredecessor`` assert the predecessor is broken
#: rather than that the two compose (pitfall #20).
_REVOKED_SINCE_MODULES = ("apparatus",)


def _emt_modules():
    """The modules EMT had a checkbox for when these revisions ran.

    Read from the generated map as text rather than derived from the registry's
    permissions: the two differ, and the difference is the point — the editor
    only knows the modules in its own registry, so ``locations``, ``meetings``
    and ``organization`` have no box to tick even though the rank grants a view
    on each.

    Modules revoked by a later revision are added back — see
    ``_REVOKED_SINCE_MODULES``.
    """
    source = _SEEDED_GRANTS_TS.read_text()
    block = re.search(r"\n  emt: \{\s*view: \[(.*?)\],", source, re.S)
    assert block, f"no emt entry in {_SEEDED_GRANTS_TS.name}"
    modules = set(re.findall(r"'([^']+)'", block.group(1)))
    return sorted(modules | set(_REVOKED_SINCE_MODULES))


def _registry_at_this_point():
    """``DEFAULT_POSITIONS["emt"]`` as it stood when these revisions ran.

    They bring a row up to the registry *of their own moment*, not to today's.
    ``b6e4a0d17c93`` later revoked ``apparatus.view``, which leaves today's
    registry one grant shorter than the row this pair legitimately produces.
    """
    return set(DEFAULT_POSITIONS["emt"]["permissions"]) | {
        f"{module}.view" for module in _REVOKED_SINCE_MODULES
    }


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
    return _load(_PATH, "_broaden_emt_gate")


class _Op:
    """Stands in for ``alembic.op``, which only exists inside a real upgrade."""

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


def _run_upgrade(engine, module=None):
    module = module or _migration()
    with engine.begin() as conn:
        module.op = _Op(conn)
        module.upgrade()


def _insert(engine, slug, permissions, is_system=True, row_id="row"):
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO positions (id, slug, is_system, permissions) "
                "VALUES (:id, :slug, :is_system, :permissions)"
            ),
            {
                "id": row_id,
                "slug": slug,
                "is_system": is_system,
                "permissions": json.dumps(list(permissions)),
            },
        )


def _read(engine, row_id="row"):
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT permissions FROM positions WHERE id = :id"),
            {"id": row_id},
        ).scalar_one()
    return json.loads(raw)


def _restore_row(engine, slug, permissions, is_system=True):
    _insert(engine, slug, permissions, is_system)
    _run_upgrade(engine)
    return _read(engine)


class TestItReachesWhatThePredecessorMissed:
    """The finding. Each of these is skipped by ``b4d1c8e37f52``'s gate.

    Asserted against the predecessor directly rather than described, so if its
    gate is ever widened these stop claiming a difference that is not there.
    """

    @pytest.mark.parametrize(
        "label",
        ["fewer_modules", "module_renamed", "manage_box_ticked", "unrelated_grant"],
    )
    def test_the_predecessor_skips_it_and_this_repairs_it(self, positions_table, label):
        editor = sorted(_editor_output())
        stored = {
            "fewer_modules": editor[2:],
            "module_renamed": sorted(set(editor) - {"inventory.view"} | {"gear.view"}),
            "manage_box_ticked": editor + ["events.manage", "events.*"],
            "unrelated_grant": editor + ["compliance.view"],
        }[label]

        predecessor = _load(_PREDECESSOR, "_restore_emt_predecessor")
        assert predecessor.restore(stored) is None, "predecessor would have repaired it"

        result = _restore_row(positions_table, "emt", stored)

        assert set(result) == set(stored) | set(_migration()._RESTORE)


class TestTheGate:
    def test_a_row_holding_none_of_them_is_repaired(self, positions_table):
        stored = sorted(_editor_output())

        result = _restore_row(positions_table, "emt", stored)

        assert set(result) == set(stored) | set(_migration()._RESTORE)

    @pytest.mark.parametrize("kept", list(_load(_PATH, "_ids")._RESTORE))
    def test_a_row_holding_any_one_of_them_is_left_alone(self, positions_table, kept):
        """The likely edit: an administrator took some of the four off. The row
        cannot say which were deliberate, so none are put back."""
        stored = sorted(_editor_output()) + [kept]

        assert _restore_row(positions_table, "emt", stored) == stored

    def test_an_emptied_row_is_left_alone(self, positions_table):
        """A position stripped to nothing is not a row the wizard built, and
        furnishing it with four grants would be inventing a decision."""
        assert _restore_row(positions_table, "emt", []) == []

    def test_what_was_already_there_keeps_its_order(self, positions_table):
        stored = sorted(_editor_output())

        result = _restore_row(positions_table, "emt", stored)

        assert result[: len(stored)] == stored

    def test_each_grant_appears_once(self, positions_table):
        result = _restore_row(positions_table, "emt", sorted(_editor_output()))

        assert len(result) == len(set(result))

    def test_it_is_idempotent(self, positions_table):
        _insert(positions_table, "emt", sorted(_editor_output()))
        _run_upgrade(positions_table)
        once = _read(positions_table)
        _run_upgrade(positions_table)

        assert _read(positions_table) == once


class TestComposedWithItsPredecessor:
    """On a fresh database both run, in order."""

    def test_a_row_the_predecessor_repairs_is_untouched_here(self, positions_table):
        _insert(positions_table, "emt", sorted(_editor_output()))
        _run_upgrade(positions_table, _load(_PREDECESSOR, "_restore_emt_first"))
        after_predecessor = _read(positions_table)
        _run_upgrade(positions_table)

        assert _read(positions_table) == after_predecessor

    def test_the_pair_ends_equal_to_the_registry(self, positions_table):
        _insert(positions_table, "emt", sorted(_editor_output()))
        _run_upgrade(positions_table, _load(_PREDECESSOR, "_restore_emt_first"))
        _run_upgrade(positions_table)

        assert sorted(_read(positions_table)) == sorted(_registry_at_this_point())


class TestTheRestoredSet:
    def test_it_is_exactly_what_the_editor_could_not_express(self):
        """Derived here, frozen there — a drift in either is a failure."""
        seeded = set(DEFAULT_POSITIONS["emt"]["permissions"])

        assert set(_migration()._RESTORE) == seeded - _editor_output()

    def test_none_of_it_is_something_the_editor_emits(self):
        assert not set(_migration()._RESTORE) & _editor_output()

    def test_it_matches_the_predecessor(self):
        """The copy is deliberate (pitfall #20) but must start out identical."""
        predecessor = _load(_PREDECESSOR, "_restore_emt_compare")

        assert _migration()._RESTORE == predecessor._RESTORE


class TestWhatItMustNotTouch:
    def test_a_department_created_position_is_left_alone(self, positions_table):
        stored = sorted(_editor_output())

        assert _restore_row(positions_table, "emt", stored, is_system=False) == stored

    @pytest.mark.parametrize("slug", ["member", "firefighter", "engineer", "captain"])
    def test_other_slugs_are_left_alone(self, positions_table, slug):
        stored = sorted(_editor_output())

        assert _restore_row(positions_table, slug, stored) == stored

    def test_it_no_ops_when_the_table_does_not_exist(self, engine):
        _run_upgrade(engine)


class TestItIsWiredIn:
    def test_the_chain(self):
        module = _migration()

        assert module.revision == "c7a4e91d3b68"
        assert module.down_revision == "b4d1c8e37f52"
