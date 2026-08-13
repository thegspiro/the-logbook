"""Permission gates for compliance configuration (incl. admin-hours requirements).

Compliance profiles carry the per-category required admin hours members are
graded against. Owner decision (2026-08-13): the people who set those rules —
compliance officers and elected officers (President, Vice President,
Secretary) — hold compliance.manage, not necessarily settings.manage, so the
profile endpoints must accept either. The read endpoints the config page loads
must accept compliance.manage so the same officers can see the current rules,
without exposing organization-level configuration to baseline members who hold
compliance.view.

Asserted against the endpoint source (AST) the same way
test_election_package_permissions.py does: the gate is a decorator argument,
and a request-level test would need the full auth stack to reach it.
"""

import ast
from pathlib import Path

import pytest

from app.core.permissions import DEFAULT_POSITIONS


def _permission_names(handler_name: str) -> set[str]:
    """Return permissions accepted by the handler's permission dependency."""
    endpoint_path = (
        Path(__file__).parents[1] / "app/api/v1/endpoints/compliance_config.py"
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
    "handler_name",
    [
        "create_compliance_profile",
        "update_compliance_profile",
        "delete_compliance_profile",
        "update_compliance_config",
        "initialize_compliance_config",
    ],
)
def test_compliance_writes_accept_compliance_manage(handler_name):
    assert _permission_names(handler_name) == {
        "settings.manage",
        "compliance.manage",
    }


@pytest.mark.parametrize(
    "handler_name", ["get_compliance_config", "get_available_requirements"]
)
def test_compliance_reads_accept_manage_permissions(handler_name):
    # compliance.manage is listed on the reads too: manage does not imply view
    # in this permission model, and a position holding only compliance.manage
    # passes the write gates but could not hydrate the config page otherwise.
    assert _permission_names(handler_name) == {
        "training.manage",
        "compliance.manage",
    }


def test_report_listing_accepts_officer_view_permissions():
    # Stored reports contain recipient addresses and generation errors, so the
    # baseline compliance.view permission must not grant access.
    assert _permission_names("list_compliance_reports") == {
        "training.manage",
        "reports.view",
    }


@pytest.mark.parametrize(
    "handler_name", ["generate_compliance_report", "email_compliance_report"]
)
def test_report_actions_accept_reports_manage(handler_name):
    # The report tab renders generate/email for everyone who can open the
    # page; elected officers hold reports.manage without training.manage.
    assert _permission_names(handler_name) == {
        "training.manage",
        "reports.manage",
    }


def test_report_deletion_accepts_reports_manage():
    assert _permission_names("delete_compliance_report") == {
        "settings.manage",
        "reports.manage",
    }


@pytest.mark.parametrize(
    "slug",
    ["president", "vice_president", "secretary", "safety_officer", "training_officer"],
)
def test_officer_positions_hold_compliance_manage(slug):
    """The positions expected to set member hour requirements can actually
    reach the profile endpoints (new orgs seed positions from these templates;
    existing orgs manage position permissions in the admin UI)."""
    assert "compliance.manage" in DEFAULT_POSITIONS[slug]["permissions"]


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
