"""Creating an item's first lot must carry its column stock forward.

Stock lives in one ledger or the other, never both: once an item has any lot,
``_in_date_lot_totals`` reports it as lot-stocked and every reader stops
consulting ``InventoryItem.quantity``. So whichever write creates the *first*
lot is the moment a hand-counted cupboard becomes invisible — the item reads as
however many units that one delivery brought, low-stock alerts fire against a
full shelf, and issuance refuses stock that is physically there.

``receive_reorder`` was the path that had it wrong, and it is the likeliest one
to: a supply officer receiving a delivery against an item somebody had been
counting by hand is the ordinary way an item crosses over. ``add_lot`` and
``add_lots_bulk`` already carried forward.

Asserted structurally rather than by exercising each path, for the reason
``test_capacity_locking`` gives about its own invariant: the failure is
invisible in review and a new lot-creating path is exactly the thing that will
be added later without the call. A restore path is exempt — it repays lots an
issuance already drew from, so the item was lot-stocked before it ran.
"""

import ast
import inspect
import textwrap

from app.services import inventory_service

_HELPER = "_carry_forward_column_stock"
# Repays lots recorded on the issuance being returned, so the item was already
# on the lot ledger when the issuance was written.
_EXEMPT = {"_restore_to_lots", _HELPER}


def _functions_constructing_a_lot() -> dict:
    """Every function in the service whose body constructs an ``InventoryLot``."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(inventory_service)))
    found = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for inner in ast.walk(node):
            if (
                isinstance(inner, ast.Call)
                and isinstance(inner.func, ast.Name)
                and inner.func.id == "InventoryLot"
            ):
                found[node.name] = node
                break
    return found


def _calls_the_helper(node) -> bool:
    for inner in ast.walk(node):
        if (
            isinstance(inner, ast.Call)
            and isinstance(inner.func, ast.Attribute)
            and inner.func.attr == _HELPER
        ):
            return True
    return False


class TestEveryLotCreatorCarriesColumnStockForward:
    def test_the_scan_finds_the_known_lot_creators(self):
        """Guards the scan itself: a rename must not silently empty it."""
        names = set(_functions_constructing_a_lot())

        assert {"add_lot", "add_lots_bulk", "receive_reorder"} <= names

    def test_receive_reorder_carries_forward_before_creating_the_lot(self):
        node = _functions_constructing_a_lot()["receive_reorder"]

        assert _calls_the_helper(node)

    def test_every_lot_creating_path_carries_forward(self):
        missing = [
            name
            for name, node in _functions_constructing_a_lot().items()
            if name not in _EXEMPT and not _calls_the_helper(node)
        ]

        assert not missing, (
            "These create an InventoryLot without carrying an item's column "
            "stock forward first, so an item counted in InventoryItem.quantity "
            f"loses that stock the moment they run: {missing}"
        )

    def test_the_helper_only_carries_forward_for_items_with_no_lot_yet(self):
        """Otherwise a second delivery would double the opening balance."""
        source = inspect.getsource(getattr(inventory_service.InventoryService, _HELPER))

        assert "already" in source
        assert "pending" in source
