"""
History collections: the managed source / donor and document-type lists, and
albums. The phase 5 lists (stations, apparatus and event types) are in
``history_lists_service``.

Both lists are managed like the title list (owner decision): an entry is
retired or merged into another, never deleted while an item points at it. A
source is shared by photos, documents, apparatus and events.

Albums are draft or shown to members; public album pages arrive with the
public feed. An album holds photos and documents in one order (phase 4,
owner decision 11) and lists only the entries the viewer may read, so a
draft photo or document inside a published album stays hidden from members,
and a member never sees a draft album at all.
"""

from typing import Any, Literal, Optional, Union

from sqlalchemy import delete, func, select, union_all, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.history import (
    AlbumLevel,
    HistoryAlbum,
    HistoryAlbumDocument,
    HistoryAlbumItem,
    HistoryApparatus,
    HistoryDocument,
    HistoryDocumentType,
    HistoryEvent,
    HistoryMedia,
    HistorySource,
)
from app.models.user import Organization
from app.services.history_document_service import (
    DEFAULT_DOCUMENT_TYPES,
    HistoryDocumentService,
)
from app.services.history_media_service import HistoryMediaService
from app.services.history_service import Viewer, clean_title_name, title_key

EntryKind = Literal["media", "document"]

#: Every record that carries a ``source_id``. A source's usage count and a
#: source merge cover all of them.
_SOURCE_USERS = (HistoryMedia, HistoryDocument, HistoryApparatus, HistoryEvent)
#: One entry of an album, in the album's order.
AlbumEntry = tuple[EntryKind, Union[HistoryMedia, HistoryDocument]]


class HistorySourceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_sources(
        self, organization_id: str, *, include_retired: bool
    ) -> list[tuple[HistorySource, int]]:
        # A source is used by photos, documents, apparatus and events; every
        # use counts.
        users = union_all(
            *(
                select(model.source_id.label("source_id")).where(
                    model.organization_id == str(organization_id)
                )
                for model in _SOURCE_USERS
            )
        )
        uses = users.subquery()
        usage = (
            select(uses.c.source_id, func.count().label("uses"))
            .group_by(uses.c.source_id)
            .subquery()
        )
        query = (
            select(HistorySource, func.coalesce(usage.c.uses, 0))
            .outerjoin(usage, usage.c.source_id == HistorySource.id)
            .where(HistorySource.organization_id == str(organization_id))
            .order_by(HistorySource.sort_order, HistorySource.name)
        )
        if not include_retired:
            query = query.where(HistorySource.is_retired.is_(False))
        result = await self.db.execute(query)
        return [(source, int(uses)) for source, uses in result.all()]

    async def get_source(
        self, organization_id: str, source_id: str
    ) -> Optional[HistorySource]:
        return await self.db.scalar(
            select(HistorySource).where(
                HistorySource.id == str(source_id),
                HistorySource.organization_id == str(organization_id),
            )
        )

    async def _by_key(self, organization_id: str, key: str) -> Optional[HistorySource]:
        return await self.db.scalar(
            select(HistorySource).where(
                HistorySource.organization_id == str(organization_id),
                HistorySource.name_key == key,
            )
        )

    async def create_source(
        self, organization_id: str, name: str, actor_id: str
    ) -> HistorySource:
        cleaned = clean_title_name(name)
        if not cleaned:
            raise ValueError("Enter a source")
        existing = await self._by_key(organization_id, title_key(cleaned))
        if existing:
            raise ValueError(f'"{existing.name}" is already on the list')
        highest = await self.db.scalar(
            select(func.max(HistorySource.sort_order)).where(
                HistorySource.organization_id == str(organization_id)
            )
        )
        source = HistorySource(
            organization_id=str(organization_id),
            name=cleaned[:150],
            name_key=title_key(cleaned)[:150],
            sort_order=int(highest or 0) + 1,
            created_by=actor_id,
        )
        self.db.add(source)
        await self.db.flush()
        await self.db.refresh(source)
        return source

    async def update_source(
        self, source: HistorySource, updates: dict[str, Any]
    ) -> HistorySource:
        if updates.get("name") is not None:
            cleaned = clean_title_name(updates["name"])
            if not cleaned:
                raise ValueError("Enter a source")
            clash = await self._by_key(source.organization_id, title_key(cleaned))
            if clash and clash.id != source.id:
                raise ValueError(
                    f'"{clash.name}" is already on the list — merge into it instead'
                )
            source.name = cleaned[:150]
            source.name_key = title_key(cleaned)[:150]
        if updates.get("is_retired") is not None:
            source.is_retired = bool(updates["is_retired"])
        await self.db.flush()
        await self.db.refresh(source)
        return source

    async def merge_source(
        self, source: HistorySource, target: HistorySource
    ) -> HistorySource:
        """Move every photo, document, apparatus and event from *source* to
        *target*, then remove *source*."""
        if source.id == target.id:
            raise ValueError("Choose a different source to merge into")
        if source.organization_id != target.organization_id:
            raise ValueError("Source not found")
        for model in _SOURCE_USERS:
            await self.db.execute(
                update(model)
                .where(
                    model.organization_id == source.organization_id,
                    model.source_id == source.id,
                )
                .values(source_id=target.id)
                .execution_options(synchronize_session=False)
            )
        await self.db.delete(source)
        await self.db.flush()
        return target


class HistoryDocumentTypeService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def ensure_defaults(self, organization_id: str) -> None:
        """Give a department with no document types the starting list.

        Read-then-write with no unique key to lean on (the defaults have
        distinct keys, but two first readers would both see an empty list),
        so the insert runs under the organization row lock and re-checks
        there (pitfall #27).
        """
        if await self._count(organization_id):
            return
        org = await self.db.scalar(
            select(Organization)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )
        if org is None or await self._count(organization_id, lock=True):
            return
        for position, name in enumerate(DEFAULT_DOCUMENT_TYPES):
            self.db.add(
                HistoryDocumentType(
                    organization_id=str(organization_id),
                    name=name,
                    name_key=title_key(name)[:150],
                    sort_order=position,
                )
            )
        await self.db.flush()

    async def _count(self, organization_id: str, *, lock: bool = False) -> int:
        query = select(HistoryDocumentType.id).where(
            HistoryDocumentType.organization_id == str(organization_id)
        )
        if lock:
            query = query.with_for_update()
        return len((await self.db.execute(query)).scalars().all())

    async def list_types(
        self, organization_id: str, *, include_retired: bool
    ) -> list[tuple[HistoryDocumentType, int]]:
        await self.ensure_defaults(organization_id)
        usage = (
            select(HistoryDocument.document_type_id, func.count().label("uses"))
            .where(HistoryDocument.organization_id == str(organization_id))
            .group_by(HistoryDocument.document_type_id)
            .subquery()
        )
        query = (
            select(HistoryDocumentType, func.coalesce(usage.c.uses, 0))
            .outerjoin(usage, usage.c.document_type_id == HistoryDocumentType.id)
            .where(HistoryDocumentType.organization_id == str(organization_id))
            .order_by(HistoryDocumentType.sort_order, HistoryDocumentType.name)
        )
        if not include_retired:
            query = query.where(HistoryDocumentType.is_retired.is_(False))
        result = await self.db.execute(query)
        return [(entry, int(uses)) for entry, uses in result.all()]

    async def get_type(
        self, organization_id: str, type_id: str
    ) -> Optional[HistoryDocumentType]:
        return await self.db.scalar(
            select(HistoryDocumentType).where(
                HistoryDocumentType.id == str(type_id),
                HistoryDocumentType.organization_id == str(organization_id),
            )
        )

    async def _by_key(
        self, organization_id: str, key: str
    ) -> Optional[HistoryDocumentType]:
        return await self.db.scalar(
            select(HistoryDocumentType).where(
                HistoryDocumentType.organization_id == str(organization_id),
                HistoryDocumentType.name_key == key,
            )
        )

    async def create_type(
        self, organization_id: str, name: str, actor_id: str
    ) -> HistoryDocumentType:
        await self.ensure_defaults(organization_id)
        cleaned = clean_title_name(name)
        if not cleaned:
            raise ValueError("Enter a document type")
        existing = await self._by_key(organization_id, title_key(cleaned))
        if existing:
            raise ValueError(f'"{existing.name}" is already on the list')
        highest = await self.db.scalar(
            select(func.max(HistoryDocumentType.sort_order)).where(
                HistoryDocumentType.organization_id == str(organization_id)
            )
        )
        entry = HistoryDocumentType(
            organization_id=str(organization_id),
            name=cleaned[:150],
            name_key=title_key(cleaned)[:150],
            sort_order=int(highest or 0) + 1,
            created_by=actor_id,
        )
        self.db.add(entry)
        await self.db.flush()
        await self.db.refresh(entry)
        return entry

    async def update_type(
        self, entry: HistoryDocumentType, updates: dict[str, Any]
    ) -> HistoryDocumentType:
        if updates.get("name") is not None:
            cleaned = clean_title_name(updates["name"])
            if not cleaned:
                raise ValueError("Enter a document type")
            clash = await self._by_key(entry.organization_id, title_key(cleaned))
            if clash and clash.id != entry.id:
                raise ValueError(
                    f'"{clash.name}" is already on the list — merge into it instead'
                )
            entry.name = cleaned[:150]
            entry.name_key = title_key(cleaned)[:150]
        if updates.get("is_retired") is not None:
            entry.is_retired = bool(updates["is_retired"])
        await self.db.flush()
        await self.db.refresh(entry)
        return entry

    async def merge_type(
        self, entry: HistoryDocumentType, target: HistoryDocumentType
    ) -> HistoryDocumentType:
        """Move every document from *entry* to *target*, then remove *entry*."""
        if entry.id == target.id:
            raise ValueError("Choose a different type to merge into")
        if entry.organization_id != target.organization_id:
            raise ValueError("Document type not found")
        await self.db.execute(
            update(HistoryDocument)
            .where(
                HistoryDocument.organization_id == entry.organization_id,
                HistoryDocument.document_type_id == entry.id,
            )
            .values(document_type_id=target.id)
            .execution_options(synchronize_session=False)
        )
        await self.db.delete(entry)
        await self.db.flush()
        return target


class HistoryAlbumService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.media = HistoryMediaService(db)
        self.documents = HistoryDocumentService(db)

    async def list_albums(self, viewer: Viewer) -> list[tuple[HistoryAlbum, int]]:
        """Albums the viewer may see, each with how many of its photos and
        documents they may read."""
        conditions = [HistoryAlbum.organization_id == viewer.organization_id]
        if not viewer.can_view_archive:
            conditions.append(HistoryAlbum.level == AlbumLevel.MEMBERS)
        albums = list(
            (
                await self.db.execute(
                    select(HistoryAlbum)
                    .where(*conditions)
                    .order_by(HistoryAlbum.sort_order, HistoryAlbum.name)
                )
            )
            .scalars()
            .all()
        )
        out = []
        for album in albums:
            _, photos = await self.media.list_media(viewer, album_id=album.id, limit=1)
            _, papers = await self.documents.list_documents(
                viewer, album_id=album.id, limit=1
            )
            out.append((album, photos + papers))
        return out

    async def get_album(self, viewer: Viewer, album_id: str) -> Optional[HistoryAlbum]:
        album = await self.db.scalar(
            select(HistoryAlbum).where(
                HistoryAlbum.id == str(album_id),
                HistoryAlbum.organization_id == viewer.organization_id,
            )
        )
        if album is None:
            return None
        if not viewer.can_view_archive and album.level != AlbumLevel.MEMBERS:
            return None
        return album

    async def album_items(
        self, viewer: Viewer, album: HistoryAlbum
    ) -> list[HistoryMedia]:
        """The album's items the viewer may read, in the album's order."""
        items, _ = await self.media.list_media(viewer, album_id=album.id, limit=1000)
        positions = {
            media_id: position
            for media_id, position in (
                await self.db.execute(
                    select(HistoryAlbumItem.media_id, HistoryAlbumItem.position).where(
                        HistoryAlbumItem.album_id == album.id
                    )
                )
            ).all()
        }
        return sorted(items, key=lambda item: (positions.get(item.id, 0), item.id))

    async def album_entries(
        self, viewer: Viewer, album: HistoryAlbum
    ) -> list[AlbumEntry]:
        """The album's photos and documents the viewer may read, in the one
        order the album sets for both."""
        media = await self.album_items(viewer, album)
        papers, _ = await self.documents.list_documents(
            viewer, album_id=album.id, limit=1000
        )
        media_positions = dict(
            (
                await self.db.execute(
                    select(HistoryAlbumItem.media_id, HistoryAlbumItem.position).where(
                        HistoryAlbumItem.album_id == album.id
                    )
                )
            ).all()
        )
        paper_positions = dict(
            (
                await self.db.execute(
                    select(
                        HistoryAlbumDocument.document_id,
                        HistoryAlbumDocument.position,
                    ).where(HistoryAlbumDocument.album_id == album.id)
                )
            ).all()
        )
        keyed: list[tuple[tuple[int, str], AlbumEntry]] = [
            ((media_positions.get(m.id, 0), m.id), ("media", m)) for m in media
        ]
        keyed += [
            ((paper_positions.get(d.document_id, 0), d.document_id), ("document", d))
            for d in papers
        ]
        return [entry for _, entry in sorted(keyed, key=lambda pair: pair[0])]

    async def _validated_document_ids(
        self, organization_id: str, document_ids: list[str]
    ) -> list[str]:
        wanted = list(dict.fromkeys(str(d) for d in document_ids))
        if not wanted:
            return []
        found = set(
            (
                await self.db.execute(
                    select(HistoryDocument.document_id).where(
                        HistoryDocument.organization_id == str(organization_id),
                        HistoryDocument.document_id.in_(wanted),
                    )
                )
            ).scalars()
        )
        if len(found) != len(wanted):
            raise ValueError("A document is not in this department's archive")
        return wanted

    async def _validated_media_ids(
        self, organization_id: str, media_ids: list[str]
    ) -> list[str]:
        wanted = list(dict.fromkeys(str(m) for m in media_ids))
        if not wanted:
            return []
        found = set(
            (
                await self.db.execute(
                    select(HistoryMedia.id).where(
                        HistoryMedia.organization_id == str(organization_id),
                        HistoryMedia.id.in_(wanted),
                    )
                )
            ).scalars()
        )
        if len(found) != len(wanted):
            raise ValueError("An item is not in this department's archive")
        return wanted

    async def create_album(
        self, organization_id: str, values: dict[str, Any], actor_id: str
    ) -> HistoryAlbum:
        name = (values.get("name") or "").strip()
        if not name:
            raise ValueError("Enter an album name")
        highest = await self.db.scalar(
            select(func.max(HistoryAlbum.sort_order)).where(
                HistoryAlbum.organization_id == str(organization_id)
            )
        )
        album = HistoryAlbum(
            organization_id=str(organization_id),
            name=name[:200],
            description=(values.get("description") or "").strip() or None,
            level=values.get("level") or AlbumLevel.DRAFT,
            sort_order=int(highest or 0) + 1,
            created_by=actor_id,
        )
        self.db.add(album)
        await self.db.flush()
        await self.db.refresh(album)
        return album

    async def update_album(
        self, album: HistoryAlbum, values: dict[str, Any]
    ) -> HistoryAlbum:
        if "name" in values:
            name = (values["name"] or "").strip()
            if not name:
                raise ValueError("Enter an album name")
            album.name = name[:200]
        if "description" in values:
            album.description = (values["description"] or "").strip() or None
        if values.get("level") is not None:
            album.level = AlbumLevel(values["level"])
        if "cover_media_id" in values:
            cover = values["cover_media_id"]
            if cover:
                (cover,) = await self._validated_media_ids(
                    album.organization_id, [cover]
                )
            album.cover_media_id = cover or None
        await self.db.flush()
        await self.db.refresh(album)
        return album

    async def set_items(self, album: HistoryAlbum, media_ids: list[str]) -> None:
        """Replace the album's photos with *media_ids*, in that order (the
        phase 3 call, kept for its callers). The album's documents stay, after
        the photos and in their own order: a caller that knows only photos
        must not empty the album of everything else."""
        documents = (
            (
                await self.db.execute(
                    select(HistoryAlbumDocument.document_id)
                    .where(HistoryAlbumDocument.album_id == album.id)
                    .order_by(
                        HistoryAlbumDocument.position, HistoryAlbumDocument.document_id
                    )
                )
            )
            .scalars()
            .all()
        )
        entries: list[tuple[EntryKind, str]] = [("media", m) for m in media_ids]
        entries += [("document", d) for d in documents]
        await self.set_entries(album, entries)

    async def set_entries(
        self, album: HistoryAlbum, entries: list[tuple[EntryKind, str]]
    ) -> None:
        """Replace the album's photos and documents with *entries*, in that
        order. Positions run across both tables so the order is one list."""
        ordered = list(
            dict.fromkeys((kind, str(entry_id)) for kind, entry_id in entries)
        )
        media_ids = await self._validated_media_ids(
            album.organization_id, [i for k, i in ordered if k == "media"]
        )
        await self._validated_document_ids(
            album.organization_id, [i for k, i in ordered if k == "document"]
        )
        await self.db.execute(
            delete(HistoryAlbumItem).where(HistoryAlbumItem.album_id == album.id)
        )
        await self.db.execute(
            delete(HistoryAlbumDocument).where(
                HistoryAlbumDocument.album_id == album.id
            )
        )
        for position, (kind, entry_id) in enumerate(ordered):
            if kind == "media":
                self.db.add(
                    HistoryAlbumItem(
                        album_id=album.id, media_id=entry_id, position=position
                    )
                )
            else:
                self.db.add(
                    HistoryAlbumDocument(
                        album_id=album.id, document_id=entry_id, position=position
                    )
                )
        if album.cover_media_id and album.cover_media_id not in media_ids:
            album.cover_media_id = None
        await self.db.flush()

    async def delete_album(self, album: HistoryAlbum) -> None:
        """An album only groups items: deleting it leaves every item as it is."""
        await self.db.delete(album)
        await self.db.flush()
