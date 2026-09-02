"""Concurrent return/check-in of the same holding record must not
double-credit stock or silently re-record an already-closed check-in
(CLAUDE.md pitfall #27).

``return_to_pool`` and ``checkin_item`` each read a status-bearing row
(``ItemIssuance.is_returned`` / ``CheckOutRecord.is_returned``), check that
flag, and only *afterward* lock the associated ``InventoryItem`` row. Locking
the item does not serialize two callers racing on the same issuance/checkout:
without a lock on that row itself, both callers can read ``is_returned ==
False`` before either commits, so the second call proceeds on a stale
in-memory copy of the record and mutates it (and, for a pool item,
double-credits ``InventoryItem.quantity``) even though the first call already
closed it out. This is the identical shape ``review_return_request``'s INV-10
fix closed on ``ReturnRequest`` -- these two sibling methods were missed.

Source-inspection, matching
``test_inventory_return_receipt.py::test_review_return_request_locks_the_request_row``:
fails on reintroduction of either fix rather than needing a real concurrency
reproduction.
"""

import inspect

from app.services.inventory_service import InventoryService


def test_return_to_pool_locks_the_issuance_row():
    """Two concurrent returns of the same issuance must not both proceed on
    a plain (unlocked) read -- the second would double-credit item.quantity
    from a stale in-memory copy instead of seeing the first return's result.
    The lock has to sit on the initial lookup, before is_returned is read."""
    source = inspect.getsource(InventoryService.return_to_pool)
    lookup = source.split("if not issuance")[0]
    assert "with_for_update" in lookup, (
        "return_to_pool's ItemIssuance lookup must use .with_for_update() "
        "before checking issuance.is_returned"
    )


def test_checkin_item_locks_the_checkout_row():
    """Two concurrent check-ins of the same checkout must not both proceed
    on a plain (unlocked) read -- the second would silently re-record a
    check-in (its own condition/damage_notes) over the first's already-
    committed result instead of being rejected. The lock has to sit on the
    initial lookup, before is_returned is read."""
    source = inspect.getsource(InventoryService.checkin_item)
    lookup = source.split("if not checkout")[0]
    assert "with_for_update" in lookup, (
        "checkin_item's CheckOutRecord lookup must use .with_for_update() "
        "before checking checkout.is_returned"
    )
