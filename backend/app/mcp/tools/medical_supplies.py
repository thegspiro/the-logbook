"""Medical supply stock. Listed only when the department turns it on.

The same read the Medical Supplies page makes, through the same domain pin:
every query names ``MEDICAL_ITEM_TYPES``, so these tools cannot reach gear or
uniforms, and the inventory tools cannot reach this. Read-only — a reorder
request for a medical item is refused whatever the switch says.

Each tool builds its result from an explicit field list. A lot's free-text
``notes`` and its ``unit_cost`` are deliberately left out: the first is
whatever an officer typed, the second is finance data the department shares
through its own switch.
"""

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import clamp_limit, clamp_offset, iso, org_uuid, page
from app.models.inventory import MEDICAL_ITEM_TYPES
from app.services.inventory_service import InventoryService
from app.utils.org_timezone import resolve_org_today

# The Medical Supplies page's own bounds for "expiring within".
MAX_DAYS_AHEAD = 365

# The same permissions the Medical Supplies page's read routes accept.
VIEW_PERMISSIONS = ("inventory.view_medical", "inventory.view")


def _days_ahead(value: Optional[int]) -> int:
    if value is None or value < 1:
        return 30
    return min(value, MAX_DAYS_AHEAD)


def register(server: Any) -> None:
    @logbook_tool(
        server,
        title="Medical supply summary",
        gate="medical_supplies",
        module="medical_supplies",
        permissions=VIEW_PERMISSIONS,
    )
    async def get_medical_supply_summary(
        db: AsyncSession, principal: McpPrincipal, expiring_within_days: int = 30
    ) -> dict:
        """Headline counts for medical supplies: active items, lots expiring
        within ``expiring_within_days`` (default 30, at most 365), lots
        already expired, and items at or below their reorder point."""
        days = _days_ahead(expiring_within_days)
        service = InventoryService(db)
        org_id = principal.organization_id
        _items, total = await service.get_items(
            organization_id=org_uuid(principal),
            item_types=MEDICAL_ITEM_TYPES,
            active_only=True,
            limit=1,
        )
        today = await resolve_org_today(db, org_id)
        expiring = await service.get_expiring_lots(
            org_id, days, item_types=MEDICAL_ITEM_TYPES, today=today
        )
        expired = sum(
            1
            for lot, _ in expiring
            if lot.expiration_date and lot.expiration_date < today
        )
        low = await service.get_low_stock_items_for_alerts(
            org_uuid(principal), item_types=MEDICAL_ITEM_TYPES
        )
        return {
            "total_items": total,
            "expiring_soon": len(expiring) - expired,
            "expired": expired,
            "low_stock": len(low),
            "expiring_within_days": days,
            "as_of": iso(today),
        }

    @logbook_tool(
        server,
        title="List medical supplies",
        gate="medical_supplies",
        module="medical_supplies",
        permissions=VIEW_PERMISSIONS,
    )
    async def list_medical_supply_items(
        db: AsyncSession,
        principal: McpPrincipal,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Active medical supply items with category, quantity on record,
        unit, reorder point, storage location and station. ``search``
        matches the item name. Quantities kept in lots are reported by
        ``list_expiring_medical_lots``."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        items, total = await InventoryService(db).get_items(
            organization_id=org_uuid(principal),
            item_types=MEDICAL_ITEM_TYPES,
            active_only=True,
            search=search or None,
            skip=offset,
            limit=limit,
        )
        rendered = [
            {
                "id": i.id,
                "name": i.name,
                "category": getattr(getattr(i, "category", None), "name", None),
                "manufacturer": i.manufacturer,
                "model_number": i.model_number,
                "status": iso(i.status),
                "condition": iso(i.condition),
                "quantity": i.quantity,
                "unit_of_measure": i.unit_of_measure,
                "reorder_point": i.reorder_point,
                "storage_location": i.storage_location,
                "station": i.station,
            }
            for i in items
        ]
        return page(rendered, total, limit, offset)

    @logbook_tool(
        server,
        title="Medical supplies low on stock",
        gate="medical_supplies",
        module="medical_supplies",
        permissions=VIEW_PERMISSIONS,
    )
    async def list_low_stock_medical_supplies(
        db: AsyncSession, principal: McpPrincipal, limit: int = 50, offset: int = 0
    ) -> dict:
        """Medical supply items at or below the reorder point the department
        set for them, with what is on hand. On hand counts unexpired lots for
        an item stocked in lots, and the item's quantity otherwise."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        rows = await InventoryService(db).get_low_stock_items_for_alerts(
            org_uuid(principal), item_types=MEDICAL_ITEM_TYPES
        )
        rendered = [
            {
                "id": item.id,
                "name": item.name,
                "on_hand": on_hand,
                "reorder_point": item.reorder_point,
                "unit_of_measure": item.unit_of_measure,
                "counted_from_lots": from_lots,
            }
            for item, on_hand, from_lots in rows
        ]
        return page(rendered[offset : offset + limit], len(rendered), limit, offset)

    @logbook_tool(
        server,
        title="Expiring medical supply lots",
        gate="medical_supplies",
        module="medical_supplies",
        permissions=VIEW_PERMISSIONS,
    )
    async def list_expiring_medical_lots(
        db: AsyncSession,
        principal: McpPrincipal,
        days_ahead: int = 30,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """In-stock medical supply lots expiring within ``days_ahead`` days
        (default 30, at most 365), including lots already expired, with the
        item name, lot number, quantity, storage location and days left
        (negative once expired). Dates are the department's own."""
        days = _days_ahead(days_ahead)
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        org_id = principal.organization_id
        today = await resolve_org_today(db, org_id)
        rows = await InventoryService(db).get_expiring_lots(
            org_id, days, item_types=MEDICAL_ITEM_TYPES, today=today
        )
        rendered = [
            {
                "id": lot.id,
                "item_id": lot.inventory_item_id,
                "item_name": item_name,
                "lot_number": lot.lot_number,
                "expiration_date": iso(lot.expiration_date),
                "days_until_expiration": (
                    (lot.expiration_date - today).days if lot.expiration_date else None
                ),
                "quantity": lot.quantity,
                "storage_location": lot.storage_location,
            }
            for lot, item_name in rows
        ]
        body = page(rendered[offset : offset + limit], len(rendered), limit, offset)
        body["days_ahead"] = days
        body["as_of"] = iso(today)
        return body
