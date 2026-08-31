"""The c4d8e2f7a913 downgrade must complete, not abort halfway.

Its last step recreates the pre-run unique index on
``(organization_id, user_id, route_path)``. A second run makes that key
non-unique *by design* — one row per run per page — so on any department that
has run the checklist twice, ``CREATE UNIQUE INDEX`` fails with 1062. MySQL
DDL is not transactional, so the column and table drops above it have already
committed, and what is left is a table with no ``run_id`` and no unique index,
still stamped with this revision. Alembic will therefore never re-run it: a
subsequent ``upgrade head`` reports success while every query the /testing
screen issues fails with 1054 Unknown column.

Reproduced on the project's MariaDB before the fix, exactly as above.

Tested through the module's own helper rather than by driving Alembic: the
ordering rule is the part that can be got wrong, and it is pure.
"""

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.unit

_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260827_1600_c4d8e2f7a913_testing_runs.py"
)


def _module():
    spec = importlib.util.spec_from_file_location("_testing_runs_migration", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Bind:
    """Answers the collapse's SELECT and records its DELETEs."""

    def __init__(self, rows):
        self._rows = rows
        self.deleted: list = []
        self.selected = ""

    def execute(self, statement, params=None):
        text = str(statement)
        if text.strip().upper().startswith("SELECT"):
            self.selected = text
            return SimpleNamespace(fetchall=lambda: list(self._rows))
        self.deleted.extend((params or {}).get("ids", []))
        return SimpleNamespace()


def _collapse(rows, *, has_run_id=True, has_runs=True):
    module = _module()
    bind = _Bind(rows)
    with patch.object(module.op, "get_bind", return_value=bind), patch.object(
        module, "_has_column", return_value=has_run_id
    ), patch.object(module, "_has_table", return_value=has_runs):
        module._collapse_to_one_mark_per_page()
    return bind


def test_the_newest_run_is_the_mark_that_survives():
    # The SELECT orders newest-run-first, so the first row seen for a key is
    # the keeper and every later one is deleted.
    bind = _collapse(
        [
            ("e-run2", "org", "u1", "/a"),
            ("e-run1", "org", "u1", "/a"),
        ]
    )

    assert bind.deleted == ["e-run1"]


def test_the_select_orders_by_run_sequence_then_recency():
    bind = _collapse([("e1", "org", "u1", "/a")])

    assert "r.sequence DESC" in bind.selected
    assert "e.checked_at DESC" in bind.selected
    assert "LEFT JOIN testing_runs" in bind.selected


def test_distinct_pages_members_and_orgs_all_survive():
    rows = [
        ("a", "org1", "u1", "/a"),
        ("b", "org1", "u1", "/b"),
        ("c", "org1", "u2", "/a"),
        ("d", "org2", "u1", "/a"),
    ]

    assert _collapse(rows).deleted == []


def test_three_runs_leave_exactly_one_mark():
    rows = [(f"e{n}", "org", "u1", "/a") for n in range(3)]

    assert _collapse(rows).deleted == ["e1", "e2"]


def test_a_table_without_run_id_still_collapses_duplicates():
    """A partially-applied schema has duplicates and no run to order by."""
    bind = _collapse(
        [("newer", "org", "u1", "/a"), ("older", "org", "u1", "/a")],
        has_run_id=False,
    )

    assert "LEFT JOIN" not in bind.selected
    assert bind.deleted == ["older"]


def test_deletes_are_batched_rather_than_one_statement_per_row():
    rows = [(f"e{n}", "org", "u1", "/a") for n in range(1201)]

    bind = _collapse(rows)

    assert len(bind.deleted) == 1200


def test_the_foreign_key_drop_is_guarded_like_every_other_step():
    """An install whose table came from create_all has no such constraint."""
    source = _MIGRATION.read_text()

    assert '_has_foreign_key(_ENTRIES, "fk_testing_entry_run")' in source


def test_downgrade_collapses_before_it_recreates_the_index():
    """The helper is only worth anything if downgrade() calls it, first.

    Asserted against the source because the collapse and the index creation
    are both side effects on a live connection: what matters is the order, and
    a unit test of the helper alone passes with the call deleted.
    """
    body = _MIGRATION.read_text().partition("def downgrade(")[2]
    collapse = body.find("_collapse_to_one_mark_per_page()")
    recreate = body.find("op.create_index(")

    assert collapse != -1, "downgrade() no longer collapses duplicate marks"
    assert recreate != -1, "downgrade() no longer recreates the old index"
    assert collapse < recreate
