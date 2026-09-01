#!/usr/bin/env python3
"""
AST sweep for JSON-typed SQLAlchemy model columns.

Enumerates every model attribute declared as `Column(JSON, ...)` or
`Column(MutableDict.as_mutable(JSON), ...)` across `app/models/*.py`, by
parsing each file with the `ast` module rather than scanning source lines.

Why AST and not a line-anchored regex (`docs/security-review/SEC-00-cross-
cutting-baseline.md`, sweep 9): a regex such as `^\\s*(\\w+)\\s*=\\s*Column\\(.*
JSON` cannot see a multiline declaration --

    report_email_recipients = Column(
        JSON, ...
    )

-- because the assignment target and the `JSON` reference land on different
source lines. A regex re-run of that shape against this tree finds 137 names,
missing 42 that only this walk sees. The gap is not cosmetic: sweep 9's
bug-detection pass (nested-bracket mutation / shallow-copy-then-reassign
against JSON columns, pitfall #12) is only complete once it runs against
every name that column really has, and a regex-based enumeration silently
drops the multiline third.

Method: walk the parsed tree for every `ast.ClassDef`; for each of its
direct-body statements that is an `ast.Assign` / `ast.AnnAssign` with a
`Call` value, check whether that call's function name is `Column`
(`Column(...)` or `sa.Column(...)`), then `ast.walk` the call's full
argument subtree looking for a `Name` or `Attribute` node whose identifier
is `JSON`. Walking the subtree (rather than inspecting only the first
positional arg) is what makes `Column(MutableDict.as_mutable(JSON), ...)`
match identically to a bare `Column(JSON, ...)` regardless of how deep the
wrapping nests -- nothing about the walk depends on source formatting.
Restricting to a class's *direct* body (not `ast.walk`-ing every Assign in
the file) is what keeps a module-level constant that happens to be named
`Column(...)`-shaped -- none exist today -- from being misread as a model
attribute.

Usage:
    cd backend
    python3 scripts/json_column_ast_sweep.py
    python3 scripts/json_column_ast_sweep.py --list      # print every name
    python3 scripts/json_column_ast_sweep.py --by-file   # group by model file

Exit codes:
    0 always -- this is a reporting tool, not a gate. Pipe --list into a
    diff against a recorded baseline if a future change wants CI to fail on
    drift in the JSON-column set.
"""

import argparse
import ast
import sys
from collections import defaultdict
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "app" / "models"


def _call_target_name(call: ast.Call) -> str | None:
    """The bare function name of a Call node: `Column(...)` -> 'Column',
    `sa.Column(...)` -> 'Column' (via the Attribute's `.attr`)."""
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _call_references_json(call: ast.Call) -> bool:
    """True if the identifier `JSON` appears anywhere in this call's
    argument subtree -- as a bare `Name` (`JSON`) or as the tail of an
    `Attribute` chain (`sa.JSON`, `postgresql.JSON`). A `JSON` buried
    inside `MutableDict.as_mutable(JSON)`, or any deeper wrapper, is found
    the same way a bare `Column(JSON, ...)` is."""
    for node in ast.walk(call):
        if node is call:
            continue
        if isinstance(node, ast.Name) and node.id == "JSON":
            return True
        if isinstance(node, ast.Attribute) and node.attr == "JSON":
            return True
    return False


def _json_columns_in_class(cls: ast.ClassDef):
    """Yields (attribute_name, lineno) for each JSON-typed Column declared
    directly in this class's body."""
    for stmt in cls.body:
        if not isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            continue
        value = stmt.value
        if not isinstance(value, ast.Call):
            continue
        if _call_target_name(value) != "Column":
            continue
        if not _call_references_json(value):
            continue

        targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
        for target in targets:
            if isinstance(target, ast.Name):
                yield target.id, stmt.lineno


def sweep(models_dir: Path = MODELS_DIR) -> dict[str, list[tuple[str, int]]]:
    """Returns {attribute_name: [(file_name, lineno), ...]} for every
    JSON-typed Column declaration found under `models_dir`. `ast.walk`
    visits every `ClassDef` in the file exactly once regardless of nesting
    depth, so nested classes (none exist today) are covered without extra
    handling and without double-counting."""
    by_name: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for path in sorted(models_dir.glob("*.py")):
        if path.name == "__init__.py":
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            for attr_name, lineno in _json_columns_in_class(node):
                by_name[attr_name].append((path.name, lineno))
    return by_name


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--list", action="store_true", help="print every attribute name found"
    )
    parser.add_argument(
        "--by-file",
        action="store_true",
        help="print every declaration grouped by model file",
    )
    args = parser.parse_args()

    by_name = sweep()
    total_declarations = sum(len(locations) for locations in by_name.values())
    total_names = len(by_name)
    total_files = len(list(MODELS_DIR.glob("*.py")))

    if args.by_file:
        by_file: dict[str, list[tuple[str, int]]] = defaultdict(list)
        for name, locations in by_name.items():
            for file_name, lineno in locations:
                by_file[file_name].append((name, lineno))
        for file_name in sorted(by_file):
            print(f"{file_name}:")
            for attr_name, lineno in sorted(by_file[file_name], key=lambda t: t[1]):
                print(f"  {lineno}: {attr_name}")
    elif args.list:
        for name in sorted(by_name):
            locations = ", ".join(f"{f}:{ln}" for f, ln in by_name[name])
            print(f"{name}  ({locations})")

    print(
        f"\n{total_names} distinct attribute names, "
        f"{total_declarations} Column(...) declarations referencing JSON, "
        f"across {total_files} files in {MODELS_DIR}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
