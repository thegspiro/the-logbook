"""Prevent silently overwritten annotated fields in application classes."""

import ast
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1] / "app"


def test_application_classes_do_not_redeclare_annotated_fields() -> None:
    duplicates: list[str] = []

    for path in APP_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue

            first_declaration: dict[str, int] = {}
            for statement in node.body:
                if not (
                    isinstance(statement, ast.AnnAssign)
                    and isinstance(statement.target, ast.Name)
                ):
                    continue
                field = statement.target.id
                if field in first_declaration:
                    relative_path = path.relative_to(APP_ROOT.parent)
                    duplicates.append(
                        f"{relative_path}:{statement.lineno}: {node.name}.{field} "
                        f"was first declared on line {first_declaration[field]}"
                    )
                else:
                    first_declaration[field] = statement.lineno

    assert not duplicates, "Duplicate annotated class fields:\n" + "\n".join(duplicates)
