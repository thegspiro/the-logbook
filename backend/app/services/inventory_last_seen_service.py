"""
Inventory "Not Seen" Report

Which items nobody has laid eyes on lately. An item counts as *seen* at the
latest of:

* a tap by an inventory manager (``inventory_nfc_scans`` — lookups, put-aways
  by tap, shelf audits),
* an assignment to a member or its return (``item_assignments``),
* a checkout or check-in (``checkout_records``),
* a pool issuance or its return (``item_issuances``).

Each of those is a moment a person handled the item and the system wrote it
down. Edits to the item record do not count — renaming a helmet at a desk says
nothing about where it is — and neither does a barcode put-away, which is
recorded only as an audit-log event with no per-item row to read.

The report does not depend on the NFC switch: custody events alone make it
useful, and an organization that has never tagged anything still gets a list.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import (
    CheckOutRecord,
    InventoryItem,
    InventoryNfcScan,
    ItemAssignment,
    ItemIssuance,
    ItemStatus,
    StorageArea,
)

# The sources, in the order a tie is reported: when two events share the same
# instant, the tap is the more specific evidence of where the item was.
SOURCE_NFC_TAP = "nfc_tap"
SOURCE_ASSIGNMENT = "assignment"
SOURCE_RETURN = "return"
SOURCE_CHECKOUT = "checkout"
SOURCE_CHECK_IN = "check_in"
SOURCE_ISSUANCE = "issuance"
SOURCE_ISSUANCE_RETURN = "issuance_return"

MAX_ROWS = 5000
DEFAULT_DAYS = 180


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """MySQL DATETIME comes back naive; every stored time is UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class InventoryLastSeenService:
    """Builds the not-seen report."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def not_seen(
        self,
        organization_id: str,
        *,
        days: int = DEFAULT_DAYS,
        category_id: Optional[str] = None,
        limit: int = 500,
        now: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Active items not seen in ``days`` days, never-seen first, then oldest.

        Returns ``{"items", "total", "cutoff"}``; ``total`` counts every match
        even when ``items`` is cut to ``limit``.
        """
        org_id = str(organization_id)
        now = now or datetime.now(timezone.utc)
        cutoff = now - timedelta(days=days)

        query = (
            select(InventoryItem)
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.active.is_(True),
                # A retired item is not expected to be seen again.
                InventoryItem.status != ItemStatus.RETIRED,
            )
            .options(selectinload(InventoryItem.category))
        )
        if category_id:
            query = query.where(InventoryItem.category_id == str(category_id))
        items = list((await self.db.execute(query)).scalars().all())

        last_seen = await self._last_seen_by_item(org_id)

        rows: List[Tuple[Optional[datetime], InventoryItem, Optional[str]]] = []
        for item in items:
            seen_at, source = last_seen.get(item.id, (None, None))
            if seen_at is None or seen_at < cutoff:
                rows.append((seen_at, item, source))

        # Never seen first; then the longest unseen. Name then id keeps the
        # order stable between runs.
        rows.sort(
            key=lambda r: (
                r[0] is not None,
                r[0] or now,
                (r[1].name or "").lower(),
                r[1].id,
            )
        )
        total = len(rows)
        rows = rows[: max(1, min(limit, MAX_ROWS))]

        areas = await self._area_name_map(
            org_id, {item.storage_area_id for _, item, _ in rows}
        )
        return {
            "cutoff": cutoff,
            "total": total,
            "items": [
                {
                    "id": item.id,
                    "name": item.name,
                    "serial_number": item.serial_number,
                    "asset_tag": item.asset_tag,
                    "category_name": item.category.name if item.category else None,
                    "status": item.status,
                    "storage_area_name": areas.get(item.storage_area_id),
                    "last_seen_at": seen_at,
                    "last_seen_source": source,
                    "days_since_seen": (
                        (now - seen_at).days if seen_at is not None else None
                    ),
                }
                for seen_at, item, source in rows
            ],
        }

    async def _last_seen_by_item(
        self, organization_id: str
    ) -> Dict[str, Tuple[datetime, str]]:
        """Latest event per item across every source, with the source's name.

        One grouped query per column rather than a UNION: each is a simple
        aggregate over an org-scoped table, and picking the winner in Python
        is what lets the report say *which* event it was.
        """
        sources = [
            (SOURCE_NFC_TAP, InventoryNfcScan, InventoryNfcScan.scanned_at),
            (SOURCE_ASSIGNMENT, ItemAssignment, ItemAssignment.assigned_date),
            (SOURCE_RETURN, ItemAssignment, ItemAssignment.returned_date),
            (SOURCE_CHECKOUT, CheckOutRecord, CheckOutRecord.checked_out_at),
            (SOURCE_CHECK_IN, CheckOutRecord, CheckOutRecord.checked_in_at),
            (SOURCE_ISSUANCE, ItemIssuance, ItemIssuance.issued_at),
            (SOURCE_ISSUANCE_RETURN, ItemIssuance, ItemIssuance.returned_at),
        ]
        latest: Dict[str, Tuple[datetime, str]] = {}
        for source, model, column in sources:
            result = await self.db.execute(
                select(model.item_id, func.max(column))
                .where(
                    model.organization_id == organization_id,
                    column.is_not(None),
                )
                .group_by(model.item_id)
            )
            for item_id, raw in result.all():
                seen_at = _as_utc(raw)
                if seen_at is None:
                    continue
                current = latest.get(item_id)
                # Strictly later only, so an earlier source wins a tie.
                if current is None or seen_at > current[0]:
                    latest[item_id] = (seen_at, source)
        return latest

    async def _area_name_map(
        self, organization_id: str, area_ids: set
    ) -> Dict[str, str]:
        ids = {str(a) for a in area_ids if a}
        if not ids:
            return {}
        result = await self.db.execute(
            select(StorageArea.id, StorageArea.name).where(
                StorageArea.id.in_(ids),
                StorageArea.organization_id == organization_id,
            )
        )
        return {row.id: row.name for row in result}
