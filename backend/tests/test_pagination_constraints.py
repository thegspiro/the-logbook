"""Static regression checks for bounded list endpoint pagination."""

import ast
from pathlib import Path

ENDPOINT_ROOT = Path(__file__).resolve().parents[1] / "app" / "api"
PAGINATION_NAMES = {"limit", "page_size", "per_page"}


def test_route_pagination_parameters_have_query_upper_bounds() -> None:
    violations: list[str] = []
    for path in ENDPOINT_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            is_route = any(
                isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and decorator.func.attr in {"get", "post", "put", "patch", "delete"}
                for decorator in node.decorator_list
            )
            if not is_route:
                continue
            defaults = [None] * (len(node.args.args) - len(node.args.defaults)) + list(
                node.args.defaults
            )
            for argument, default in zip(node.args.args, defaults):
                if argument.arg not in PAGINATION_NAMES:
                    continue
                bounded_query = (
                    isinstance(default, ast.Call)
                    and getattr(default.func, "id", None) == "Query"
                    and any(keyword.arg == "le" for keyword in default.keywords)
                )
                if not bounded_query:
                    relative = path.relative_to(ENDPOINT_ROOT.parents[1])
                    violations.append(
                        f"{relative}:{argument.lineno}: {node.name}.{argument.arg}"
                    )

    assert not violations, "Unbounded route pagination parameters:\n" + "\n".join(
        violations
    )
