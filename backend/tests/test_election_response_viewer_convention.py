"""``_build_election_response`` trusts a caller that omits ``viewer``.

The nominations announcement (a draft message addressed to the department) is
attached to the election response only for a viewer who can manage elections,
and ``viewer=None`` means "the route already required ``elections.manage``".
That default is safe only while it is true. A route that an ``elections.view``
member can reach and that forgets to pass ``viewer`` would hand every voter the
manager-only announcement, with nothing failing: the response still validates.

This pins the convention so a new route cannot break it quietly.
"""

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

_ENDPOINTS = Path(__file__).parents[1] / "app/api/v1/endpoints/elections.py"
_BUILDER = "_build_election_response"


def _handlers_calling_builder() -> list[tuple[ast.AsyncFunctionDef, ast.Call]]:
    tree = ast.parse(_ENDPOINTS.read_text())
    found = []
    for node in tree.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        for call in ast.walk(node):
            if (
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id == _BUILDER
            ):
                found.append((node, call))
    return found


def _required_permissions(handler: ast.AsyncFunctionDef) -> set[str]:
    names: set[str] = set()
    for call in ast.walk(handler.args):
        if (
            isinstance(call, ast.Call)
            and isinstance(call.func, ast.Name)
            and call.func.id == "require_permission"
        ):
            names.update(
                arg.value
                for arg in call.args
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
            )
    return names


class TestElectionResponseViewerConvention:
    def test_the_scan_sees_the_builder_callers(self):
        # An empty scan would make the check below pass for the wrong reason.
        handlers = {handler.name for handler, _ in _handlers_calling_builder()}

        assert {"create_election", "get_election"} <= handlers

    def test_a_call_without_viewer_is_behind_elections_manage(self):
        offenders = [
            handler.name
            for handler, call in _handlers_calling_builder()
            if not any(keyword.arg == "viewer" for keyword in call.keywords)
            and _required_permissions(handler) != {"elections.manage"}
        ]

        assert not offenders, (
            f"These routes call {_BUILDER} without viewer= but are not gated "
            f"by elections.manage alone: {offenders}. Pass viewer=current_user, "
            f"or the manager-only nominations announcement reaches every voter."
        )
