"""Two read-then-write capacity/existence decisions in inventory_service.py
that had no lock on anything -- CLAUDE.md pitfall #27, and the specific
"there is no row to lock yet" shape FAC-42/43/45 and DOC-28 hardened
``ensure_facility_folder``/``ensure_member_folder`` into and
``push_service.py``'s push-subscription cap already uses.

Both are source-inspection tests, matching
``test_inventory_return_locking.py``'s established style for this rotation:
they assert the actual locking helper is called by name, in the right
position relative to the decision it guards, rather than merely that
``with_for_update()`` appears somewhere in the method's source (which would
pass even if the lock covered the wrong row, or covered nothing the decision
actually depends on).

``pin_item`` (Codex review of PR #2422): reads a member's current pin count
against ``MAX_PINS`` and, if under the cap, inserts at the next position --
with no lock on anything and no locking read. Two concurrent pin requests for
two different items can both read the same count, both pass the cap, and
both insert, leaving more pins than the cap allows with duplicate
``position`` values. Fixed by locking the member's own ``User`` row (which
always exists, unlike the not-yet-inserted pin row) before a locking
``COUNT`` — mirroring ``push_service.py``'s ``_MAX_PUSH_SUBSCRIPTIONS_PER_USER``
cap exactly.

``create_size_variants``/``_find_variant_group_for_reuse`` (Codex review of
PR #2422): deciding whether to reuse an existing ``ItemVariantGroup`` or
create a new one for a product name+category is a read-then-write, and the
existing ``.with_for_update()`` on the reuse lookup only serializes runs
*after* the first — a group that does not exist yet has no row to lock, so
two simultaneous first runs for the same never-before-seen product can both
observe "no group" and both create one. Fixed by locking the ``Organization``
row (which always exists) before the reuse lookup, the same
parent-locked-first shape ``ensure_facility_folder``/``ensure_member_folder``
use for their own get-or-create.
"""

import inspect

from app.services.inventory_service import InventoryService


def test_pin_item_locks_the_member_row_before_counting_pins():
    """The pin cap is decided from a count of the member's own pins; that
    decision has to be serialized on something that already exists before
    the count is even taken, or two concurrent pins of different items can
    both read the same (stale) count and both pass the cap."""
    source = inspect.getsource(InventoryService.pin_item)
    cap_check_pos = source.find(">= self.MAX_PINS")
    assert cap_check_pos != -1, "pin_item must still check MAX_PINS"

    user_lock_pos = source.find("select(User.id)")
    assert user_lock_pos != -1, (
        "pin_item must lock the member's own User row (select(User.id)...) "
        "before deciding whether the pin cap has been reached"
    )
    assert user_lock_pos < cap_check_pos, (
        "pin_item must lock the member's own User row (select(User.id)...) "
        "before deciding whether the pin cap has been reached"
    )
    assert "with_for_update()" in source[user_lock_pos:cap_check_pos], (
        "the User row lookup in pin_item must be a locking read " "(.with_for_update())"
    )


def test_pin_item_counts_existing_pins_with_a_locking_read():
    """Locking the User row alone is not enough: under REPEATABLE READ a
    plain SELECT still answers from the snapshot taken before the lock was
    acquired, so the count itself must also be a locking read
    (CLAUDE.md pitfall #27's second half)."""
    source = inspect.getsource(InventoryService.pin_item)
    cap_check_pos = source.find(">= self.MAX_PINS")
    assert cap_check_pos != -1

    count_query_pos = source.rfind("select(func.count())", 0, cap_check_pos)
    assert count_query_pos != -1, (
        "pin_item must decide the cap from a SQL COUNT of the member's pins, "
        "not a Python len() of a fetched list"
    )
    assert "with_for_update()" in source[count_query_pos:cap_check_pos], (
        "pin_item's pin-count query must be a locking read "
        "(.with_for_update()) between the count and the MAX_PINS check"
    )


def test_create_size_variants_locks_the_organization_before_reusing_a_variant_group():
    """_find_variant_group_for_reuse's own .with_for_update() only locks a
    group row that already exists -- it cannot serialize two simultaneous
    first runs for a never-before-seen product, since neither has a row to
    lock. The caller must lock the (always-existing) Organization row first,
    the same parent-locked-first shape ensure_facility_folder/
    ensure_member_folder use for their own get-or-create."""
    source = inspect.getsource(InventoryService.create_size_variants)
    reuse_call_pos = source.find("_find_variant_group_for_reuse(")
    assert (
        reuse_call_pos != -1
    ), "create_size_variants must still call _find_variant_group_for_reuse"

    org_lock_pos = source.find("select(Organization.id)")
    assert org_lock_pos != -1, (
        "create_size_variants must lock the Organization row "
        "(select(Organization.id)...) before calling "
        "_find_variant_group_for_reuse, so two concurrent first-time "
        "creates of the same product serialize instead of both creating a "
        "group"
    )
    assert org_lock_pos < reuse_call_pos, (
        "create_size_variants must lock the Organization row "
        "(select(Organization.id)...) before calling "
        "_find_variant_group_for_reuse, so two concurrent first-time "
        "creates of the same product serialize instead of both creating a "
        "group"
    )
    assert "with_for_update()" in source[org_lock_pos:reuse_call_pos], (
        "the Organization row lookup before _find_variant_group_for_reuse "
        "must be a locking read (.with_for_update())"
    )
