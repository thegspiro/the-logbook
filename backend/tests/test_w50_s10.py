"""W50-S10: ``GET /elections/{id}/results`` must be gated on ``elections.view``.

Every other member-facing read in this router — the election itself, its
candidates, the ballot — resolves ``current_user`` through
``require_permission("elections.view")``. ``get_results`` alone used bare
``get_current_user``, so a member whose "View elections" grant had been
revoked was refused the election page and still handed the tally.

Parsed rather than imported, like ``test_election_package_permissions.py``:
the dependency is an expression inside the handler's signature, not an
importable constant.
"""

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ENDPOINT = Path(__file__).parents[1] / "app/api/v1/endpoints/elections.py"


def _current_user_dependency(handler_name: str) -> ast.expr:
    tree = ast.parse(ENDPOINT.read_text())
    handler = next(
        node
        for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == handler_name
    )
    args = handler.args
    positional = args.posonlyargs + args.args
    defaults = [None] * (len(positional) - len(args.defaults)) + args.defaults
    for arg, default in zip(positional, defaults):
        if arg.arg == "current_user":
            assert isinstance(default, ast.Call), "current_user is not injected"
            (dependency,) = default.args
            return dependency
    raise AssertionError(f"{handler_name} has no current_user parameter")


def test_results_endpoint_requires_elections_view():
    dependency = _current_user_dependency("get_results")

    gate = ast.unparse(dependency)
    why = (
        f"get_results resolves current_user through {gate} — results are "
        "readable by any authenticated member, including one whose "
        "elections.view was revoked"
    )
    assert isinstance(dependency, ast.Call), why
    assert ast.unparse(dependency.func) == "require_permission", why
    assert "elections.view" in {ast.literal_eval(a) for a in dependency.args}
