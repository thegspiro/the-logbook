"""
Inventory NFC Tag Service

Links NFC tags to inventory items and storage areas, resolves a tapped tag
back to what it names, moves items onto a shelf by tap (put-away), and keeps
the staff tap log that is each item's "last seen" trail.

The hashing and normalization are the member ID card's (``nfc_tag_service``)
rather than a copy: a tag has to read the same way whichever screen tapped it,
and one definition of "the same tag" is what guarantees that.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import (
    InventoryItem,
    InventoryNfcScan,
    InventoryNfcScanAction,
    InventoryNfcTag,
    InventoryNfcTagStatus,
    StorageArea,
)
from app.models.nfc_tag import NfcCredentialType
from app.models.user import User
from app.services.inventory_service import InventoryService
from app.services.nfc_tag_service import hash_tag_uid, uid_preview
from app.utils.model_updates import apply_updates

_MAX_SCANS_LISTED = 100


class InventoryNfcTagNotFound(Exception):
    """The tag is not linked to anything usable. The message says why."""


@dataclass
class ResolvedTag:
    """What a tap named: exactly one of ``item`` / ``storage_area`` is set."""

    tag: InventoryNfcTag
    item: Optional[InventoryItem] = None
    storage_area: Optional[StorageArea] = None


class InventoryNfcService:
    """Business logic for NFC tags on inventory items and storage areas."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # Management
    # =========================================================================

    async def list_item_tags(
        self, item_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Tags on one item. Raises ``LookupError`` for an item outside the
        organization."""
        await self._get_item(item_id, organization_id)
        return await self._list_tags(
            organization_id, InventoryNfcTag.item_id == str(item_id)
        )

    async def list_storage_area_tags(
        self, storage_area_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Tags on one storage area. Raises ``LookupError`` for an area outside
        the organization."""
        await self._get_storage_area(storage_area_id, organization_id)
        return await self._list_tags(
            organization_id,
            InventoryNfcTag.storage_area_id == str(storage_area_id),
        )

    async def link_tag(
        self,
        *,
        organization_id: str,
        tag_uid: str,
        credential_type: NfcCredentialType,
        label: Optional[str],
        linked_by: Optional[str],
        item_id: Optional[str] = None,
        storage_area_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Attach a tag to an item or to a storage area (exactly one).

        Raises ``LookupError`` (→ 404) for a target outside the organization and
        ``ValueError`` (→ 400) for a tag that is already linked.
        """
        if (item_id is None) == (storage_area_id is None):
            raise ValueError("A tag is linked to exactly one item or storage area.")

        target: Union[InventoryItem, StorageArea]
        if item_id is not None:
            target = await self._get_item(item_id, organization_id)
        else:
            target = await self._get_storage_area(storage_area_id, organization_id)

        uid_hash = hash_tag_uid(tag_uid)
        existing = await self._find_by_hash(organization_id, uid_hash)
        if existing:
            raise ValueError(await self._already_linked_message(existing, target))

        tag = InventoryNfcTag(
            organization_id=str(organization_id),
            item_id=str(target.id) if isinstance(target, InventoryItem) else None,
            storage_area_id=(
                str(target.id) if isinstance(target, StorageArea) else None
            ),
            uid_hash=uid_hash,
            uid_preview=uid_preview(tag_uid),
            credential_type=credential_type,
            label=label,
            status=InventoryNfcTagStatus.ACTIVE,
            linked_by=str(linked_by) if linked_by else None,
        )
        # The check above and this insert are not atomic: two phones linking
        # the same tag at once both pass the check. The unique constraint is
        # what actually decides, and the savepoint keeps the loser's session
        # usable so it gets the same 400 rather than a 500.
        try:
            async with self.db.begin_nested():
                self.db.add(tag)
                await self.db.flush()
        except IntegrityError:
            existing = await self._find_by_hash(organization_id, uid_hash)
            if existing is None:
                raise
            raise ValueError(await self._already_linked_message(existing, target))

        await self.db.refresh(tag)
        names = await self._name_map(organization_id, {tag.linked_by})
        return self._to_dict(tag, names)

    async def update_tag(
        self, tag_id: str, organization_id: str, updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Relabel a tag, or mark it lost / found. Raises ``LookupError``."""
        tag = await self._get_tag(tag_id, organization_id)
        apply_updates(
            tag,
            updates,
            skip={
                "id",
                "organization_id",
                "item_id",
                "storage_area_id",
                "uid_hash",
                "uid_preview",
                "credential_type",
            },
        )
        await self.db.flush()
        await self.db.refresh(tag)
        names = await self._name_map(organization_id, {tag.linked_by})
        return self._to_dict(tag, names)

    async def unlink_tag(self, tag_id: str, organization_id: str) -> Dict[str, Any]:
        """Remove a tag's link and return what it was, for the audit log.

        A delete rather than a status: a tag carries no history worth keeping
        once it names nothing, and deleting frees it to be linked again. The tap
        log keeps its rows; their ``tag_id`` is set null.
        """
        tag = await self._get_tag(tag_id, organization_id)
        snapshot = self._to_dict(tag, {})
        await self.db.delete(tag)
        await self.db.flush()
        return snapshot

    # =========================================================================
    # Resolution
    # =========================================================================

    async def resolve(
        self, organization_id: str, candidates: Sequence[Optional[str]]
    ) -> Tuple[InventoryNfcTag, InventoryItem]:
        """Resolve what was read off a tag to (tag, item).

        For callers that only deal in items — the distribute/return scanner. A
        storage-area tag is refused with a message saying so, rather than
        silently finding nothing.

        Raises ``InventoryNfcTagNotFound`` with a message a quartermaster can
        act on when the tag names no usable item.
        """
        resolved = await self.resolve_any(organization_id, candidates)
        if resolved.item is None:
            raise InventoryNfcTagNotFound("This tag marks a storage area, not an item.")
        return resolved.tag, resolved.item

    async def resolve_any(
        self, organization_id: str, candidates: Sequence[Optional[str]]
    ) -> ResolvedTag:
        """Resolve what was read off a tag to the item or storage area it names.

        ``candidates`` is tried in order, and callers put the written code
        first: a code this app wrote onto a tag is the deliberate link, while
        the chip serial underneath may have been linked to something else
        before the tag was rewritten.
        """
        tag: Optional[InventoryNfcTag] = None
        for candidate in candidates:
            if candidate and candidate.strip():
                tag = await self._find_by_hash(organization_id, hash_tag_uid(candidate))
                if tag:
                    break

        if tag is None:
            raise InventoryNfcTagNotFound("This tag is not linked to anything.")
        if tag.status != InventoryNfcTagStatus.ACTIVE:
            raise InventoryNfcTagNotFound(
                "This tag is marked lost. Mark it found before using it."
            )

        if tag.storage_area_id is not None:
            area = await self._find_storage_area(tag.storage_area_id, organization_id)
            if area is None or not area.is_active:
                raise InventoryNfcTagNotFound(
                    "This tag is on a storage area that is no longer active."
                )
            return ResolvedTag(tag=tag, storage_area=area)

        result = await self.db.execute(
            select(InventoryItem)
            .where(
                InventoryItem.id == tag.item_id,
                InventoryItem.organization_id == str(organization_id),
            )
            .options(selectinload(InventoryItem.category))
        )
        item = result.scalar_one_or_none()
        # Matches the barcode lookup, which only finds active items: a tag on a
        # retired helmet should not quietly put it back into circulation.
        if item is None or not item.active:
            raise InventoryNfcTagNotFound(
                "This tag is linked to an item that is no longer active."
            )
        return ResolvedTag(tag=tag, item=item)

    # =========================================================================
    # Put-away and the tap log
    # =========================================================================

    async def put_away(
        self,
        *,
        organization_id: str,
        item_id: str,
        storage_area_id: str,
        scanned_by: Optional[str],
        item_tag_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Move one tapped item onto a storage area and log the tap.

        The move itself is ``InventoryService.put_away_items`` — the barcode
        put-away's own rule for which items may be shelved and which room they
        then list under. NFC is a second way of *reading* the shelf and the
        item, not a second rule for moving one (Pitfall #29), so the two paths
        cannot disagree about what a shelf tap is allowed to do.

        Raises ``LookupError`` (→ 404) for an item or area outside the
        organization, ``ValueError`` (→ 400) for an item the shared rule skips.
        """
        item = await self._get_item(item_id, organization_id)
        from_area_id = item.storage_area_id

        result = await InventoryService(self.db).put_away_items(
            area_id=storage_area_id,
            item_ids=[item.id],
            organization_id=organization_id,
        )
        if result is None:
            raise LookupError("Storage area not found")
        if result["skipped"]:
            skip = result["skipped"][0]
            raise ValueError(f'"{skip["name"]}" is {skip["reason"]}.')
        moved = item.id in result["moved"]

        await self.record_scan(
            organization_id=organization_id,
            item_id=str(item.id),
            action=InventoryNfcScanAction.PUT_AWAY,
            scanned_by=scanned_by,
            tag_id=await self._tag_on_item(item_tag_id, str(item.id), organization_id),
            storage_area_id=str(storage_area_id),
            from_storage_area_id=from_area_id,
        )

        areas = await self._area_name_map(
            organization_id, {storage_area_id, from_area_id}
        )
        return {
            "item_id": str(item.id),
            "item_name": item.name,
            "storage_area_id": str(storage_area_id),
            "storage_area_name": areas.get(str(storage_area_id), ""),
            "from_storage_area_id": from_area_id,
            "from_storage_area_name": areas.get(from_area_id) if from_area_id else None,
            "moved": moved,
        }

    async def record_scan(
        self,
        *,
        organization_id: str,
        item_id: str,
        action: InventoryNfcScanAction,
        scanned_by: Optional[str],
        tag_id: Optional[str] = None,
        storage_area_id: Optional[str] = None,
        from_storage_area_id: Optional[str] = None,
    ) -> None:
        """Append one row to the tap log.

        Callers decide whether a tap is logged at all — only staff taps are —
        so this never checks the caller's permissions itself.
        """
        self.db.add(
            InventoryNfcScan(
                organization_id=str(organization_id),
                item_id=str(item_id),
                tag_id=tag_id,
                action=action,
                storage_area_id=storage_area_id,
                from_storage_area_id=from_storage_area_id,
                scanned_by=str(scanned_by) if scanned_by else None,
            )
        )
        await self.db.flush()

    async def list_item_scans(
        self, item_id: str, organization_id: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """An item's tap log, newest first. Raises ``LookupError``."""
        await self._get_item(item_id, organization_id)
        result = await self.db.execute(
            select(InventoryNfcScan, InventoryNfcTag.uid_preview)
            .outerjoin(
                InventoryNfcTag,
                (InventoryNfcTag.id == InventoryNfcScan.tag_id)
                & (InventoryNfcTag.organization_id == str(organization_id)),
            )
            .where(
                InventoryNfcScan.organization_id == str(organization_id),
                InventoryNfcScan.item_id == str(item_id),
            )
            .order_by(InventoryNfcScan.scanned_at.desc(), InventoryNfcScan.id.desc())
            .limit(max(1, min(limit, _MAX_SCANS_LISTED)))
        )
        rows = list(result.all())
        scans = [row[0] for row in rows]
        names = await self._name_map(organization_id, {s.scanned_by for s in scans})
        areas = await self._area_name_map(
            organization_id,
            {s.storage_area_id for s in scans}
            | {s.from_storage_area_id for s in scans},
        )
        return [
            {
                "id": scan.id,
                "item_id": scan.item_id,
                "action": scan.action,
                "tag_uid_preview": preview,
                "storage_area_id": scan.storage_area_id,
                "storage_area_name": areas.get(scan.storage_area_id),
                "from_storage_area_id": scan.from_storage_area_id,
                "from_storage_area_name": areas.get(scan.from_storage_area_id),
                "scanned_by": scan.scanned_by,
                "scanned_by_name": names.get(scan.scanned_by),
                "scanned_at": scan.scanned_at,
            }
            for scan, preview in rows
        ]

    # =========================================================================
    # Helpers
    # =========================================================================

    async def _list_tags(self, organization_id: str, target_clause) -> List[Dict]:
        result = await self.db.execute(
            select(InventoryNfcTag)
            .where(InventoryNfcTag.organization_id == str(organization_id))
            .where(target_clause)
            # linked_at has one-second resolution, so two tags linked in
            # quick succession tie; the id keeps the order stable between
            # refreshes rather than meaningful.
            .order_by(InventoryNfcTag.linked_at.asc(), InventoryNfcTag.id.asc())
        )
        tags = list(result.scalars().all())
        names = await self._name_map(organization_id, {t.linked_by for t in tags})
        return [self._to_dict(tag, names) for tag in tags]

    async def _get_item(self, item_id: str, organization_id: str) -> InventoryItem:
        result = await self.db.execute(
            select(InventoryItem).where(
                InventoryItem.id == str(item_id),
                InventoryItem.organization_id == str(organization_id),
            )
        )
        item = result.scalar_one_or_none()
        if item is None:
            raise LookupError("Item not found")
        return item

    async def _find_storage_area(
        self, storage_area_id: str, organization_id: str
    ) -> Optional[StorageArea]:
        result = await self.db.execute(
            select(StorageArea).where(
                StorageArea.id == str(storage_area_id),
                StorageArea.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def _get_storage_area(
        self, storage_area_id: str, organization_id: str
    ) -> StorageArea:
        area = await self._find_storage_area(storage_area_id, organization_id)
        if area is None:
            raise LookupError("Storage area not found")
        return area

    async def _get_tag(self, tag_id: str, organization_id: str) -> InventoryNfcTag:
        result = await self.db.execute(
            select(InventoryNfcTag).where(
                InventoryNfcTag.id == str(tag_id),
                InventoryNfcTag.organization_id == str(organization_id),
            )
        )
        tag = result.scalar_one_or_none()
        if tag is None:
            raise LookupError("NFC tag not found")
        return tag

    async def _tag_on_item(
        self, tag_id: Optional[str], item_id: str, organization_id: str
    ) -> Optional[str]:
        """The client's claim of which tag was tapped, kept only if that tag
        really is on this item in this organization (Pitfall #14c) — a log
        naming another department's tag would be a dangling reference."""
        if not tag_id:
            return None
        result = await self.db.execute(
            select(InventoryNfcTag.id).where(
                InventoryNfcTag.id == str(tag_id),
                InventoryNfcTag.item_id == str(item_id),
                InventoryNfcTag.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def _find_by_hash(
        self, organization_id: str, uid_hash: str
    ) -> Optional[InventoryNfcTag]:
        result = await self.db.execute(
            select(InventoryNfcTag).where(
                InventoryNfcTag.organization_id == str(organization_id),
                InventoryNfcTag.uid_hash == uid_hash,
            )
        )
        return result.scalar_one_or_none()

    async def _already_linked_message(
        self,
        existing: InventoryNfcTag,
        target: Union[InventoryItem, StorageArea],
    ) -> str:
        if existing.item_id == target.id or existing.storage_area_id == target.id:
            noun = "item" if isinstance(target, InventoryItem) else "storage area"
            return f"This tag is already linked to this {noun}."
        # Naming the other item or area is safe here, unlike for a member ID
        # card: the caller manages inventory and can already see all of it, and
        # "where is this tag linked" is exactly what they need to fix it.
        if existing.item_id is not None:
            result = await self.db.execute(
                select(InventoryItem.name).where(
                    InventoryItem.id == existing.item_id,
                    InventoryItem.organization_id == existing.organization_id,
                )
            )
            other = result.scalar_one_or_none() or "another item"
        else:
            result = await self.db.execute(
                select(StorageArea.name).where(
                    StorageArea.id == existing.storage_area_id,
                    StorageArea.organization_id == existing.organization_id,
                )
            )
            other = result.scalar_one_or_none() or "another storage area"
        return (
            f'This tag is already linked to "{other}". '
            "Unlink it there before linking it here."
        )

    async def _name_map(self, organization_id: str, user_ids: set) -> Dict[str, str]:
        """Display names for ids read off org-scoped rows; the org filter is
        defense in depth (Pitfall #14a)."""
        ids = {str(u) for u in user_ids if u}
        if not ids:
            return {}
        result = await self.db.execute(
            select(User.id, User.first_name, User.last_name).where(
                User.id.in_(ids),
                User.organization_id == str(organization_id),
            )
        )
        return {
            row.id: f"{row.first_name or ''} {row.last_name or ''}".strip()
            for row in result
        }

    async def _area_name_map(
        self, organization_id: str, area_ids: set
    ) -> Dict[str, str]:
        ids = {str(a) for a in area_ids if a}
        if not ids:
            return {}
        result = await self.db.execute(
            select(StorageArea.id, StorageArea.name).where(
                StorageArea.id.in_(ids),
                StorageArea.organization_id == str(organization_id),
            )
        )
        return {row.id: row.name for row in result}

    @staticmethod
    def _to_dict(tag: InventoryNfcTag, names: Dict[str, str]) -> Dict[str, Any]:
        return {
            "id": tag.id,
            "item_id": tag.item_id,
            "storage_area_id": tag.storage_area_id,
            "uid_preview": tag.uid_preview,
            "credential_type": tag.credential_type,
            "label": tag.label,
            "status": tag.status,
            "linked_by": tag.linked_by,
            "linked_by_name": names.get(tag.linked_by) if tag.linked_by else None,
            "linked_at": tag.linked_at,
        }
