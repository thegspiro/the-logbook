"""Regression coverage for startup migration-file recovery."""

import ast
import os
from pathlib import Path
from unittest.mock import MagicMock

import pytest


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


def _write_duplicate_pair(tmp_path):
    (tmp_path / "a_first.py").write_text('revision = "dup"\n' "down_revision = None\n")
    (tmp_path / "b_second.py").write_text('revision = "dup"\n' "down_revision = None\n")
    (tmp_path / "child.py").write_text('revision = "child"\n' 'down_revision = "dup"\n')


def test_development_renames_a_duplicate_revision_to_stale(tmp_path):
    cleanup_duplicate_revisions = _load_cleanup_function()
    _write_duplicate_pair(tmp_path)

    cleanup_duplicate_revisions(str(tmp_path))

    remaining = sorted(p.name for p in tmp_path.iterdir())
    assert remaining == ["a_first.py", "b_second.py.stale", "child.py"]


def test_production_refuses_a_duplicate_revision_and_renames_nothing(tmp_path):
    cleanup_duplicate_revisions = _load_cleanup_function()
    _write_duplicate_pair(tmp_path)

    with pytest.raises(RuntimeError, match="duplicate Alembic revision") as exc:
        cleanup_duplicate_revisions(str(tmp_path), refuse_duplicates=True)

    assert "'dup' in a_first.py, b_second.py" in str(exc.value)
    remaining = sorted(p.name for p in tmp_path.iterdir())
    assert remaining == ["a_first.py", "b_second.py", "child.py"]


def test_production_boots_a_clean_chain(tmp_path):
    cleanup_duplicate_revisions = _load_cleanup_function()
    (tmp_path / "base.py").write_text('revision = "base"\n' "down_revision = None\n")
    (tmp_path / "next.py").write_text('revision = "next"\n' 'down_revision = "base"\n')

    cleanup_duplicate_revisions(str(tmp_path), refuse_duplicates=True)

    assert sorted(p.name for p in tmp_path.iterdir()) == ["base.py", "next.py"]


def test_startup_refuses_duplicates_only_in_production():
    source = (Path(__file__).parents[1] / "main.py").read_text()
    assert 'refuse_duplicates=settings.ENVIRONMENT == "production"' in source
