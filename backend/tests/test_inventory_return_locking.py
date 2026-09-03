"""Concurrent return/check-in of the same holding record must not
double-credit stock or silently re-record an already-closed check-in
(CLAUDE.md pitfall #27) -- and the fix must lock in the same order as every
other holding-mutation method in this file, or it trades one race for a
deadlock risk.

``return_to_pool`` and ``checkin_item`` each read a status-bearing row
(``ItemIssuance.is_returned`` / ``CheckOutRecord.is_returned``), check that
flag, and mutate the associated ``InventoryItem``. Locking only the item does
not serialize two callers racing on the same issuance/checkout: without a
lock on the holding row itself, both callers can read ``is_returned ==
False`` before either commits, so the second call proceeds on a stale
in-memory copy and mutates it (and, for a pool item, double-credits
``InventoryItem.quantity``) even though the first call already closed it out.
This is the identical shape ``review_return_request``'s INV-10 fix closed on
``ReturnRequest``.

Lock order matters as much as the lock itself.
``review_return_request``, ``transfer_item_holding`` and ``unassign_item``
all lock the ``InventoryItem`` row *before* locking the holding record they
mutate. A first version of this fix locked the holding record first instead
(the smaller diff, but the wrong order) -- which is invisible in review and
in every test that does not race this method against one of those three,
because the fix genuinely closes the race it was written for. It only shows
up as an intermittent InnoDB deadlock when two methods with opposite lock
orders contend for the same item + holding pair at the same time, which is
exactly the shape Pitfall #27's own capacity-locking guidance warns is easy
to get wrong in review. So this file asserts the item lock's helper call
(``_get_item_locked``) appears before the holding row's own
``.with_for_update()`` in source, not just that both locks exist.

Source-inspection, matching
``test_inventory_return_receipt.py::test_review_return_request_locks_the_request_row``:
fails on reintroduction of either the missing lock or the wrong order,
rather than needing a real concurrency reproduction.
"""

import inspect

from app.services.inventory_service import InventoryService


def test_return_to_pool_locks_the_issuance_row():
    """Two concurrent returns of the same issuance must not both proceed on
    a plain (unlocked) read of the issuance -- the second would double-credit
    item.quantity from a stale in-memory copy instead of seeing the first
    return's result. The issuance's locking re-read has to happen before
    is_returned is checked."""
    source = inspect.getsource(InventoryService.return_to_pool)
    lookup = source.split("if issuance.is_returned")[0]
    assert "with_for_update" in lookup, (
        "return_to_pool's ItemIssuance lookup must use .with_for_update() "
        "before checking issuance.is_returned"
    )


def test_return_to_pool_locks_the_item_before_the_issuance():
    """The item lock must come first, matching review_return_request /
    transfer_item_holding / unassign_item -- locking the issuance first
    would put this method's lock order backwards relative to those, an
    InnoDB deadlock risk when they race on the same item + issuance pair."""
    source = inspect.getsource(InventoryService.return_to_pool)
    item_lock_pos = source.find("_get_item_locked(")
    issuance_lock_pos = source.find(".with_for_update()")
    assert item_lock_pos != -1
    assert issuance_lock_pos != -1
    assert item_lock_pos < issuance_lock_pos, (
        "return_to_pool must lock the InventoryItem row (_get_item_locked) "
        "before locking the ItemIssuance row (.with_for_update()), matching "
        "review_return_request/transfer_item_holding/unassign_item's order"
    )


def test_checkin_item_locks_the_checkout_row():
    """Two concurrent check-ins of the same checkout must not both proceed
    on a plain (unlocked) read of the checkout -- the second would silently
    re-record a check-in (its own condition/damage_notes) over the first's
    already-committed result instead of being rejected. The checkout's
    locking re-read has to happen before is_returned is checked."""
    source = inspect.getsource(InventoryService.checkin_item)
    lookup = source.split("if checkout.is_returned")[0]
    assert "with_for_update" in lookup, (
        "checkin_item's CheckOutRecord lookup must use .with_for_update() "
        "before checking checkout.is_returned"
    )


def test_checkin_item_locks_the_item_before_the_checkout():
    """The item lock must come first, matching review_return_request /
    transfer_item_holding / unassign_item -- locking the checkout first
    would put this method's lock order backwards relative to those, an
    InnoDB deadlock risk when they race on the same item + checkout pair."""
    source = inspect.getsource(InventoryService.checkin_item)
    item_lock_pos = source.find("_get_item_locked(")
    checkout_lock_pos = source.find(".with_for_update()")
    assert item_lock_pos != -1
    assert checkout_lock_pos != -1
    assert item_lock_pos < checkout_lock_pos, (
        "checkin_item must lock the InventoryItem row (_get_item_locked) "
        "before locking the CheckOutRecord row (.with_for_update()), "
        "matching review_return_request/transfer_item_holding/"
        "unassign_item's order"
    )
