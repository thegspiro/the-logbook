"""
The inventory dashboard's three summary endpoints must scope alike.

`/inventory/summary` branches: an admin gets the department's summary, a member
gets their own holdings. `/inventory/low-stock` returns a member an empty list.
`/inventory/summary/by-location` did neither — it returned the department's
per-location item counts and valuations to anyone holding `inventory.view`.

The effect was visible on the member's own page: their header read "3 items ·
$4,170", and the panel immediately beneath it reported the department's 137
items and $39,288 across its locations. The release note for the scoping says
non-admins "see only their own assigned equipment", so this was documented
behaviour that had never been true of the whole page.

Source assertions — the branch is a permission check inside the handler, and
exercising it end-to-end needs a member session against a live database.
"""

import inspect

import pytest

from app.api.v1.endpoints import inventory

# The endpoints that make up the member-visible inventory dashboard. Each has
# to decide what a non-admin sees rather than answering with the department's.
SCOPED_ENDPOINTS = [
    "get_inventory_summary",
    "get_summary_by_location",
    "get_low_stock_alerts",
]


@pytest.mark.parametrize("name", SCOPED_ENDPOINTS)
def test_the_endpoint_exists(name):
    assert hasattr(inventory, name), f"{name} was renamed — update this test"


@pytest.mark.parametrize("name", SCOPED_ENDPOINTS)
def test_the_endpoint_branches_on_admin(name):
    """Every one of the three asks whether the caller manages inventory."""
    source = inspect.getsource(getattr(inventory, name))
    assert "inventory.manage" in source, (
        f"{name} does not distinguish an admin from a member — it answers "
        "every caller with the department's figures"
    )


def test_by_location_returns_nothing_to_a_member():
    """An empty list, so the location panel does not render at all."""
    source = inspect.getsource(inventory.get_summary_by_location)
    assert "if not is_admin:" in source
    assert "return []" in source
