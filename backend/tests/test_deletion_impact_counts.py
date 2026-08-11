"""
Tests for the deletion-impact preview's inventory count.

The preview is the only thing standing between an administrator and a
permanent delete, so a count that reads 0 when the member is holding gear is
worse than no preview at all — it actively says the deletion is free.

It read 0 for every member in the system. The endpoint imported
`InventoryAssignment` from `app.models.inventory`, a class that has never
existed there (the models are `ItemAssignment` and `ItemIssuance`), and the
resulting ImportError was swallowed by a bare `except Exception: pass` that
left the count at its initialized zero. Nothing failed, nothing logged, and
the number looked like a fact.

These tests pin the two things that let that survive: that the models the
endpoint counts are the ones that exist, and that no count in the handler is
wrapped in a swallow that can turn an error into a zero.
"""

import ast
import inspect
from pathlib import Path

import pytest

from app.api.v1.endpoints import users as users_endpoints
from app.models.inventory import ItemAssignment, ItemIssuance


def _deletion_impact_source() -> str:
    return inspect.getsource(users_endpoints.get_deletion_impact)


def test_counted_models_expose_the_columns_the_endpoint_filters_on():
    # Individually-tracked gear is "still out" while is_active; pool stock is
    # "still out" until returned_at is set. Neither column is on both models,
    # which is why the endpoint runs two queries rather than one.
    assert hasattr(ItemAssignment, "is_active")
    assert hasattr(ItemAssignment, "user_id")
    assert hasattr(ItemIssuance, "returned_at")
    assert hasattr(ItemIssuance, "user_id")


def test_the_model_the_bug_imported_does_not_exist():
    """Guards the fix itself: reintroducing the name would resurrect the zero."""
    import app.models.inventory as inventory_models

    assert not hasattr(inventory_models, "InventoryAssignment")


def test_endpoint_counts_both_assignments_and_issuances():
    source = _deletion_impact_source()
    assert "ItemAssignment" in source
    assert "ItemIssuance" in source


def test_no_count_is_wrapped_in_a_swallow():
    """A bare `except: pass` here converts a broken query into a benign zero."""
    tree = ast.parse(inspect.getsource(users_endpoints.get_deletion_impact).lstrip())
    for node in ast.walk(tree):
        if not isinstance(node, ast.ExceptHandler):
            continue
        swallows = all(isinstance(stmt, ast.Pass) for stmt in node.body)
        assert not swallows, (
            "get_deletion_impact swallows an exception; a failed count would "
            "be reported to the operator as 0 records affected"
        )


@pytest.mark.parametrize("model", [ItemAssignment, ItemIssuance])
def test_counted_models_are_org_scoped(model):
    # Not exercised by the count itself — the user id already narrows to one
    # org — but a later filter added here must have the column to scope on.
    assert hasattr(model, "organization_id")


def test_endpoint_module_imports_its_models_at_top_level():
    """
    Function-local imports are what made the failure invisible: an ImportError
    raised inside a request handler is indistinguishable from a query error,
    and both were being swallowed. At module scope a bad name fails at import,
    where the test suite sees it.
    """
    source = Path(inspect.getfile(users_endpoints)).read_text()
    header = source.split("router = APIRouter()")[0]
    for name in ("ItemAssignment", "ItemIssuance", "Document"):
        assert name in header, f"{name} is not imported at module scope"
