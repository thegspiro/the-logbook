"""
History events: fires, openings, ceremonies and the rest of what happened,
and what each links to — past members with their role, apparatus, photos and
documents.

An event needs a start date (a year at least) so it can be placed on the
timeline, and may have an end date for something that ran over days or
years. No civilian fields (owner decision 7): a civilian's name goes in the
description, which the clearance list checks before anything is public, or in
the encrypted research notes.

What a member sees is what they could reach anyway: a link to a person,
apparatus, photo or document that is still a draft is left out of their view
rather than shown as a name they cannot open.

Every query filters ``organization_id``; every client-sent id is resolved
inside the caller's department before it is stored (CLAUDE.md pitfall #14).
"""

import copy
from datetime import date
from typing import Any, Iterable, Optional

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.history import (
    DatePrecision,
    HistoricalMember,
    HistoryDocument,
    HistoryEvent,
    HistoryEventApparatus,
    HistoryEventDocument,
    HistoryEventMedia,
    HistoryEventMember,
    HistoryMedia,
    HistorySource,
    PublicationLevel,
    RevisionKind,
)
from app.services.history_document_service import HistoryDocumentService
from app.services.history_lists_service import (
    EVENT_TYPES,
    STATIONS,
    HistoryListService,
)
from app.services.history_media_service import HistoryMediaService
from app.services.history_records import (
    READABLE_BY_MEMBERS,
    PublishedRecordService,
    apparatus_tag_views,
    can_read_record,
    public_apparatus_names,
    validated_apparatus_ids,
)
from app.services.history_service import (
    Viewer,
    display_name,
    normalize_partial_date,
)
from app.utils.model_updates import apply_updates
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

RECORD_EVENT = "event"

CATALOGUE_FIELDS = (
    "title",
    "description",
    "start_date",
    "start_precision",
    "start_circa",
    "end_date",
    "end_precision",
    "end_circa",
    "place",
    "station_id",
    "event_type_id",
    "research_notes",
    "source_id",
)

#: Research notes and the source are the archive's housekeeping; every other
#: field is what a reader sees, so changing it needs clearing again.
SUBSTANTIAL_FIELDS = frozenset(CATALOGUE_FIELDS) - {"research_notes", "source_id"}

_TEXT_FIELDS = ("title", "description", "place", "research_notes")

_SEARCHED = (HistoryEvent.title, HistoryEvent.description, HistoryEvent.place)

#: The longest role a person can be given on an event.
ROLE_MAX = 100


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, date) else _enum_value(value)


def _clean(values: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(values)
    for field in _TEXT_FIELDS:
        if field in cleaned and isinstance(cleaned[field], str):
            cleaned[field] = cleaned[field].strip() or None
    return cleaned


class HistoryEventService(PublishedRecordService[HistoryEvent]):
    record_type = RECORD_EVENT
    noun = "event"

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.stations = HistoryListService(db, STATIONS)
        self.types = HistoryListService(db, EVENT_TYPES)
        self.media = HistoryMediaService(db)
        self.documents = HistoryDocumentService(db)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    @staticmethod
    def _options():
        return (
            selectinload(HistoryEvent.event_type),
            selectinload(HistoryEvent.station),
            selectinload(HistoryEvent.source),
            selectinload(HistoryEvent.members).selectinload(HistoryEventMember.member),
            selectinload(HistoryEvent.apparatus_links).selectinload(
                HistoryEventApparatus.apparatus
            ),
            selectinload(HistoryEvent.media_links)
            .selectinload(HistoryEventMedia.media)
            .selectinload(HistoryMedia.files),
            selectinload(HistoryEvent.document_links)
            .selectinload(HistoryEventDocument.history_document)
            .selectinload(HistoryDocument.files),
            selectinload(HistoryEvent.document_links)
            .selectinload(HistoryEventDocument.history_document)
            .selectinload(HistoryDocument.document_type),
        )

    async def get_event(
        self, organization_id: str, event_id: str
    ) -> Optional[HistoryEvent]:
        return await self.db.scalar(
            select(HistoryEvent)
            .options(*self._options())
            .where(
                HistoryEvent.id == str(event_id),
                HistoryEvent.organization_id == str(organization_id),
            )
            .execution_options(populate_existing=True)
        )

    async def _reload(self, item: HistoryEvent) -> HistoryEvent:
        reloaded = await self.get_event(item.organization_id, item.id)
        if reloaded is None:
            raise ValueError("This event could not be read back")
        return reloaded

    @staticmethod
    def can_read(viewer: Viewer, item: HistoryEvent) -> bool:
        return can_read_record(viewer.can_view_archive, item)

    async def get_readable_event(
        self, viewer: Viewer, event_id: str
    ) -> Optional[HistoryEvent]:
        item = await self.get_event(viewer.organization_id, event_id)
        if item is None or not self.can_read(viewer, item):
            return None
        return item

    async def list_events(
        self,
        viewer: Viewer,
        *,
        search: Optional[str] = None,
        event_type_id: Optional[str] = None,
        station_id: Optional[str] = None,
        decade: Optional[int] = None,
        member_id: Optional[str] = None,
        apparatus_id: Optional[str] = None,
        media_id: Optional[str] = None,
        document_id: Optional[str] = None,
        level: Optional[PublicationLevel] = None,
        limit: int = 60,
        offset: int = 0,
    ) -> tuple[list[HistoryEvent], int]:
        conditions = [HistoryEvent.organization_id == viewer.organization_id]
        if not viewer.can_view_archive:
            conditions.append(HistoryEvent.publication_level.in_(READABLE_BY_MEMBERS))
        elif level is not None:
            conditions.append(HistoryEvent.publication_level == level)
        if event_type_id:
            conditions.append(HistoryEvent.event_type_id == str(event_type_id))
        if station_id:
            conditions.append(HistoryEvent.station_id == str(station_id))
        if search and search.strip():
            pattern = like_pattern(search.strip())
            conditions.append(
                or_(
                    *(
                        column.ilike(pattern, escape=LIKE_ESCAPE_CHAR)
                        for column in _SEARCHED
                    )
                )
            )
        if decade is not None:
            # An event that ran across a decade boundary belongs to both.
            start, end = date(decade, 1, 1), date(decade + 9, 12, 31)
            conditions.append(HistoryEvent.start_date <= end)
            conditions.append(
                func.coalesce(HistoryEvent.end_date, HistoryEvent.start_date) >= start
            )
        for link, column, value in (
            (HistoryEventMember, HistoryEventMember.member_id, member_id),
            (HistoryEventApparatus, HistoryEventApparatus.apparatus_id, apparatus_id),
            (HistoryEventMedia, HistoryEventMedia.media_id, media_id),
            (HistoryEventDocument, HistoryEventDocument.document_id, document_id),
        ):
            if value:
                conditions.append(
                    exists(
                        select(link.event_id).where(
                            link.event_id == HistoryEvent.id, column == str(value)
                        )
                    )
                )
        total = int(
            await self.db.scalar(
                select(func.count()).select_from(HistoryEvent).where(*conditions)
            )
            or 0
        )
        result = await self.db.execute(
            select(HistoryEvent)
            .options(
                selectinload(HistoryEvent.event_type),
                selectinload(HistoryEvent.station),
            )
            .where(*conditions)
            .order_by(HistoryEvent.start_date, HistoryEvent.title, HistoryEvent.id)
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().unique().all()), total

    async def related(
        self,
        viewer: Viewer,
        *,
        member_id: Optional[str] = None,
        apparatus_id: Optional[str] = None,
        media_id: Optional[str] = None,
        document_id: Optional[str] = None,
    ) -> list[HistoryEvent]:
        """The events a person, apparatus, photo or document is linked to
        that the caller may read."""
        items, _ = await self.list_events(
            viewer,
            member_id=member_id,
            apparatus_id=apparatus_id,
            media_id=media_id,
            document_id=document_id,
            limit=200,
        )
        return items

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    def summary(self, item: HistoryEvent) -> dict[str, Any]:
        return {
            "id": item.id,
            "title": item.title,
            "start_date": item.start_date,
            "start_precision": item.start_precision,
            "start_circa": item.start_circa,
            "end_date": item.end_date,
            "end_precision": item.end_precision,
            "end_circa": item.end_circa,
            "place": item.place,
            "station_name": item.station.name if item.station is not None else None,
            "event_type_name": (
                item.event_type.name if item.event_type is not None else None
            ),
            "publication_level": item.publication_level,
        }

    def _catalogue(self, item: HistoryEvent) -> dict[str, Any]:
        view = self.summary(item)
        view.update(
            {
                "description": item.description,
                "station_id": item.station_id,
                "event_type_id": item.event_type_id,
                "source_id": item.source_id,
                "source_name": item.source.name if item.source is not None else None,
            }
        )
        return view

    def _links(self, can_view_archive: bool, item: HistoryEvent) -> dict[str, Any]:
        """The event's links, each only where the caller may read the record
        it points at."""
        return {
            "members": [
                {
                    "member_id": link.member_id,
                    "display_name": display_name(link.member),
                    "role": link.role,
                }
                for link in sorted(
                    item.members,
                    key=lambda m: (m.member.last_name, m.member.first_name or ""),
                )
                if can_read_record(can_view_archive, link.member)
            ],
            "apparatus": apparatus_tag_views(
                can_view_archive, (link.apparatus for link in item.apparatus_links)
            ),
            "media": [
                self.media.summary(link.media)
                for link in item.media_links
                if can_read_record(can_view_archive, link.media)
            ],
            "documents": [
                self.documents.summary(link.history_document)
                for link in item.document_links
                if can_read_record(can_view_archive, link.history_document)
            ],
        }

    def member_view(self, viewer: Viewer, item: HistoryEvent) -> dict[str, Any]:
        view = self._catalogue(item)
        view["view"] = "member"
        view.update(self._links(viewer.can_view_archive, item))
        return view

    def full_view(
        self,
        viewer: Viewer,
        item: HistoryEvent,
        clearance: Optional[dict[str, Any]],
        *,
        clearance_required: bool,
        cleared_for_public: bool,
    ) -> dict[str, Any]:
        view = self._catalogue(item)
        view.update(self._links(True, item))
        view.update(
            {
                "view": "full",
                "research_notes": item.research_notes,
                "published_at": item.published_at,
                "revision_number": item.revision_number,
                "public_revision_number": item.public_revision_number,
                "public_changes_pending": self.public_changes_pending(item),
                "clearance": clearance,
                "clearance_required": clearance_required,
                "cleared_for_public": cleared_for_public,
                "can_edit": viewer.can_manage,
                "can_publish": viewer.can_publish,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
            }
        )
        return view

    # ------------------------------------------------------------------
    # Change history
    # ------------------------------------------------------------------

    def _snapshot(self, item: HistoryEvent) -> dict[str, Any]:
        data = {field: _iso(getattr(item, field)) for field in CATALOGUE_FIELDS}
        data["members"] = sorted(
            ({"member_id": m.member_id, "role": m.role} for m in item.members),
            key=lambda m: m["member_id"],
        )
        data["apparatus_ids"] = sorted(a.apparatus_id for a in item.apparatus_links)
        data["media_ids"] = [m.media_id for m in item.media_links]
        data["document_ids"] = [d.document_id for d in item.document_links]
        return data

    def _public_snapshot(self, item: HistoryEvent) -> dict[str, Any]:
        """What the public may see: the catalogue without the research notes,
        and a link only to a record that is itself public."""
        public = PublicationLevel.PUBLIC
        snapshot = copy.deepcopy(
            {
                key: value
                for key, value in self._snapshot(item).items()
                if key
                not in (
                    "research_notes",
                    "source_id",
                    "station_id",
                    "event_type_id",
                    "members",
                    "apparatus_ids",
                    "media_ids",
                    "document_ids",
                )
            }
        )
        snapshot["source_name"] = item.source.name if item.source else None
        snapshot["station_name"] = item.station.name if item.station else None
        snapshot["event_type_name"] = item.event_type.name if item.event_type else None
        snapshot["members"] = sorted(
            (
                {"display_name": display_name(m.member), "role": m.role}
                for m in item.members
                if m.member.publication_level == public
            ),
            key=lambda m: m["display_name"],
        )
        snapshot["apparatus"] = public_apparatus_names(
            link.apparatus for link in item.apparatus_links
        )
        snapshot["media_ids"] = [
            link.media_id
            for link in item.media_links
            if link.media.publication_level == public
        ]
        snapshot["document_ids"] = [
            link.document_id
            for link in item.document_links
            if link.history_document.publication_level == public
        ]
        return snapshot

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    async def _validated_source_id(
        self, organization_id: str, source_id: Optional[str]
    ) -> Optional[str]:
        if not source_id:
            return None
        found = await self.db.scalar(
            select(HistorySource.id).where(
                HistorySource.id == str(source_id),
                HistorySource.organization_id == str(organization_id),
            )
        )
        if found is None:
            raise ValueError("That source is not on this department's list")
        return str(found)

    async def _validated_references(
        self, organization_id: str, values: dict[str, Any]
    ) -> dict[str, Any]:
        if "source_id" in values:
            values["source_id"] = await self._validated_source_id(
                organization_id, values["source_id"]
            )
        if "station_id" in values:
            values["station_id"] = await self.stations.validated_id(
                organization_id, values["station_id"]
            )
        if "event_type_id" in values:
            values["event_type_id"] = await self.types.validated_id(
                organization_id, values["event_type_id"]
            )
        return values

    async def _validated_ids(
        self,
        model: Any,
        column: Any,
        organization_id: str,
        ids: Iterable[str],
        what: str,
    ) -> list[str]:
        wanted = list(dict.fromkeys(str(i) for i in ids))
        if not wanted:
            return []
        found = set(
            (
                await self.db.execute(
                    select(column).where(
                        model.organization_id == str(organization_id),
                        column.in_(wanted),
                    )
                )
            ).scalars()
        )
        if len(found) != len(wanted):
            raise ValueError(f"A linked {what} is not in this department's archive")
        return wanted

    @staticmethod
    def _settle_dates(item: HistoryEvent) -> None:
        start = normalize_partial_date(
            item.start_date, item.start_precision or DatePrecision.YEAR
        )
        if start is None:
            raise ValueError("Enter the date the event began, a year at least")
        item.start_date = start
        item.end_date = normalize_partial_date(
            item.end_date, item.end_precision or DatePrecision.YEAR
        )
        if item.end_date is not None and item.end_date < start:
            raise ValueError("An event cannot end before it begins")

    # ------------------------------------------------------------------
    # Links
    # ------------------------------------------------------------------

    async def _write_links(self, item: HistoryEvent, links: dict[str, Any]) -> None:
        """Replace each link set *links* names; a set it does not name is
        left alone."""
        org = item.organization_id
        if "members" in links:
            entries: dict[str, Optional[str]] = {}
            for entry in links["members"] or []:
                role = (entry.get("role") or "").strip()[:ROLE_MAX] or None
                entries[str(entry["member_id"])] = role
            await self._validated_ids(
                HistoricalMember, HistoricalMember.id, org, entries, "person"
            )
            await self.db.execute(
                delete(HistoryEventMember).where(HistoryEventMember.event_id == item.id)
            )
            for member_id, role in entries.items():
                self.db.add(
                    HistoryEventMember(
                        event_id=item.id,
                        member_id=member_id,
                        role=role,
                        created_by=item.updated_by,
                    )
                )
        if "apparatus_ids" in links:
            wanted = await validated_apparatus_ids(
                self.db, org, links["apparatus_ids"] or []
            )
            await self.db.execute(
                delete(HistoryEventApparatus).where(
                    HistoryEventApparatus.event_id == item.id
                )
            )
            for apparatus_id in wanted:
                self.db.add(
                    HistoryEventApparatus(event_id=item.id, apparatus_id=apparatus_id)
                )
        if "media_ids" in links:
            wanted = await self._validated_ids(
                HistoryMedia, HistoryMedia.id, org, links["media_ids"] or [], "photo"
            )
            await self.db.execute(
                delete(HistoryEventMedia).where(HistoryEventMedia.event_id == item.id)
            )
            for position, media_id in enumerate(wanted):
                self.db.add(
                    HistoryEventMedia(
                        event_id=item.id, media_id=media_id, position=position
                    )
                )
        if "document_ids" in links:
            wanted = await self._validated_ids(
                HistoryDocument,
                HistoryDocument.document_id,
                org,
                links["document_ids"] or [],
                "document",
            )
            await self.db.execute(
                delete(HistoryEventDocument).where(
                    HistoryEventDocument.event_id == item.id
                )
            )
            for position, document_id in enumerate(wanted):
                self.db.add(
                    HistoryEventDocument(
                        event_id=item.id, document_id=document_id, position=position
                    )
                )
        await self.db.flush()

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def create(
        self,
        organization_id: str,
        values: dict[str, Any],
        links: dict[str, Any],
        actor_id: str,
    ) -> HistoryEvent:
        values = _clean(values)
        if not values.get("title"):
            raise ValueError("Enter a title")
        values = await self._validated_references(organization_id, values)
        item = HistoryEvent(
            organization_id=str(organization_id),
            created_by=actor_id,
            updated_by=actor_id,
            revision_number=1,
            substantial_revision_number=1,
        )
        for field in CATALOGUE_FIELDS:
            if values.get(field) is not None:
                setattr(item, field, values[field])
        self._settle_dates(item)
        self.db.add(item)
        await self.db.flush()
        await self._write_links(item, links)
        created = await self._reload(item)
        await self._log(created, RevisionKind.CREATED, actor_id, with_snapshot=True)
        return created

    async def update(
        self,
        item: HistoryEvent,
        values: dict[str, Any],
        links: dict[str, Any],
        *,
        edit_kind: str,
        edit_note: Optional[str],
        actor_id: str,
    ) -> HistoryEvent:
        values = _clean(values)
        if "title" in values and not values["title"]:
            raise ValueError("Enter a title")
        values = await self._validated_references(item.organization_id, values)
        before = self._snapshot(item)
        apply_updates(
            item,
            {k: v for k, v in values.items() if k in CATALOGUE_FIELDS},
            skip=set(),
        )
        self._settle_dates(item)
        item.updated_by = actor_id
        await self.db.flush()
        await self._write_links(item, links)
        reloaded = await self._reload(item)
        after = self._snapshot(reloaded)
        # A change of people, apparatus, photos or documents is substantial:
        # it changes what the event shows.
        changed = any(
            before[key] != after[key]
            for key in (
                *SUBSTANTIAL_FIELDS,
                "members",
                "apparatus_ids",
                "media_ids",
                "document_ids",
            )
        )
        return await self._after_edit(
            reloaded, edit_kind == "substantial" or changed, edit_note, actor_id
        )

    # ------------------------------------------------------------------
    # Person merge
    # ------------------------------------------------------------------

    async def move_members(self, from_member_id: str, to_member_id: str) -> None:
        """A person merge's part: the removed person's event links move to the
        kept person. Where both were on one event, the kept person's link and
        role stay (owner-approved spec, 2026-11-21)."""
        both = set(
            (
                await self.db.execute(
                    select(HistoryEventMember.event_id).where(
                        HistoryEventMember.member_id == to_member_id
                    )
                )
            ).scalars()
        )
        result = await self.db.execute(
            select(HistoryEventMember).where(
                HistoryEventMember.member_id == from_member_id
            )
        )
        for link in result.scalars().all():
            if link.event_id not in both:
                self.db.add(
                    HistoryEventMember(
                        event_id=link.event_id,
                        member_id=to_member_id,
                        role=link.role,
                        created_by=link.created_by,
                    )
                )
            await self.db.delete(link)
        await self.db.flush()
