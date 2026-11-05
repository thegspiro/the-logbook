"""
Inventory sightings — the one writer of the "last seen" trail.

Every moment the system counts as somebody having seen an item is a row in
``inventory_nfc_scans``: an NFC tap (lookup, put-away, shelf audit), the
item's creation or import, and a barcode put-away. The Items Not Seen report
(``InventoryLastSeenService``) and the item's own trail both read that table,
so every path that records a sighting goes through here rather than building
the row itself (Pitfall #29).

This module imports nothing from the inventory services, so ``InventoryService``
(creation, barcode put-away) and ``InventoryNfcService`` (taps) can both use
it without importing each other.
"""

from typing import Iterable, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import InventoryItem, InventoryNfcScan, InventoryNfcScanAction


def add_sighting(
    db: AsyncSession,
    *,
    organization_id: str,
    item_id: str,
    action: InventoryNfcScanAction,
    seen_by: Optional[str],
    tag_id: Optional[str] = None,
    storage_area_id: Optional[str] = None,
    from_storage_area_id: Optional[str] = None,
) -> InventoryNfcScan:
    """Stage one sighting on the session; the caller flushes or commits.

    Never checks permissions: callers decide whether a sighting is recorded at
    all (only staff taps are, for instance).
    """
    row = InventoryNfcScan(
        organization_id=str(organization_id),
        item_id=str(item_id),
        tag_id=tag_id,
        action=action,
        storage_area_id=storage_area_id,
        from_storage_area_id=from_storage_area_id,
        scanned_by=str(seen_by) if seen_by else None,
    )
    db.add(row)
    return row


async def record_creation_sightings(
    db: AsyncSession,
    items: Iterable[InventoryItem],
    created_by: Optional[str],
) -> None:
    """Count each newly created item as seen at its creation (W44-2).

    Called by every path that creates an item, inside the creating
    transaction, so an item can never exist without its first sighting. Flushes
    first: the items' ids are assigned at flush.
    """
    items = list(items)
    if not items:
        return
    await db.flush()
    for item in items:
        add_sighting(
            db,
            organization_id=str(item.organization_id),
            item_id=str(item.id),
            action=InventoryNfcScanAction.CREATED,
            seen_by=created_by,
            storage_area_id=item.storage_area_id,
        )
    await db.flush()
