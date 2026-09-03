"""Inventory: what the department owns, what is low, what is overdue.

Medical supplies are a separate domain with their own module, page and
officer (``medical_supplies``); the inventory API carves them out of the
gear-and-uniforms listing, and every tool here does the same. They are not
exposed through this connection at all.
"""

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    member_names,
    org_uuid,
    page,
)
from app.models.inventory import MEDICAL_ITEM_TYPES, ItemStatus
from app.services.inventory_service import InventoryService


def register(server: Any) -> None:
    @logbook_tool(server, title="Inventory summary", module="inventory")
    async def get_inventory_summary(db: AsyncSession, principal: McpPrincipal) -> dict:
        """Totals for the inventory: items, value, assigned, checked out,
        in maintenance, and low-stock categories. Medical supplies are not
        counted."""
        return await InventoryService(db).get_inventory_summary(
            org_uuid(principal), exclude_item_types=MEDICAL_ITEM_TYPES
        )

    @logbook_tool(server, title="Low stock", module="inventory")
    async def list_low_stock_items(
        db: AsyncSession, principal: McpPrincipal, limit: int = 50, offset: int = 0
    ) -> dict:
        """Categories whose stock has fallen below their reorder point, by
        name, with the item names involved. Medical supplies are not
        included. Paged; ``has_more`` says whether to ask for the next page."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        # One row past the page decides ``has_more`` without a second
        # aggregate query.
        items = await InventoryService(db).get_low_stock_items(
            org_uuid(principal),
            exclude_item_types=MEDICAL_ITEM_TYPES,
            skip=offset,
            limit=limit + 1,
        )
        body = page(items[:limit], None, limit, offset)
        body["has_more"] = len(items) > limit
        return body

    @logbook_tool(server, title="List inventory items", module="inventory")
    async def list_inventory_items(
        db: AsyncSession,
        principal: McpPrincipal,
        search: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Gear, uniforms and equipment with quantity, condition, status,
        location and who they are assigned to; medical supplies are not
        listed. ``status`` is available, assigned, checked_out,
        in_maintenance, lost or stolen."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        status_enum = None
        if status:
            try:
                status_enum = ItemStatus(status.lower())
            except ValueError:
                raise ValueError(f"Unknown status: {status}")
        items, total = await InventoryService(db).get_items(
            org_uuid(principal),
            status=status_enum,
            exclude_item_types=MEDICAL_ITEM_TYPES,
            search=search or None,
            skip=offset,
            limit=limit,
        )
        names = await member_names(
            db, principal.organization_id, (i.assigned_to_user_id for i in items)
        )
        rendered = [
            {
                "id": i.id,
                "name": i.name,
                "description": i.description,
                "category": getattr(getattr(i, "category", None), "name", None),
                "manufacturer": i.manufacturer,
                "model_number": i.model_number,
                "asset_tag": i.asset_tag,
                "size": i.size,
                "color": i.color,
                "condition": iso(i.condition),
                "status": iso(i.status),
                "quantity": i.quantity,
                "quantity_issued": i.quantity_issued,
                "unit_of_measure": i.unit_of_measure,
                "reorder_point": i.reorder_point,
                "storage_location": i.storage_location,
                "station": i.station,
                "assigned_to_member_id": i.assigned_to_user_id,
                "assigned_to": names.get(i.assigned_to_user_id or ""),
                "next_inspection_due": iso(i.next_inspection_due),
                "warranty_expiration": iso(i.warranty_expiration),
            }
            for i in items
        ]
        return page(rendered, total, limit, offset)

    @logbook_tool(server, title="Overdue checkouts", module="inventory")
    async def list_overdue_checkouts(
        db: AsyncSession, principal: McpPrincipal, limit: int = 100, offset: int = 0
    ) -> dict:
        """Items checked out past their expected return date, with who has
        them and how long they have been out; medical supplies are not
        included. Page with ``limit`` and ``offset``."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        records = await InventoryService(db).get_overdue_checkouts(
            org_uuid(principal),
            skip=offset,
            limit=limit,
            exclude_item_types=MEDICAL_ITEM_TYPES,
        )
        names = await member_names(
            db, principal.organization_id, (r.user_id for r in records)
        )
        items = [
            {
                "id": r.id,
                "item_id": r.item_id,
                "member_id": r.user_id,
                "member_name": names.get(r.user_id),
                "checked_out_at": iso(r.checked_out_at),
                "expected_return_at": iso(r.expected_return_at),
                "checkout_reason": r.checkout_reason,
            }
            for r in records
        ]
        return page(items, None, limit, offset)
