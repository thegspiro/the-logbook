"""Regression tests for applicant PII access through election packages."""

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

_REPO = Path(__file__).parents[2]


def _checker():
    """scripts/check_endpoint_permissions.py, which resolves every way a route
    can enforce a permission, the per-applicant access dependencies included."""
    spec = importlib.util.spec_from_file_location(
        "check_endpoint_permissions", _REPO / "scripts/check_endpoint_permissions.py"
    )
    module = importlib.util.module_from_spec(spec)
    # Registered before running: its dataclasses look their module up by name.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _permission_names(handler_name: str) -> set[str]:
    """Permissions the handler accepts, as the endpoint checker reads them."""
    checker = _checker()
    endpoint_path = _REPO / "backend/app/api/v1/endpoints/membership_pipeline.py"
    tree = ast.parse(endpoint_path.read_text())
    handler = next(
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == handler_name
    )
    return checker.enforced_permissions(
        handler,
        checker.authorizer_permissions(tree),
        checker.module_permission_constants(tree),
    )


@pytest.mark.parametrize(
    "handler_name", ["get_election_package", "list_election_packages"]
)
def test_election_package_reads_reject_baseline_elections_view(handler_name):
    """Election packages contain applicant PII, unlike ordinary election data.

    Since per-applicant access, seeing them takes prospective_members.view_all
    (or, for one applicant, an assignment as case manager); elections.manage
    still reads them for building ballots. elections.view, which every member
    holds, never does.
    """
    permissions = _permission_names(handler_name)

    assert permissions == {"prospective_members.view_all", "elections.manage"}
    assert "elections.view" not in permissions
