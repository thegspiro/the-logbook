"""
History collections: the managed source / donor list, and albums.

Sources are managed like the title list (owner decision): an entry is retired
or merged into another, never deleted while an item points at it.

Albums are draft or shown to members; public album pages arrive with the
public feed. An album lists only the items the viewer may read, so a draft
photo inside a published album stays hidden from members, and a member never
sees a draft album at all.
"""

from typing import Any, Optional

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.history import (
    AlbumLevel,
    HistoryAlbum,
    HistoryAlbumItem,
    HistoryMedia,
    HistorySource,
)
from app.services.history_media_service import HistoryMediaService
from app.services.history_service import Viewer, clean_title_name, title_key


class HistorySourceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_sources(
        self, organization_id: str, *, include_retired: bool
    ) -> list[tuple[HistorySource, int]]:
        usage = (
            select(HistoryMedia.source_id, func.count().label("uses"))
            .where(HistoryMedia.organization_id == str(organization_id))
            .group_by(HistoryMedia.source_id)
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
        """Move every item from *source* to *target*, then remove *source*."""
        if source.id == target.id:
            raise ValueError("Choose a different source to merge into")
        if source.organization_id != target.organization_id:
            raise ValueError("Source not found")
        await self.db.execute(
            update(HistoryMedia)
            .where(
                HistoryMedia.organization_id == source.organization_id,
                HistoryMedia.source_id == source.id,
            )
            .values(source_id=target.id)
            .execution_options(synchronize_session=False)
        )
        await self.db.delete(source)
        await self.db.flush()
        return target


class HistoryAlbumService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.media = HistoryMediaService(db)

    async def list_albums(self, viewer: Viewer) -> list[tuple[HistoryAlbum, int]]:
        """Albums the viewer may see, each with how many of its items they
        may read."""
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
            _, count = await self.media.list_media(viewer, album_id=album.id, limit=1)
            out.append((album, count))
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
        """Replace the album's items with *media_ids*, in that order."""
        wanted = await self._validated_media_ids(album.organization_id, media_ids)
        await self.db.execute(
            delete(HistoryAlbumItem).where(HistoryAlbumItem.album_id == album.id)
        )
        for position, media_id in enumerate(wanted):
            self.db.add(
                HistoryAlbumItem(
                    album_id=album.id, media_id=media_id, position=position
                )
            )
        if album.cover_media_id and album.cover_media_id not in wanted:
            album.cover_media_id = None
        await self.db.flush()

    async def delete_album(self, album: HistoryAlbum) -> None:
        """An album only groups items: deleting it leaves every item as it is."""
        await self.db.delete(album)
        await self.db.flush()
