"""
Inventory NFC Tag Service

Links NFC tags to inventory items and resolves a tapped tag back to its item.

The hashing and normalization are the member ID card's (``nfc_tag_service``)
rather than a copy: a tag has to read the same way whichever screen tapped it,
and one definition of "the same tag" is what guarantees that.
"""

from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import (
    InventoryItem,
    InventoryNfcTag,
    InventoryNfcTagStatus,
)
from app.models.nfc_tag import NfcCredentialType
from app.models.user import User
from app.services.nfc_tag_service import hash_tag_uid, uid_preview
from app.utils.model_updates import apply_updates


class InventoryNfcTagNotFound(Exception):
    """The tag is not linked to anything usable. The message says why."""


class InventoryNfcService:
    """Business logic for NFC tags on inventory items."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # Management
    # =========================================================================

    async def list_item_tags(
        self, item_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Tags on one item, oldest first. Raises ``LookupError`` for an item
        outside the organization."""
        await self._get_item(item_id, organization_id)
        result = await self.db.execute(
            select(InventoryNfcTag).where(
                InventoryNfcTag.organization_id == str(organization_id),
                InventoryNfcTag.item_id == str(item_id),
            )
            # linked_at has one-second resolution, so two tags linked in
            # quick succession tie; the id keeps the order stable between
            # refreshes rather than meaningful.
            .order_by(InventoryNfcTag.linked_at.asc(), InventoryNfcTag.id.asc())
        )
        tags = list(result.scalars().all())
        names = await self._name_map(organization_id, {t.linked_by for t in tags})
        return [self._to_dict(tag, names) for tag in tags]

    async def link_tag(
        self,
        *,
        organization_id: str,
        item_id: str,
        tag_uid: str,
        credential_type: NfcCredentialType,
        label: Optional[str],
        linked_by: Optional[str],
    ) -> Dict[str, Any]:
        """Attach a tag to an item.

        Raises ``LookupError`` (→ 404) for an item outside the organization and
        ``ValueError`` (→ 400) for a tag that is already linked.
        """
        item = await self._get_item(item_id, organization_id)
        uid_hash = hash_tag_uid(tag_uid)

        existing = await self._find_by_hash(organization_id, uid_hash)
        if existing:
            raise ValueError(await self._already_linked_message(existing, item))

        tag = InventoryNfcTag(
            organization_id=str(organization_id),
            item_id=str(item.id),
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
            raise ValueError(await self._already_linked_message(existing, item))

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
        once it names nothing, and deleting frees it to be linked again.
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

        ``candidates`` is tried in order, and callers put the written code
        first: a code this app wrote onto a tag is the deliberate link, while
        the chip serial underneath may have been linked to something else
        before the tag was rewritten.

        Raises ``InventoryNfcTagNotFound`` with a message a quartermaster can
        act on when the tag names nothing usable.
        """
        tag: Optional[InventoryNfcTag] = None
        for candidate in candidates:
            if candidate and candidate.strip():
                tag = await self._find_by_hash(organization_id, hash_tag_uid(candidate))
                if tag:
                    break

        if tag is None:
            raise InventoryNfcTagNotFound("This tag is not linked to any item.")
        if tag.status != InventoryNfcTagStatus.ACTIVE:
            raise InventoryNfcTagNotFound(
                "This tag is marked lost. Mark it found on its item before using it."
            )

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
        return tag, item

    # =========================================================================
    # Helpers
    # =========================================================================

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
        self, existing: InventoryNfcTag, target: InventoryItem
    ) -> str:
        if existing.item_id == target.id:
            return "This tag is already linked to this item."
        # Naming the other item is safe here, unlike for a member ID card: the
        # caller manages inventory and can already see every item, and "which
        # item is this tag on" is exactly what they need to fix it.
        result = await self.db.execute(
            select(InventoryItem.name).where(
                InventoryItem.id == existing.item_id,
                InventoryItem.organization_id == existing.organization_id,
            )
        )
        other_name = result.scalar_one_or_none() or "another item"
        return (
            f'This tag is already linked to "{other_name}". '
            "Unlink it there before linking it here."
        )

    async def _name_map(self, organization_id: str, user_ids: set) -> Dict[str, str]:
        """Display names for ids read off org-scoped tag rows; the org filter
        is defense in depth (Pitfall #14a)."""
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

    @staticmethod
    def _to_dict(tag: InventoryNfcTag, names: Dict[str, str]) -> Dict[str, Any]:
        return {
            "id": tag.id,
            "item_id": tag.item_id,
            "uid_preview": tag.uid_preview,
            "credential_type": tag.credential_type,
            "label": tag.label,
            "status": tag.status,
            "linked_by": tag.linked_by,
            "linked_by_name": names.get(tag.linked_by) if tag.linked_by else None,
            "linked_at": tag.linked_at,
        }
