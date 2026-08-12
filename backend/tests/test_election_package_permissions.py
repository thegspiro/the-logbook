"""Regression tests for applicant PII access through election packages."""

import ast
from pathlib import Path

import pytest


def _permission_names(handler_name: str) -> set[str]:
    """Return permissions accepted by the handler's permission dependency."""
    endpoint_path = (
        Path(__file__).parents[1] / "app/api/v1/endpoints/membership_pipeline.py"
    )
    tree = ast.parse(endpoint_path.read_text())
    handler = next(
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == handler_name
    )
    permission_call = next(
        node
        for node in ast.walk(handler.args)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "require_permission"
    )
    return {ast.literal_eval(argument) for argument in permission_call.args}


@pytest.mark.parametrize(
    "handler_name", ["get_election_package", "list_election_packages"]
)
def test_election_package_reads_reject_baseline_elections_view(handler_name):
    """Election packages contain applicant PII, unlike ordinary election data."""
    permissions = _permission_names(handler_name)

    assert permissions == {
        "prospective_members.view",
        "prospective_members.manage",
        "elections.manage",
    }
