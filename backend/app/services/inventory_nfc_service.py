"""
Inventory NFC Tag Service

Links NFC tags to inventory items, storage areas and equipment-check
compartments, resolves a tapped tag back to what it names, moves items onto a
shelf by tap (put-away), and keeps the staff tap log that is each item's "last
seen" trail.

A compartment tag is only meaningful during an equipment check of the template
it belongs to (``resolve_check``): it names a place on a truck, not a thing
anybody can pick up, so the item-only and item-or-shelf resolvers refuse it.
Compartments are template-scoped and carry no ``organization_id`` of their
own, so every compartment read here goes through its template's organization.

The hashing and normalization are the member ID card's (``nfc_tag_service``)
rather than a copy: a tag has to read the same way whichever screen tapped it,
and one definition of "the same tag" is what guarantees that.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.inventory import (
    InventoryItem,
    InventoryNfcAudit,
    InventoryNfcAuditItem,
    InventoryNfcAuditResult,
    InventoryNfcScan,
    InventoryNfcScanAction,
    InventoryNfcTag,
    InventoryNfcTagStatus,
    ItemStatus,
    StorageArea,
)
from app.models.nfc_tag import NfcCredentialType
from app.models.user import User
from app.services.inventory_service import InventoryService
from app.services.nfc_tag_service import hash_tag_uid, uid_preview
from app.utils.model_updates import apply_updates
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

_MAX_SCANS_LISTED = 100
_MAX_AUDITS_LISTED = 100
_MAX_UNTAGGED_LISTED = 200

# Statuses that mean an item is, by the record, not on its shelf: somebody has
# it, or nobody knows where it is. An audit does not expect to find these, so
# they are never reported missing — and tapping one on a shelf is reported as
# unexpected, which is exactly the discrepancy worth seeing.
_NOT_ON_SHELF = frozenset(
    {
        ItemStatus.ASSIGNED,
        ItemStatus.CHECKED_OUT,
        ItemStatus.LOST,
        ItemStatus.STOLEN,
        ItemStatus.RETIRED,
    }
)


_Target = Union[InventoryItem, StorageArea, CheckTemplateCompartment]


class InventoryNfcTagNotFound(Exception):
    """The tag is not linked to anything usable. The message says why."""


@dataclass
class ResolvedCheckTap:
    """What a tap during an equipment check named.

    ``kind`` is ``compartment`` (jump to it) or ``item`` (mark the checklist
    entries linked to this inventory item present).
    """

    tag: InventoryNfcTag
    kind: str
    compartment: Optional[CheckTemplateCompartment] = None
    item: Optional[InventoryItem] = None
    template_item_ids: List[str] = field(default_factory=list)


@dataclass
class ResolvedTag:
    """What a tap named: exactly one of ``item`` / ``storage_area`` is set."""

    tag: InventoryNfcTag
    item: Optional[InventoryItem] = None
    storage_area: Optional[StorageArea] = None


class InventoryNfcService:
    """Business logic for NFC tags on inventory items, storage areas and
    equipment-check compartments."""

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

    async def list_compartment_tags(
        self, compartment_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Tags on one equipment-check compartment. Raises ``LookupError`` for
        a compartment outside the organization."""
        await self._get_compartment(compartment_id, organization_id)
        return await self._list_tags(
            organization_id,
            InventoryNfcTag.check_compartment_id == str(compartment_id),
        )

    async def get_tag(self, tag_id: str, organization_id: str) -> Dict[str, Any]:
        """One tag, as the management screens show it. Raises ``LookupError``.

        The endpoints read this before a relabel or unlink to decide which
        permission the tag's target calls for.
        """
        tag = await self._get_tag(tag_id, organization_id)
        return self._to_dict(tag, {})

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
        check_compartment_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Attach a tag to an item, a storage area or an equipment-check
        compartment (exactly one).

        Raises ``LookupError`` (→ 404) for a target outside the organization and
        ``ValueError`` (→ 400) for a tag that is already linked.
        """
        targets = [t for t in (item_id, storage_area_id, check_compartment_id) if t]
        if len(targets) != 1:
            raise ValueError(
                "A tag is linked to exactly one item, storage area or compartment."
            )

        target: _Target
        if item_id is not None:
            target = await self._get_item(item_id, organization_id)
        elif storage_area_id is not None:
            target = await self._get_storage_area(storage_area_id, organization_id)
        else:
            target = await self._get_compartment(
                str(check_compartment_id), organization_id
            )

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
            check_compartment_id=(
                str(target.id) if isinstance(target, CheckTemplateCompartment) else None
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
                "check_compartment_id",
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

        ``candidates`` is tried in order (see ``_find_active_tag``).
        """
        tag = await self._find_active_tag(organization_id, candidates)

        if tag.check_compartment_id is not None:
            raise InventoryNfcTagNotFound(
                "This tag marks an apparatus compartment. "
                "Tap it during an equipment check."
            )

        if tag.storage_area_id is not None:
            area = await self._find_storage_area(tag.storage_area_id, organization_id)
            if area is None or not area.is_active:
                raise InventoryNfcTagNotFound(
                    "This tag is on a storage area that is no longer active."
                )
            return ResolvedTag(tag=tag, storage_area=area)

        item = await self._active_item_for_tag(tag, organization_id)
        return ResolvedTag(tag=tag, item=item)

    async def resolve_check(
        self,
        organization_id: str,
        template_id: str,
        candidates: Sequence[Optional[str]],
    ) -> ResolvedCheckTap:
        """Resolve a tap made during an equipment check of ``template_id``.

        A compartment tag must be on one of this template's compartments; an
        item tag must name an inventory item that at least one of this
        template's checklist entries is linked to. Anything else is refused
        with a message the crew member can act on. The caller has already
        confirmed the template is one this user may check.
        """
        tag = await self._find_active_tag(organization_id, candidates)

        if tag.storage_area_id is not None:
            raise InventoryNfcTagNotFound(
                "This tag marks a storage shelf, not part of this checklist."
            )

        if tag.check_compartment_id is not None:
            compartment = await self._find_compartment(
                tag.check_compartment_id, organization_id
            )
            if compartment is None or compartment.template_id != str(template_id):
                raise InventoryNfcTagNotFound(
                    "This tag is on a compartment of another checklist."
                )
            return ResolvedCheckTap(
                tag=tag, kind="compartment", compartment=compartment
            )

        item = await self._active_item_for_tag(tag, organization_id)
        result = await self.db.execute(
            select(CheckTemplateItem.id)
            .join(
                CheckTemplateCompartment,
                CheckTemplateCompartment.id == CheckTemplateItem.compartment_id,
            )
            .where(
                CheckTemplateCompartment.template_id == str(template_id),
                CheckTemplateItem.inventory_item_id == item.id,
            )
            .order_by(
                CheckTemplateCompartment.sort_order.asc(),
                CheckTemplateItem.sort_order.asc(),
                CheckTemplateItem.id.asc(),
            )
        )
        template_item_ids = [str(i) for i in result.scalars().all()]
        if not template_item_ids:
            raise InventoryNfcTagNotFound(f"{item.name} is not on this checklist.")
        return ResolvedCheckTap(
            tag=tag, kind="item", item=item, template_item_ids=template_item_ids
        )

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
    # Shelf audits
    # =========================================================================

    async def create_audit(
        self,
        *,
        organization_id: str,
        storage_area_id: str,
        tapped: Iterable[Tuple[str, Optional[str]]],
        audited_by: Optional[str],
        client_submission_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Compare the items tapped on a shelf with the items recorded there.

        ``tapped`` is ``(item_id, tag_id)`` pairs, the tag being the one that
        was read (optional, kept in the tap log only if it is on that item).

        The audit only *reports*. Nothing moves until a quartermaster confirms
        it through :meth:`apply_audit`, and a missing item is never marked lost:
        "not tapped this afternoon" is not evidence that it is gone.

        Expected items are the active items recorded on exactly this storage
        area — not its children, which get audits of their own — minus those
        whose status already says they are elsewhere.

        Raises ``LookupError`` for an area outside the organization and
        ``ValueError`` for an inactive one.
        """
        org_id = str(organization_id)
        area = await self._get_storage_area(storage_area_id, org_id)
        if not area.is_active:
            raise ValueError("This storage area is no longer active.")

        # Last pair wins for a repeated item; the order is otherwise irrelevant.
        tag_for: Dict[str, Optional[str]] = {}
        for item_id, tag_id in tapped:
            tag_for[str(item_id)] = str(tag_id) if tag_id else None

        tapped_items: Dict[str, InventoryItem] = {}
        if tag_for:
            result = await self.db.execute(
                select(InventoryItem).where(
                    InventoryItem.id.in_(list(tag_for)),
                    InventoryItem.organization_id == org_id,
                )
            )
            # Ids from another organization, or deleted since the tap, are
            # dropped (Pitfall #14c) rather than failing a whole shelf's work.
            tapped_items = {i.id: i for i in result.scalars().all()}

        result = await self.db.execute(
            select(InventoryItem).where(
                InventoryItem.organization_id == org_id,
                InventoryItem.storage_area_id == area.id,
                InventoryItem.active.is_(True),
                InventoryItem.status.notin_(list(_NOT_ON_SHELF)),
            )
        )
        expected = {i.id: i for i in result.scalars().all()}

        recorded_area_ids = {
            i.storage_area_id
            for i in tapped_items.values()
            if i.id not in expected and i.storage_area_id
        }
        area_names = await self._area_name_map(org_id, recorded_area_ids)

        audit = InventoryNfcAudit(
            organization_id=org_id,
            storage_area_id=area.id,
            storage_area_name=area.name,
            audited_by=str(audited_by) if audited_by else None,
            client_submission_id=client_submission_id,
        )
        lines: List[InventoryNfcAuditItem] = []
        for item in expected.values():
            lines.append(
                InventoryNfcAuditItem(
                    organization_id=org_id,
                    item_id=item.id,
                    item_name=item.name,
                    result=(
                        InventoryNfcAuditResult.FOUND
                        if item.id in tapped_items
                        else InventoryNfcAuditResult.MISSING
                    ),
                    recorded_storage_area_id=area.id,
                    recorded_storage_area_name=area.name,
                )
            )
        for item in tapped_items.values():
            if item.id in expected:
                continue
            lines.append(
                InventoryNfcAuditItem(
                    organization_id=org_id,
                    item_id=item.id,
                    item_name=item.name,
                    result=InventoryNfcAuditResult.UNEXPECTED,
                    recorded_storage_area_id=item.storage_area_id,
                    recorded_storage_area_name=area_names.get(item.storage_area_id),
                )
            )
        audit.items = lines
        audit.expected_count = len(expected)
        audit.found_count = sum(
            1 for ln in lines if ln.result == InventoryNfcAuditResult.FOUND
        )
        audit.missing_count = sum(
            1 for ln in lines if ln.result == InventoryNfcAuditResult.MISSING
        )
        audit.unexpected_count = sum(
            1 for ln in lines if ln.result == InventoryNfcAuditResult.UNEXPECTED
        )
        self.db.add(audit)

        # Every tapped item was seen on this shelf, whatever the record said.
        for item in tapped_items.values():
            self.db.add(
                InventoryNfcScan(
                    organization_id=org_id,
                    item_id=item.id,
                    tag_id=await self._tag_on_item(
                        tag_for.get(item.id), item.id, org_id
                    ),
                    action=InventoryNfcScanAction.AUDIT,
                    storage_area_id=area.id,
                    scanned_by=str(audited_by) if audited_by else None,
                )
            )
        await self.db.flush()
        return await self.get_audit(audit.id, org_id)

    # =========================================================================
    # Taps made offline
    # =========================================================================

    async def replay_put_away(
        self,
        *,
        organization_id: str,
        scanned_by: Optional[str],
        taps: Sequence[Dict[str, Optional[str]]],
        open_storage_area_id: Optional[str] = None,
        held_item_id: Optional[str] = None,
        held_item_tag_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Apply put-away taps made without signal, in the order they were made.

        The rules are the put-away screen's, step for step: a shelf tapped with
        nothing held opens it and every item after goes onto it; an item tapped
        with no shelf open is held until the next shelf, which it moves to
        without opening. ``open_storage_area_id`` and ``held_item_id`` are what
        the screen showed when signal went, so the first taps continue from
        there. Each move is :meth:`put_away`, so an offline move is refused for
        exactly the reasons an online one is.

        Every step reports what it turned out to be; nothing here raises for
        one bad tap, because the rest of a shelf's work still stands.
        ``taps`` items have ``code`` / ``serial_number`` or ``storage_area_id``.
        """
        org_id = str(organization_id)
        shelf: Optional[StorageArea] = None
        if open_storage_area_id:
            area = await self._find_storage_area(open_storage_area_id, org_id)
            if area is not None and area.is_active:
                shelf = area

        held: Optional[Tuple[InventoryItem, Optional[str]]] = None
        if held_item_id:
            try:
                item = await self._get_item(held_item_id, org_id)
            except LookupError:
                item = None
            if item is not None and item.active:
                held = (item, held_item_tag_id)

        results: List[Dict[str, Any]] = []
        for index, tap in enumerate(taps):
            area: Optional[StorageArea] = None
            tapped: Optional[Tuple[InventoryItem, Optional[str]]] = None
            if tap.get("storage_area_id"):
                area = await self._find_storage_area(tap["storage_area_id"], org_id)
                if area is None or not area.is_active:
                    results.append(
                        {
                            "index": index,
                            "outcome": "refused",
                            "message": "That storage area is no longer active.",
                        }
                    )
                    continue
            else:
                try:
                    resolved = await self.resolve_any(
                        org_id, (tap.get("code"), tap.get("serial_number"))
                    )
                except InventoryNfcTagNotFound as e:
                    results.append(
                        {"index": index, "outcome": "unread", "message": str(e)}
                    )
                    continue
                if resolved.storage_area is not None:
                    area = resolved.storage_area
                elif resolved.item is not None:
                    tapped = (resolved.item, str(resolved.tag.id))

            if area is not None:
                if held is not None:
                    # Item first: a one-off move, and the shelf stays closed.
                    results.append(
                        await self._replay_move(
                            index, org_id, scanned_by, held[0], held[1], area
                        )
                    )
                    held = None
                else:
                    shelf = area
                    results.append(
                        {
                            "index": index,
                            "outcome": "shelf_opened",
                            "storage_area_name": area.name,
                        }
                    )
                continue
            if tapped is not None:
                if shelf is not None:
                    results.append(
                        await self._replay_move(
                            index, org_id, scanned_by, tapped[0], tapped[1], shelf
                        )
                    )
                else:
                    held = tapped
                    results.append(
                        {"index": index, "outcome": "held", "item_name": tapped[0].name}
                    )

        return {
            "results": results,
            "moved_count": sum(1 for r in results if r["outcome"] == "moved"),
            "refused_count": sum(1 for r in results if r["outcome"] == "refused"),
            "unread_count": sum(1 for r in results if r["outcome"] == "unread"),
            "held_item_name": held[0].name if held is not None else None,
        }

    async def _replay_move(
        self,
        index: int,
        organization_id: str,
        scanned_by: Optional[str],
        item: InventoryItem,
        tag_id: Optional[str],
        area: StorageArea,
    ) -> Dict[str, Any]:
        # Read before put_away: its flush must not be what makes these readable.
        item_name, area_name = item.name, area.name
        try:
            moved = await self.put_away(
                organization_id=organization_id,
                item_id=str(item.id),
                storage_area_id=str(area.id),
                scanned_by=scanned_by,
                item_tag_id=tag_id,
            )
        except (LookupError, ValueError) as e:
            return {
                "index": index,
                "outcome": "refused",
                "item_name": item_name,
                "storage_area_name": area_name,
                "message": str(e),
            }
        return {
            "index": index,
            "outcome": "moved" if moved["moved"] else "already_there",
            "item_id": moved["item_id"],
            "item_name": item_name,
            "storage_area_id": moved["storage_area_id"],
            "storage_area_name": area_name,
            "from_storage_area_id": moved["from_storage_area_id"],
        }

    async def replay_audit(
        self,
        *,
        organization_id: str,
        audited_by: Optional[str],
        client_submission_id: str,
        storage_area_id: Optional[str],
        tapped: Sequence[Tuple[str, Optional[str]]],
        taps: Sequence[Dict[str, Optional[str]]],
    ) -> Dict[str, Any]:
        """Save a shelf audit finished without signal.

        The shelf is ``storage_area_id`` when it was chosen with signal, or
        else the first shelf found among ``taps``; another shelf's tag after
        that is counted and ignored, as the audit screen refuses it. Items are
        ``tapped`` (identified before signal went) plus every item among
        ``taps``, whatever order they came in: offline, the screen cannot tell
        a crew member to tap the shelf first.

        The same ``client_submission_id`` sent twice — a retry after a lost
        response — returns the audit the first send saved.

        Returns ``audit`` None with ``not_saved_reason`` when there is nothing
        to save, rather than raising: the phone's queue retries a refused
        request, and no retry would make these taps name a shelf.
        """
        org_id = str(organization_id)
        already = await self._audit_already_sent(org_id, client_submission_id)
        if already is not None:
            return already

        shelf: Optional[StorageArea] = None
        if storage_area_id:
            shelf = await self._find_storage_area(storage_area_id, org_id)
            if shelf is None or not shelf.is_active:
                return self._audit_not_saved(
                    "The shelf being audited is no longer active."
                )

        items: List[Tuple[str, Optional[str]]] = list(tapped)
        unread = other_shelf = 0
        for tap in taps:
            area: Optional[StorageArea] = None
            if tap.get("storage_area_id"):
                area = await self._find_storage_area(tap["storage_area_id"], org_id)
                if area is None or not area.is_active:
                    unread += 1
                    continue
            else:
                try:
                    resolved = await self.resolve_any(
                        org_id, (tap.get("code"), tap.get("serial_number"))
                    )
                except InventoryNfcTagNotFound:
                    unread += 1
                    continue
                if resolved.item is not None:
                    items.append((str(resolved.item.id), str(resolved.tag.id)))
                    continue
                area = resolved.storage_area
            if area is None:
                continue
            if shelf is None:
                shelf = area
            elif area.id != shelf.id:
                other_shelf += 1

        if shelf is None:
            return self._audit_not_saved(
                "No shelf was chosen or tapped, so there was nothing to audit."
            )
        # The check above and this insert are not atomic: a retry arriving
        # while the first send is still being handled passes it too. The
        # unique constraint decides, and the savepoint keeps the loser's
        # session usable so it answers with the winner's audit, not a 500.
        try:
            async with self.db.begin_nested():
                audit = await self.create_audit(
                    organization_id=org_id,
                    storage_area_id=str(shelf.id),
                    tapped=items,
                    audited_by=audited_by,
                    client_submission_id=client_submission_id,
                )
        except IntegrityError:
            already = await self._audit_already_sent(org_id, client_submission_id)
            if already is None:
                raise
            return already
        return {
            "audit": audit,
            "created": True,
            "not_saved_reason": None,
            "unread_count": unread,
            "other_shelf_count": other_shelf,
        }

    async def _audit_already_sent(
        self, organization_id: str, client_submission_id: str
    ) -> Optional[Dict[str, Any]]:
        existing = (
            await self.db.execute(
                select(InventoryNfcAudit.id).where(
                    InventoryNfcAudit.organization_id == organization_id,
                    InventoryNfcAudit.client_submission_id == client_submission_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            return None
        return {
            "audit": await self.get_audit(existing, organization_id),
            "created": False,
            "not_saved_reason": None,
            "unread_count": 0,
            "other_shelf_count": 0,
        }

    @staticmethod
    def _audit_not_saved(reason: str) -> Dict[str, Any]:
        return {
            "audit": None,
            "created": False,
            "not_saved_reason": reason,
            "unread_count": 0,
            "other_shelf_count": 0,
        }

    async def apply_audit(
        self,
        *,
        audit_id: str,
        organization_id: str,
        item_ids: Sequence[str],
        applied_by: Optional[str],
    ) -> Dict[str, Any]:
        """Move the chosen unexpected items onto the audited shelf.

        The move is ``InventoryService.put_away_items``, the same rule the
        barcode and tap put-aways use (Pitfall #29): an item assigned to a
        member or checked out is skipped with the reason rather than silently
        pulled back onto a shelf.

        Returns the refreshed audit plus ``skipped`` (``item_id``, ``name``,
        ``reason``). Raises ``LookupError`` for an audit outside the
        organization and ``ValueError`` for an id that is not an unmoved,
        unexpected line of this audit, or when the shelf no longer exists.
        """
        org_id = str(organization_id)
        audit = await self._get_audit(audit_id, org_id)
        if audit.storage_area_id is None:
            raise ValueError("The audited storage area no longer exists.")

        requested = list(dict.fromkeys(str(i) for i in item_ids))
        if not requested:
            raise ValueError("Choose at least one item to move.")
        movable = {
            ln.item_id: ln
            for ln in audit.items
            if ln.result == InventoryNfcAuditResult.UNEXPECTED
            and ln.item_id is not None
            and not ln.moved
        }
        invalid = [i for i in requested if i not in movable]
        if invalid:
            raise ValueError(
                "Only items this audit found unexpectedly, and has not already "
                "moved, can be moved onto the shelf."
            )

        area_id = audit.storage_area_id
        result = await InventoryService(self.db).put_away_items(
            area_id=area_id, item_ids=requested, organization_id=org_id
        )
        if result is None:
            raise ValueError("The audited storage area no longer exists.")

        placed = set(result["moved"]) | set(result["already_here"])
        for item_id in placed:
            movable[item_id].moved = True
        if placed:
            audit.applied_by = str(applied_by) if applied_by else None
            audit.applied_at = datetime.now(timezone.utc)
        await self.db.flush()

        detail = await self.get_audit(audit.id, org_id)
        detail["moved_item_ids"] = list(result["moved"])
        detail["skipped"] = list(result["skipped"])
        return detail

    async def list_audits(
        self,
        organization_id: str,
        *,
        storage_area_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Audits newest first, optionally for one storage area."""
        org_id = str(organization_id)
        query = select(InventoryNfcAudit).where(
            InventoryNfcAudit.organization_id == org_id
        )
        if storage_area_id:
            query = query.where(
                InventoryNfcAudit.storage_area_id == str(storage_area_id)
            )
        result = await self.db.execute(
            query.order_by(
                InventoryNfcAudit.audited_at.desc(), InventoryNfcAudit.id.desc()
            ).limit(max(1, min(limit, _MAX_AUDITS_LISTED)))
        )
        audits = list(result.scalars().all())
        names = await self._name_map(
            org_id,
            {a.audited_by for a in audits} | {a.applied_by for a in audits},
        )
        return [self._audit_summary(a, names) for a in audits]

    async def get_audit(self, audit_id: str, organization_id: str) -> Dict[str, Any]:
        """One audit with its lines. Raises ``LookupError``."""
        org_id = str(organization_id)
        audit = await self._get_audit(audit_id, org_id)
        names = await self._name_map(org_id, {audit.audited_by, audit.applied_by})
        order = {
            InventoryNfcAuditResult.MISSING: 0,
            InventoryNfcAuditResult.UNEXPECTED: 1,
            InventoryNfcAuditResult.FOUND: 2,
        }
        lines = sorted(
            audit.items, key=lambda ln: (order[ln.result], ln.item_name.lower(), ln.id)
        )
        detail = self._audit_summary(audit, names)
        detail["items"] = [
            {
                "id": ln.id,
                "item_id": ln.item_id,
                "item_name": ln.item_name,
                "result": ln.result,
                "recorded_storage_area_id": ln.recorded_storage_area_id,
                "recorded_storage_area_name": ln.recorded_storage_area_name,
                "moved": bool(ln.moved),
            }
            for ln in lines
        ]
        return detail

    # =========================================================================
    # Bulk enrollment
    # =========================================================================

    async def list_untagged_items(
        self,
        organization_id: str,
        *,
        search: Optional[str] = None,
        category_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Active items with no working tag, for tagging one after another.

        An item whose only tag is marked lost counts as untagged: it needs a
        new one.
        """
        org_id = str(organization_id)
        tagged = select(InventoryNfcTag.item_id).where(
            InventoryNfcTag.organization_id == org_id,
            InventoryNfcTag.item_id.is_not(None),
            InventoryNfcTag.status == InventoryNfcTagStatus.ACTIVE,
        )
        query = (
            select(InventoryItem)
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.active.is_(True),
                InventoryItem.status != ItemStatus.RETIRED,
                InventoryItem.id.notin_(tagged),
            )
            .options(selectinload(InventoryItem.category))
        )
        if category_id:
            query = query.where(InventoryItem.category_id == str(category_id))
        if search and search.strip():
            pattern = like_pattern(search.strip())
            query = query.where(
                or_(
                    InventoryItem.name.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    InventoryItem.serial_number.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    InventoryItem.asset_tag.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                )
            )
        result = await self.db.execute(
            query.order_by(InventoryItem.name.asc(), InventoryItem.id.asc()).limit(
                max(1, min(limit, _MAX_UNTAGGED_LISTED))
            )
        )
        items = list(result.scalars().all())
        areas = await self._area_name_map(org_id, {i.storage_area_id for i in items})
        return [
            {
                "id": item.id,
                "name": item.name,
                "serial_number": item.serial_number,
                "asset_tag": item.asset_tag,
                "category_name": item.category.name if item.category else None,
                "storage_area_name": areas.get(item.storage_area_id),
            }
            for item in items
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

    async def _find_compartment(
        self, compartment_id: str, organization_id: str
    ) -> Optional[CheckTemplateCompartment]:
        # Compartments carry no organization_id; the template's is the scope
        # (Pitfall #14a, parent-resolution shape).
        result = await self.db.execute(
            select(CheckTemplateCompartment)
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(
                CheckTemplateCompartment.id == str(compartment_id),
                EquipmentCheckTemplate.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def _get_compartment(
        self, compartment_id: str, organization_id: str
    ) -> CheckTemplateCompartment:
        compartment = await self._find_compartment(compartment_id, organization_id)
        if compartment is None:
            raise LookupError("Compartment not found")
        return compartment

    async def _find_active_tag(
        self, organization_id: str, candidates: Sequence[Optional[str]]
    ) -> InventoryNfcTag:
        """The first candidate that names a tag, which must not be marked lost.

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
        return tag

    async def _active_item_for_tag(
        self, tag: InventoryNfcTag, organization_id: str
    ) -> InventoryItem:
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

    async def _get_audit(
        self, audit_id: str, organization_id: str
    ) -> InventoryNfcAudit:
        result = await self.db.execute(
            select(InventoryNfcAudit)
            .where(
                InventoryNfcAudit.id == str(audit_id),
                InventoryNfcAudit.organization_id == str(organization_id),
            )
            .options(selectinload(InventoryNfcAudit.items))
            .execution_options(populate_existing=True)
        )
        audit = result.scalar_one_or_none()
        if audit is None:
            raise LookupError("Audit not found")
        return audit

    @staticmethod
    def _audit_summary(
        audit: InventoryNfcAudit, names: Dict[str, str]
    ) -> Dict[str, Any]:
        return {
            "id": audit.id,
            "storage_area_id": audit.storage_area_id,
            "storage_area_name": audit.storage_area_name,
            "expected_count": audit.expected_count,
            "found_count": audit.found_count,
            "missing_count": audit.missing_count,
            "unexpected_count": audit.unexpected_count,
            "audited_by": audit.audited_by,
            "audited_by_name": (
                names.get(audit.audited_by) if audit.audited_by else None
            ),
            "audited_at": audit.audited_at,
            "applied_by": audit.applied_by,
            "applied_by_name": (
                names.get(audit.applied_by) if audit.applied_by else None
            ),
            "applied_at": audit.applied_at,
        }

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
        target: _Target,
    ) -> str:
        if target.id in (
            existing.item_id,
            existing.storage_area_id,
            existing.check_compartment_id,
        ):
            if isinstance(target, InventoryItem):
                noun = "item"
            elif isinstance(target, StorageArea):
                noun = "storage area"
            else:
                noun = "compartment"
            return f"This tag is already linked to this {noun}."
        # Naming the other item, area or compartment is safe here, unlike for a
        # member ID card: the caller manages inventory or checklists in this
        # organization, the name is of equipment rather than a person, and
        # "where is this tag linked" is exactly what they need to fix it.
        if existing.item_id is not None:
            result = await self.db.execute(
                select(InventoryItem.name).where(
                    InventoryItem.id == existing.item_id,
                    InventoryItem.organization_id == existing.organization_id,
                )
            )
            name = result.scalar_one_or_none()
            place = f'"{name}"' if name else "another item"
        elif existing.check_compartment_id is not None:
            result = await self.db.execute(
                select(CheckTemplateCompartment.name, EquipmentCheckTemplate.name)
                .join(
                    EquipmentCheckTemplate,
                    EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
                )
                .where(
                    CheckTemplateCompartment.id == existing.check_compartment_id,
                    EquipmentCheckTemplate.organization_id == existing.organization_id,
                )
            )
            row = result.first()
            place = f'"{row[0]}" on "{row[1]}"' if row else "another compartment"
        else:
            result = await self.db.execute(
                select(StorageArea.name).where(
                    StorageArea.id == existing.storage_area_id,
                    StorageArea.organization_id == existing.organization_id,
                )
            )
            name = result.scalar_one_or_none()
            place = f'"{name}"' if name else "another storage area"
        return (
            f"This tag is already linked to {place}. "
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
            "check_compartment_id": tag.check_compartment_id,
            "uid_preview": tag.uid_preview,
            "credential_type": tag.credential_type,
            "label": tag.label,
            "status": tag.status,
            "linked_by": tag.linked_by,
            "linked_by_name": names.get(tag.linked_by) if tag.linked_by else None,
            "linked_at": tag.linked_at,
        }
