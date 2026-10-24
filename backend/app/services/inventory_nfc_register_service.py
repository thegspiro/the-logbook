"""
Inventory NFC Tag Register Service

The department-wide view behind the Inventory NFC Tags page: every tag on an
item, a storage area or an equipment-check compartment in one list, with what
it names and when it was last tapped, plus the quartermaster's bulk lost/found
change and moving a tag onto another target of the same kind.

Linking, relabelling and unlinking stay in ``inventory_nfc_service``; this
module reads across the organization and reuses that service's org-scoped
target lookups, so a moved tag is checked against the organization exactly as
a newly linked one is.
"""

from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.apparatus import CheckTemplateCompartment, EquipmentCheckTemplate
from app.models.inventory import (
    InventoryItem,
    InventoryNfcScan,
    InventoryNfcTag,
    InventoryNfcTagStatus,
    StorageArea,
)
from app.services.inventory_nfc_service import InventoryNfcService
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

KIND_ITEM = "item"
KIND_STORAGE_AREA = "storage_area"
KIND_COMPARTMENT = "compartment"
TAG_KINDS = (KIND_ITEM, KIND_STORAGE_AREA, KIND_COMPARTMENT)

MAX_BULK_TAGS = 200
MAX_EXPORT_ROWS = 10000
MAX_MOVE_TARGETS = 25


def tag_kind(tag: Dict[str, Any]) -> str:
    """Which kind of target a tag dict names."""
    if tag["item_id"] is not None:
        return KIND_ITEM
    if tag["storage_area_id"] is not None:
        return KIND_STORAGE_AREA
    return KIND_COMPARTMENT


class InventoryNfcRegisterService:
    """Reads and bulk changes across every inventory NFC tag in an
    organization."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._tags = InventoryNfcService(db)

    async def list_tags(
        self,
        organization_id: str,
        *,
        kind: Optional[str] = None,
        status: Optional[InventoryNfcTagStatus] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """One page of the register, ordered by what each tag names.

        ``last_scanned_at`` is the newest staff tap of the tag itself. Only item
        tags have one: the tap log records the item a tap found, and a shelf
        or compartment tap moves or opens something without naming the tag.
        """
        org_id = str(organization_id)
        # Every joined target is filtered to the organization in its join
        # condition, so a tag row can never borrow another department's name
        # (Pitfall #14a). Compartments carry no organization_id; their
        # template's is the scope.
        item = select(InventoryItem.id, InventoryItem.name).where(
            InventoryItem.organization_id == org_id
        )
        area = select(StorageArea.id, StorageArea.name).where(
            StorageArea.organization_id == org_id
        )
        compartment = (
            select(
                CheckTemplateCompartment.id,
                CheckTemplateCompartment.name,
                EquipmentCheckTemplate.name.label("template_name"),
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(EquipmentCheckTemplate.organization_id == org_id)
        )
        item_q = item.subquery()
        area_q = area.subquery()
        compartment_q = compartment.subquery()
        last_scan_q = (
            select(
                InventoryNfcScan.tag_id,
                func.max(InventoryNfcScan.scanned_at).label("last_scanned_at"),
            )
            .where(
                InventoryNfcScan.organization_id == org_id,
                InventoryNfcScan.tag_id.is_not(None),
            )
            .group_by(InventoryNfcScan.tag_id)
            .subquery()
        )
        target_name = func.coalesce(
            item_q.c.name, area_q.c.name, compartment_q.c.name, literal("")
        )

        base = (
            select(
                InventoryNfcTag,
                target_name.label("target_name"),
                compartment_q.c.template_name,
                last_scan_q.c.last_scanned_at,
            )
            .outerjoin(item_q, item_q.c.id == InventoryNfcTag.item_id)
            .outerjoin(area_q, area_q.c.id == InventoryNfcTag.storage_area_id)
            .outerjoin(
                compartment_q,
                compartment_q.c.id == InventoryNfcTag.check_compartment_id,
            )
            .outerjoin(last_scan_q, last_scan_q.c.tag_id == InventoryNfcTag.id)
            .where(InventoryNfcTag.organization_id == org_id)
        )
        if kind == KIND_ITEM:
            base = base.where(InventoryNfcTag.item_id.is_not(None))
        elif kind == KIND_STORAGE_AREA:
            base = base.where(InventoryNfcTag.storage_area_id.is_not(None))
        elif kind == KIND_COMPARTMENT:
            base = base.where(InventoryNfcTag.check_compartment_id.is_not(None))
        if status is not None:
            base = base.where(InventoryNfcTag.status == status)
        if search and search.strip():
            pattern = like_pattern(search.strip())
            base = base.where(
                or_(
                    target_name.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    InventoryNfcTag.label.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    compartment_q.c.template_name.ilike(
                        pattern, escape=LIKE_ESCAPE_CHAR
                    ),
                )
            )

        total = (
            await self.db.execute(select(func.count()).select_from(base.subquery()))
        ).scalar_one()
        rows = (
            await self.db.execute(
                base.order_by(
                    target_name.asc(),
                    InventoryNfcTag.linked_at.asc(),
                    InventoryNfcTag.id.asc(),
                )
                .limit(limit)
                .offset(offset)
            )
        ).all()

        names = await self._tags._name_map(org_id, {row[0].linked_by for row in rows})
        items = []
        for tag, name, template_name, last_scanned_at in rows:
            entry = InventoryNfcService._to_dict(tag, names)
            entry["kind"] = tag_kind(entry)
            entry["target_name"] = name or None
            entry["template_name"] = template_name
            entry["last_scanned_at"] = last_scanned_at
            items.append(entry)
        return items, int(total)

    async def move_targets(
        self,
        organization_id: str,
        kind: str,
        search: Optional[str] = None,
        limit: int = MAX_MOVE_TARGETS,
    ) -> List[Dict[str, Any]]:
        """Where a tag of ``kind`` could move to: active items, active storage
        areas, or compartments on this department's checklists, by name.

        The register's own picker rather than the equipment-check template
        list, which ``inventory.manage`` alone cannot read.
        """
        org_id = str(organization_id)
        pattern = like_pattern(search.strip()) if search and search.strip() else None
        if kind == KIND_ITEM:
            query = select(
                InventoryItem.id, InventoryItem.name, InventoryItem.serial_number
            ).where(
                InventoryItem.organization_id == org_id,
                InventoryItem.active.is_(True),
            )
            if pattern:
                query = query.where(
                    or_(
                        InventoryItem.name.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                        InventoryItem.serial_number.ilike(
                            pattern, escape=LIKE_ESCAPE_CHAR
                        ),
                    )
                )
            rows = await self.db.execute(
                query.order_by(InventoryItem.name.asc(), InventoryItem.id.asc()).limit(
                    limit
                )
            )
            return [
                {
                    "id": row.id,
                    "name": row.name,
                    "detail": f"S/N {row.serial_number}" if row.serial_number else None,
                }
                for row in rows
            ]
        if kind == KIND_STORAGE_AREA:
            area_query = select(StorageArea.id, StorageArea.name).where(
                StorageArea.organization_id == org_id,
                StorageArea.is_active.is_(True),
            )
            if pattern:
                area_query = area_query.where(
                    StorageArea.name.ilike(pattern, escape=LIKE_ESCAPE_CHAR)
                )
            rows = await self.db.execute(
                area_query.order_by(StorageArea.name.asc(), StorageArea.id.asc()).limit(
                    limit
                )
            )
            return [{"id": row.id, "name": row.name, "detail": None} for row in rows]
        compartment_query = (
            select(
                CheckTemplateCompartment.id,
                CheckTemplateCompartment.name,
                EquipmentCheckTemplate.name.label("template_name"),
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(EquipmentCheckTemplate.organization_id == org_id)
        )
        if pattern:
            compartment_query = compartment_query.where(
                or_(
                    CheckTemplateCompartment.name.ilike(
                        pattern, escape=LIKE_ESCAPE_CHAR
                    ),
                    EquipmentCheckTemplate.name.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                )
            )
        rows = await self.db.execute(
            compartment_query.order_by(
                EquipmentCheckTemplate.name.asc(),
                CheckTemplateCompartment.sort_order.asc(),
                CheckTemplateCompartment.id.asc(),
            ).limit(limit)
        )
        return [
            {"id": row.id, "name": row.name, "detail": row.template_name}
            for row in rows
        ]

    async def bulk_update_status(
        self,
        organization_id: str,
        tag_ids: Sequence[str],
        status: InventoryNfcTagStatus,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
        """Mark many tags lost or found, tag by tag.

        An id that is not this organization's is reported under ``failed`` and
        skipped; the rest still change.
        """
        updated: List[Dict[str, Any]] = []
        failed: List[Dict[str, str]] = []
        for tag_id in dict.fromkeys(str(t) for t in tag_ids):
            try:
                tag = await self._tags.update_tag(
                    tag_id, str(organization_id), {"status": status}
                )
            except LookupError as e:
                failed.append({"id": tag_id, "detail": str(e)})
                continue
            updated.append(tag)
        return updated, failed

    async def move_tag(
        self,
        tag_id: str,
        organization_id: str,
        *,
        item_id: Optional[str] = None,
        storage_area_id: Optional[str] = None,
        check_compartment_id: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Re-point a tag at another target of the same kind.

        Returns ``(before, after)`` for the audit log. Raises ``LookupError``
        (→ 404) for a tag or target outside the organization and ``ValueError``
        (→ 400) for a move across kinds or onto the target it already names.

        Same kind only, by the owner's decision: an item tag is stuck to a thing
        and a shelf tag to a place, so a tag that changes kind has been peeled
        off and re-stuck, which is an unlink and a fresh link.
        """
        org_id = str(organization_id)
        targets = [t for t in (item_id, storage_area_id, check_compartment_id) if t]
        if len(targets) != 1:
            raise ValueError(
                "A tag moves to exactly one item, storage area or compartment."
            )

        tag = await self._tags._get_tag(tag_id, org_id)
        before = InventoryNfcService._to_dict(tag, {})
        current = tag_kind(before)

        if item_id is not None:
            wanted = KIND_ITEM
        elif storage_area_id is not None:
            wanted = KIND_STORAGE_AREA
        else:
            wanted = KIND_COMPARTMENT
        if wanted != current:
            raise ValueError(
                "A tag can only move to the same kind of target it is on now. "
                "Unlink it and link it again to use it elsewhere."
            )

        if item_id is not None:
            target_id = str((await self._tags._get_item(item_id, org_id)).id)
            column = "item_id"
        elif storage_area_id is not None:
            target_id = str(
                (await self._tags._get_storage_area(storage_area_id, org_id)).id
            )
            column = "storage_area_id"
        else:
            compartment = await self._tags._get_compartment(
                str(check_compartment_id), org_id
            )
            target_id = str(compartment.id)
            column = "check_compartment_id"
        if getattr(tag, column) == target_id:
            raise ValueError("The tag is already on that target.")
        setattr(tag, column, target_id)

        await self.db.flush()
        await self.db.refresh(tag)
        names = await self._tags._name_map(org_id, {tag.linked_by})
        return before, InventoryNfcService._to_dict(tag, names)
