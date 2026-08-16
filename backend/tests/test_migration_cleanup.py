"""Regression coverage for startup migration-file recovery."""

import ast
import os
from pathlib import Path
from unittest.mock import MagicMock


def _load_cleanup_function():
    source = (Path(__file__).parents[1] / "main.py").read_text()
    tree = ast.parse(source)
    function = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "_cleanup_duplicate_revisions"
    )
    module = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
    namespace = {"os": os, "logger": MagicMock()}
    exec(compile(module, "main.py", "exec"), namespace)
    return namespace["_cleanup_duplicate_revisions"]


def test_restores_parent_referenced_in_down_revision_tuple(tmp_path):
    cleanup_duplicate_revisions = _load_cleanup_function()
    (tmp_path / "merge.py").write_text(
        'revision = "merge"\n' 'down_revision = ("left", "right")\n'
    )
    (tmp_path / "left.py").write_text('revision = "left"\n' "down_revision = None\n")
    stale = tmp_path / "right.py.stale"
    stale.write_text('revision = "right"\n' "down_revision = None\n")

    cleanup_duplicate_revisions(str(tmp_path))

    assert (tmp_path / "right.py").exists()
    assert not stale.exists()


def test_restores_parent_referenced_in_multiline_down_revision_tuple(tmp_path):
    cleanup_duplicate_revisions = _load_cleanup_function()
    (tmp_path / "merge.py").write_text(
        'revision = "merge"\n'
        "down_revision = (\n"
        '    "left",\n'
        '    "right",\n'
        ")\n"
    )
    (tmp_path / "left.py").write_text('revision = "left"\n' "down_revision = None\n")
    stale = tmp_path / "right.py.stale"
    stale.write_text('revision = "right"\n' "down_revision = None\n")

    cleanup_duplicate_revisions(str(tmp_path))

    assert (tmp_path / "right.py").exists()
    assert not stale.exists()
