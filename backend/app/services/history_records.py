"""
Publication and change history for the phase 5 records: events and
historical apparatus.

The same rules as people, photos and documents, written once for the two new
record types rather than copied into each:

* every write adds a numbered revision to ``history_revisions``;
* a substantial edit needs clearing again before the public sees it, and
  withdraws a clearance request still waiting, because that request is
  reviewing text that no longer exists; a minor edit reaches the public copy
  at once unless substantial changes already wait;
* publishing to the public needs the clearance list to have cleared the
  latest substantial revision, and writes the public snapshot;
* a record can be deleted only while it is a draft.

The person, photo and document services keep their own copies of these
rules; they were written first and are not rewritten here.
"""

from datetime import datetime, timezone
from typing import Any, Generic, Iterable, Optional, TypeVar

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.history import (
    HistoryApparatus,
    HistoryClearanceRequest,
    HistoryEvent,
    HistoryRevision,
    PublicationLevel,
    RevisionKind,
)

_LEVEL_ORDER = [
    PublicationLevel.DRAFT,
    PublicationLevel.MEMBERS,
    PublicationLevel.PUBLIC,
]
READABLE_BY_MEMBERS = (PublicationLevel.MEMBERS, PublicationLevel.PUBLIC)

#: The records this base serves; each subclass names its own.
RecordT = TypeVar("RecordT", HistoryApparatus, HistoryEvent)


def can_read_record(can_view_archive: bool, record: Any) -> bool:
    """Whether a caller may read a published record: the archive's keepers
    read drafts too, everyone else what is published to members or the
    public."""
    return can_view_archive or bool(record.publication_level in READABLE_BY_MEMBERS)


def apparatus_tag_views(
    can_view_archive: bool, apparatus: Iterable[HistoryApparatus]
) -> list[dict[str, Any]]:
    """Apparatus tagged on a photo, document or event, as the caller may see
    them: a member never learns the name of a draft apparatus record."""
    return [
        {"apparatus_id": item.id, "name": item.name}
        for item in sorted(apparatus, key=lambda a: a.name.casefold())
        if can_read_record(can_view_archive, item)
    ]


async def validated_apparatus_ids(
    db: AsyncSession, organization_id: str, apparatus_ids: Iterable[str]
) -> list[str]:
    """Apparatus ids a client sent, each confirmed to be in the department's
    archive before it is stored (pitfall #14c)."""
    wanted = list(dict.fromkeys(str(a) for a in apparatus_ids))
    if not wanted:
        return []
    found = set(
        (
            await db.execute(
                select(HistoryApparatus.id).where(
                    HistoryApparatus.organization_id == str(organization_id),
                    HistoryApparatus.id.in_(wanted),
                )
            )
        ).scalars()
    )
    if len(found) != len(wanted):
        raise ValueError("A tagged apparatus is not in this department's archive")
    return wanted


def public_apparatus_names(apparatus: Iterable[HistoryApparatus]) -> list[str]:
    """For a public snapshot: only apparatus whose own record is public."""
    return sorted(
        item.name
        for item in apparatus
        if item.publication_level == PublicationLevel.PUBLIC
    )


class PublishedRecordService(Generic[RecordT]):
    """Base for a service whose record carries the publication columns
    (``publication_level`` through ``revision_number``)."""

    #: The ``record_type`` its revisions and clearance requests carry.
    record_type: str = ""
    #: How messages name the record: "event", "apparatus record".
    noun: str = "record"

    def __init__(self, db: AsyncSession):
        self.db = db

    # Subclasses supply these three.

    def _snapshot(self, item: RecordT) -> dict[str, Any]:
        raise NotImplementedError

    def _public_snapshot(self, item: RecordT) -> dict[str, Any]:
        raise NotImplementedError

    async def _reload(self, item: RecordT) -> RecordT:
        raise NotImplementedError

    @staticmethod
    def public_changes_pending(item: RecordT) -> bool:
        return (
            item.publication_level == PublicationLevel.PUBLIC
            and (item.public_revision_number or 0) < item.substantial_revision_number
        )

    async def _log(
        self,
        item: RecordT,
        kind: RevisionKind,
        actor_id: Optional[str],
        note: Optional[str] = None,
        *,
        with_snapshot: bool = False,
    ) -> None:
        self.db.add(
            HistoryRevision(
                organization_id=item.organization_id,
                record_type=self.record_type,
                record_id=item.id,
                revision_number=item.revision_number,
                kind=kind,
                snapshot=self._snapshot(item) if with_snapshot else None,
                note=(note or "").strip() or None,
                actor_id=actor_id,
            )
        )
        await self.db.flush()

    async def _after_edit(
        self, item: RecordT, substantial: bool, note: Optional[str], actor_id: str
    ) -> RecordT:
        from app.services.history_clearance_service import HistoryClearanceService

        item.revision_number += 1
        if substantial:
            item.substantial_revision_number = item.revision_number
        await self.db.flush()
        await self._log(
            item,
            RevisionKind.SUBSTANTIAL if substantial else RevisionKind.MINOR,
            actor_id,
            note,
            with_snapshot=True,
        )
        if substantial:
            await HistoryClearanceService(self.db).withdraw_pending(
                item.organization_id, self.record_type, item.id, actor_id
            )
        elif (
            item.publication_level == PublicationLevel.PUBLIC
            and not self.public_changes_pending(item)
        ):
            item.public_snapshot = self._public_snapshot(item)
            item.public_revision_number = item.revision_number
            await self.db.flush()
        return item

    async def publish(
        self, item: RecordT, level: PublicationLevel, actor_id: str
    ) -> RecordT:
        from app.services.history_clearance_service import HistoryClearanceService

        if level == PublicationLevel.PUBLIC:
            if (
                item.publication_level == PublicationLevel.PUBLIC
                and not self.public_changes_pending(item)
            ):
                raise ValueError(f"This {self.noun} is already public and up to date")
            if not await HistoryClearanceService(self.db).is_cleared(
                item.organization_id,
                self.record_type,
                item.id,
                item.substantial_revision_number,
            ):
                raise ValueError(
                    f"This {self.noun} must pass the department's clearance list "
                    "before it is published to the public"
                )
            item.public_snapshot = self._public_snapshot(item)
            item.public_revision_number = item.revision_number
        elif item.publication_level != PublicationLevel.DRAFT:
            raise ValueError(f"This {self.noun} is already published to members")
        item.publication_level = level
        item.published_at = datetime.now(timezone.utc)
        item.published_by = actor_id
        await self.db.flush()
        await self._log(
            item, RevisionKind.PUBLISHED, actor_id, f"Published to {level.value}"
        )
        return item

    async def unpublish(self, item: Any, level: PublicationLevel, actor_id: str) -> Any:
        if _LEVEL_ORDER.index(level) >= _LEVEL_ORDER.index(item.publication_level):
            raise ValueError(f"Choose a level below the {self.noun}'s current one")
        item.publication_level = level
        item.public_snapshot = None
        item.public_revision_number = None
        if level == PublicationLevel.DRAFT:
            item.published_at = None
            item.published_by = None
        await self.db.flush()
        await self._log(
            item,
            RevisionKind.UNPUBLISHED,
            actor_id,
            "Returned to draft" if level == PublicationLevel.DRAFT else "Members only",
        )
        return item

    async def delete(self, item: RecordT) -> None:
        """Remove a draft record, its change history and clearance requests.
        Its links go by cascade."""
        if item.publication_level != PublicationLevel.DRAFT:
            raise ValueError(f"Unpublish this {self.noun} before deleting it")
        for model in (HistoryRevision, HistoryClearanceRequest):
            await self.db.execute(
                delete(model).where(
                    model.organization_id == item.organization_id,
                    model.record_type == self.record_type,
                    model.record_id == item.id,
                )
            )
        await self.db.delete(item)
        await self.db.flush()
