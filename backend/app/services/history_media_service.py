"""
History media: photos, audio and video, their catalogue, tags and publication.

The same three audiences as the people records, decided by the server:

* the archive's keepers (``history.view`` / ``history.manage`` /
  ``history.publish``) read every item, drafts and research notes included,
  and see each tagged person's photo-use answer;
* every other signed-in member reads items published to members or the
  public, without the research notes or the original file, and sees a tag
  only for a person they may read too;
* the public (phase 7) gets the cleared snapshot.

Stored files are written before the rows that point at them and removed if
those rows are not saved, so a failed upload never leaves a record pointing at
nothing. Deleting an item removes its files only after the database change
commits (the endpoint does that, with the references this service returns).

Every query filters ``organization_id``; every client-sent id is resolved
inside the caller's department before it is stored (CLAUDE.md pitfall #14).
"""

import asyncio
import copy
import hashlib
import os
import uuid
from datetime import date, datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import and_, delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.consent import ConsentType
from app.models.history import (
    DatePrecision,
    HistoricalMember,
    HistoryAlbumItem,
    HistoryClearanceRequest,
    HistoryMedia,
    HistoryMediaFile,
    HistoryMediaTag,
    HistoryRevision,
    HistorySource,
    MediaFileRole,
    MediaKind,
    PublicationLevel,
    RevisionKind,
)
from app.services import file_storage_service as file_storage
from app.services import history_media_files as media_files
from app.services.consent_service import ConsentService
from app.services.file_storage_service import FileStorageService, StorageArea
from app.services.history_service import (
    HistoryService,
    Viewer,
    display_name,
    normalize_partial_date,
)
from app.utils.model_updates import apply_updates
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

RECORD_MEDIA = "media"

AREA = StorageArea.HISTORY_MEDIA

#: Catalogue fields a keeper edits.
CATALOGUE_FIELDS = (
    "title",
    "description",
    "taken_date",
    "taken_date_precision",
    "taken_date_circa",
    "place",
    "creator",
    "source_id",
    "rights_note",
    "accession_number",
    "original_location",
    "research_notes",
)

#: An edit to any of these is substantial whatever the keeper chose: it
#: changes what the item shows or says (spec §6). Tags count as well.
SUBSTANTIAL_FIELDS = frozenset(
    {"title", "description", "taken_date", "taken_date_precision", "taken_date_circa"}
)

_TEXT_FIELDS = (
    "title",
    "description",
    "place",
    "creator",
    "rights_note",
    "accession_number",
    "original_location",
    "research_notes",
)

_READABLE_BY_MEMBERS = (PublicationLevel.MEMBERS, PublicationLevel.PUBLIC)

CONSENT_GRANTED = "granted"
CONSENT_DECLINED = "declined"
CONSENT_NOT_ANSWERED = "not_answered"
CONSENT_NO_ACCOUNT = "no_account"


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def _clean(values: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(values)
    for field in _TEXT_FIELDS:
        if field in cleaned and isinstance(cleaned[field], str):
            cleaned[field] = cleaned[field].strip() or None
    return cleaned


def default_title(filename: Optional[str]) -> str:
    stem = os.path.splitext(os.path.basename(filename or ""))[0].strip()
    return (stem or "Untitled")[:200]


class HistoryMediaService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.history = HistoryService(db)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    @staticmethod
    def _options():
        return (
            selectinload(HistoryMedia.files),
            selectinload(HistoryMedia.tags).selectinload(HistoryMediaTag.member),
            selectinload(HistoryMedia.source),
        )

    async def get_media(
        self, organization_id: str, media_id: str
    ) -> Optional[HistoryMedia]:
        return await self.db.scalar(
            select(HistoryMedia)
            .options(*self._options())
            .where(
                HistoryMedia.id == str(media_id),
                HistoryMedia.organization_id == str(organization_id),
            )
            .execution_options(populate_existing=True)
        )

    @staticmethod
    def can_read(viewer: Viewer, item: HistoryMedia) -> bool:
        return viewer.can_view_archive or item.publication_level in (
            _READABLE_BY_MEMBERS
        )

    async def get_readable_media(
        self, viewer: Viewer, media_id: str
    ) -> Optional[HistoryMedia]:
        item = await self.get_media(viewer.organization_id, media_id)
        if item is None or not self.can_read(viewer, item):
            return None
        return item

    async def list_media(
        self,
        viewer: Viewer,
        *,
        search: Optional[str] = None,
        kind: Optional[MediaKind] = None,
        decade: Optional[int] = None,
        album_id: Optional[str] = None,
        member_id: Optional[str] = None,
        level: Optional[PublicationLevel] = None,
        limit: int = 60,
        offset: int = 0,
    ) -> tuple[list[HistoryMedia], int]:
        conditions = [HistoryMedia.organization_id == viewer.organization_id]
        if not viewer.can_view_archive:
            conditions.append(HistoryMedia.publication_level.in_(_READABLE_BY_MEMBERS))
        elif level is not None:
            conditions.append(HistoryMedia.publication_level == level)
        if kind is not None:
            conditions.append(HistoryMedia.kind == kind)
        if search and search.strip():
            pattern = like_pattern(search.strip())
            conditions.append(
                or_(
                    *(
                        column.ilike(pattern, escape=LIKE_ESCAPE_CHAR)
                        for column in (
                            HistoryMedia.title,
                            HistoryMedia.place,
                            HistoryMedia.creator,
                            HistoryMedia.accession_number,
                        )
                    )
                )
            )
        if decade is not None:
            conditions.append(
                HistoryMedia.taken_date.between(
                    date(decade, 1, 1), date(decade + 9, 12, 31)
                )
            )
        if album_id:
            conditions.append(
                exists(
                    select(HistoryAlbumItem.media_id).where(
                        HistoryAlbumItem.media_id == HistoryMedia.id,
                        HistoryAlbumItem.album_id == str(album_id),
                    )
                )
            )
        if member_id:
            conditions.append(
                exists(
                    select(HistoryMediaTag.media_id).where(
                        HistoryMediaTag.media_id == HistoryMedia.id,
                        HistoryMediaTag.member_id == str(member_id),
                    )
                )
            )
        total = int(
            await self.db.scalar(
                select(func.count()).select_from(HistoryMedia).where(*conditions)
            )
            or 0
        )
        result = await self.db.execute(
            select(HistoryMedia)
            .options(*self._options())
            .where(*conditions)
            .order_by(
                HistoryMedia.taken_date.is_(None),
                HistoryMedia.taken_date,
                HistoryMedia.created_at,
                HistoryMedia.id,
            )
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().unique().all()), total

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @staticmethod
    def file_of(item: HistoryMedia, role: MediaFileRole) -> Optional[HistoryMediaFile]:
        return next((f for f in item.files if f.role == role), None)

    def summary(self, item: HistoryMedia) -> dict[str, Any]:
        return {
            "id": item.id,
            "kind": item.kind,
            "title": item.title,
            "taken_date": item.taken_date,
            "taken_date_precision": item.taken_date_precision,
            "taken_date_circa": item.taken_date_circa,
            "has_thumbnail": self.file_of(item, MediaFileRole.THUMBNAIL) is not None,
            "publication_level": item.publication_level,
        }

    def _catalogue(self, item: HistoryMedia) -> dict[str, Any]:
        source = item.source
        return {
            "id": item.id,
            "kind": item.kind,
            "title": item.title,
            "description": item.description,
            "taken_date": item.taken_date,
            "taken_date_precision": item.taken_date_precision,
            "taken_date_circa": item.taken_date_circa,
            "place": item.place,
            "creator": item.creator,
            "source_id": item.source_id,
            "source_name": source.name if source is not None else None,
            "rights_note": item.rights_note,
            "accession_number": item.accession_number,
            "original_location": item.original_location,
            "width": item.width,
            "height": item.height,
            "has_thumbnail": self.file_of(item, MediaFileRole.THUMBNAIL) is not None,
            "mime_type": self._viewing_mime(item),
            "publication_level": item.publication_level,
        }

    def _viewing_mime(self, item: HistoryMedia) -> Optional[str]:
        role = (
            MediaFileRole.DISPLAY
            if item.kind == MediaKind.PHOTO
            else MediaFileRole.ORIGINAL
        )
        stored = self.file_of(item, role)
        return stored.mime_type if stored else None

    def member_view(self, viewer: Viewer, item: HistoryMedia) -> dict[str, Any]:
        view = self._catalogue(item)
        view["view"] = "member"
        view["tags"] = [
            {"member_id": tag.member_id, "display_name": display_name(tag.member)}
            for tag in sorted(item.tags, key=lambda t: t.member.last_name)
            if self.history.can_read(viewer, tag.member)
        ]
        return view

    async def full_view(
        self,
        viewer: Viewer,
        item: HistoryMedia,
        clearance: Optional[dict[str, Any]],
        *,
        clearance_required: bool,
        cleared_for_public: bool,
    ) -> dict[str, Any]:
        view = self._catalogue(item)
        original = self.file_of(item, MediaFileRole.ORIGINAL)
        states = await self.consent_states(item.organization_id, item.tags)
        view.update(
            {
                "view": "full",
                "research_notes": item.research_notes,
                "original_filename": item.original_filename,
                "original_mime_type": original.mime_type if original else None,
                "original_size_bytes": original.size_bytes if original else None,
                "original_sha256": original.sha256 if original else None,
                "batch_id": item.batch_id,
                "tags": [
                    {
                        "member_id": tag.member_id,
                        "display_name": display_name(tag.member),
                        "consent": states[tag.member_id],
                    }
                    for tag in sorted(item.tags, key=lambda t: t.member.last_name)
                ],
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

    @staticmethod
    def public_changes_pending(item: HistoryMedia) -> bool:
        return (
            item.publication_level == PublicationLevel.PUBLIC
            and (item.public_revision_number or 0) < item.substantial_revision_number
        )

    # ------------------------------------------------------------------
    # Consent
    # ------------------------------------------------------------------

    async def consent_states(
        self, organization_id: str, tags: Iterable[HistoryMediaTag]
    ) -> dict[str, str]:
        """Each tagged person's photo-use answer, read from their linked
        account. Shown to keepers as a warning, never a block (owner
        decision 9): a person with no account has nothing to check."""
        tags = list(tags)
        user_by_member = {
            tag.member_id: tag.member.user_id for tag in tags if tag.member.user_id
        }
        answers = await ConsentService(self.db).answers(
            list(set(user_by_member.values())), ConsentType.PHOTO_USE
        )
        states: dict[str, str] = {}
        for tag in tags:
            user_id = user_by_member.get(tag.member_id)
            if user_id is None:
                states[tag.member_id] = CONSENT_NO_ACCOUNT
            elif user_id not in answers:
                states[tag.member_id] = CONSENT_NOT_ANSWERED
            elif answers[user_id]:
                states[tag.member_id] = CONSENT_GRANTED
            else:
                states[tag.member_id] = CONSENT_DECLINED
        return states

    async def consent_warnings(self, item: HistoryMedia) -> list[str]:
        """The member ids whose answer is anything but granted."""
        states = await self.consent_states(item.organization_id, item.tags)
        return sorted(
            member_id
            for member_id, state in states.items()
            if state in (CONSENT_DECLINED, CONSENT_NOT_ANSWERED)
        )

    # ------------------------------------------------------------------
    # Change history
    # ------------------------------------------------------------------

    def _snapshot(self, item: HistoryMedia) -> dict[str, Any]:
        data: dict[str, Any] = {}
        for field in CATALOGUE_FIELDS:
            value = getattr(item, field)
            data[field] = (
                value.isoformat() if isinstance(value, date) else _enum_value(value)
            )
        data["kind"] = _enum_value(item.kind)
        data["tag_member_ids"] = sorted(tag.member_id for tag in item.tags)
        original = self.file_of(item, MediaFileRole.ORIGINAL)
        data["original_sha256"] = original.sha256 if original else None
        return data

    def _public_snapshot(self, item: HistoryMedia) -> dict[str, Any]:
        """What the public may see: the catalogue without the research notes,
        and a tag only for a person whose own record is public."""
        snapshot = copy.deepcopy(
            {
                key: value
                for key, value in self._snapshot(item).items()
                if key not in ("research_notes", "tag_member_ids", "source_id")
            }
        )
        snapshot["source_name"] = item.source.name if item.source else None
        snapshot["tags"] = sorted(
            display_name(tag.member)
            for tag in item.tags
            if tag.member.publication_level == PublicationLevel.PUBLIC
        )
        return snapshot

    async def _log(
        self,
        item: HistoryMedia,
        kind: RevisionKind,
        actor_id: Optional[str],
        note: Optional[str] = None,
        *,
        with_snapshot: bool = False,
    ) -> None:
        self.db.add(
            HistoryRevision(
                organization_id=item.organization_id,
                record_type=RECORD_MEDIA,
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
        self,
        item: HistoryMedia,
        substantial: bool,
        note: Optional[str],
        actor_id: str,
    ) -> HistoryMedia:
        """The people records' rule (``HistoryService._after_edit``): a
        substantial edit needs clearing again and withdraws a waiting request;
        a minor one reaches the public copy unless substantial changes already
        wait."""
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
                item.organization_id, RECORD_MEDIA, item.id, actor_id
            )
        elif (
            item.publication_level == PublicationLevel.PUBLIC
            and not self.public_changes_pending(item)
        ):
            item.public_snapshot = self._public_snapshot(item)
            item.public_revision_number = item.revision_number
            await self.db.flush()
        return item

    # ------------------------------------------------------------------
    # Writes
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

    async def _validated_member_ids(
        self, organization_id: str, member_ids: Iterable[str]
    ) -> list[str]:
        wanted = list(dict.fromkeys(str(m) for m in member_ids))
        if not wanted:
            return []
        found = set(
            (
                await self.db.execute(
                    select(HistoricalMember.id).where(
                        HistoricalMember.organization_id == str(organization_id),
                        HistoricalMember.id.in_(wanted),
                    )
                )
            ).scalars()
        )
        if len(found) != len(wanted):
            raise ValueError("A tagged person is not in this department's archive")
        return wanted

    async def store_media_upload(
        self,
        organization_id: str,
        *,
        content: bytes,
        filename: Optional[str],
        values: dict[str, Any],
        batch_id: Optional[str],
        actor: Any,
    ) -> tuple[HistoryMedia, list[str]]:
        """Check, scan and store one file, its copies and its catalogue.

        Returns the new item and every stored reference, so the caller can
        remove them if its commit fails. Anything that fails here removes
        what it already stored before raising.
        """
        rules = media_files.rules_for(filename)
        if rules is None:
            raise ValueError(
                "This file type is not accepted. Photos: JPEG, PNG, WebP or TIFF; "
                "audio: MP3, M4A, WAV or FLAC; video: MP4 or WebM"
            )
        values = _clean(values)
        source_id = await self._validated_source_id(
            organization_id, values.pop("source_id", None)
        )
        tag_ids = await self._validated_member_ids(
            organization_id, values.pop("tag_member_ids", None) or []
        )
        media_id = str(uuid.uuid4())
        storage = FileStorageService(self.db)
        written: list[str] = []
        try:
            stored = await storage.store_bytes(
                content,
                original_name=filename,
                organization_id=organization_id,
                area=AREA,
                rules=rules,
                user=actor,
                record_id=media_id,
                upload_kind="history_media",
            )
            written.append(stored.path)
            kind = media_files.kind_for(stored.mime_type, stored.extension)
            files = [
                HistoryMediaFile(
                    media_id=media_id,
                    role=MediaFileRole.ORIGINAL,
                    file_path=stored.path,
                    mime_type=stored.mime_type,
                    size_bytes=stored.size,
                    sha256=stored.sha256,
                )
            ]
            width = height = None
            if kind == MediaKind.PHOTO:
                copies = await asyncio.to_thread(media_files.make_photo_copies, content)
                width, height = copies.width, copies.height
                for role, data in (
                    (MediaFileRole.DISPLAY, copies.display),
                    (MediaFileRole.THUMBNAIL, copies.thumbnail),
                ):
                    path = await file_storage.write_file(
                        organization_id,
                        AREA,
                        media_id,
                        f"{uuid.uuid4().hex}.webp",
                        data,
                        db=self.db,
                    )
                    written.append(path)
                    files.append(
                        HistoryMediaFile(
                            media_id=media_id,
                            role=role,
                            file_path=path,
                            mime_type="image/webp",
                            size_bytes=len(data),
                            sha256=hashlib.sha256(data).hexdigest(),
                        )
                    )
            item = HistoryMedia(
                id=media_id,
                organization_id=str(organization_id),
                kind=kind,
                title=(values.get("title") or default_title(filename))[:200],
                original_filename=stored.original_name[:255],
                width=width,
                height=height,
                batch_id=batch_id,
                source_id=source_id,
                created_by=str(actor.id),
                updated_by=str(actor.id),
                revision_number=1,
                substantial_revision_number=1,
            )
            for field in CATALOGUE_FIELDS:
                if field in ("title", "source_id"):
                    continue
                if values.get(field) is not None:
                    setattr(item, field, values[field])
            item.taken_date = normalize_partial_date(
                item.taken_date, item.taken_date_precision
            )
            self.db.add(item)
            await self.db.flush()
            for stored_file in files:
                self.db.add(stored_file)
            for member_id in tag_ids:
                self.db.add(
                    HistoryMediaTag(
                        media_id=media_id, member_id=member_id, created_by=str(actor.id)
                    )
                )
            await self.db.flush()
            created = await self.get_media(organization_id, media_id)
            if created is None:
                raise ValueError("The new item could not be read back")
            await self._log(
                created, RevisionKind.CREATED, str(actor.id), with_snapshot=True
            )
            return created, written
        except BaseException:
            for path in written:
                await file_storage.delete_quietly(path)
            raise

    async def update(
        self,
        item: HistoryMedia,
        values: dict[str, Any],
        *,
        edit_kind: str,
        edit_note: Optional[str],
        actor_id: str,
    ) -> HistoryMedia:
        values = _clean(values)
        if "title" in values and not values["title"]:
            raise ValueError("Enter a title")
        if "source_id" in values:
            values["source_id"] = await self._validated_source_id(
                item.organization_id, values["source_id"]
            )
        before = {field: getattr(item, field) for field in SUBSTANTIAL_FIELDS}
        apply_updates(
            item,
            {k: v for k, v in values.items() if k in CATALOGUE_FIELDS},
            skip=set(),
        )
        item.taken_date = normalize_partial_date(
            item.taken_date, item.taken_date_precision or DatePrecision.YEAR
        )
        item.updated_by = actor_id
        changed = any(getattr(item, f) != before[f] for f in SUBSTANTIAL_FIELDS)
        await self.db.flush()
        reloaded = await self.get_media(item.organization_id, item.id)
        if reloaded is None:
            raise ValueError("This item could not be read back")
        return await self._after_edit(
            reloaded, edit_kind == "substantial" or changed, edit_note, actor_id
        )

    async def replace_tags(
        self, item: HistoryMedia, member_ids: list[str], actor_id: str
    ) -> HistoryMedia:
        wanted = await self._validated_member_ids(item.organization_id, member_ids)
        current = {tag.member_id for tag in item.tags}
        if set(wanted) == current:
            return item
        stale = [member_id for member_id in current if member_id not in wanted]
        if stale:
            await self.db.execute(
                delete(HistoryMediaTag).where(
                    HistoryMediaTag.media_id == item.id,
                    HistoryMediaTag.member_id.in_(stale),
                )
            )
        for member_id in wanted:
            if member_id not in current:
                self.db.add(
                    HistoryMediaTag(
                        media_id=item.id, member_id=member_id, created_by=actor_id
                    )
                )
        item.updated_by = actor_id
        await self.db.flush()
        reloaded = await self.get_media(item.organization_id, item.id)
        if reloaded is None:
            raise ValueError("This item could not be read back")
        return await self._after_edit(reloaded, True, "Tags changed", actor_id)

    async def delete(self, item: HistoryMedia) -> list[str]:
        """Remove a draft item and its records. Returns the stored references
        for the caller to delete once the change has committed."""
        if item.publication_level != PublicationLevel.DRAFT:
            raise ValueError("Unpublish this item before deleting it")
        refs = [f.file_path for f in item.files]
        for model in (HistoryRevision, HistoryClearanceRequest):
            await self.db.execute(
                delete(model).where(
                    model.organization_id == item.organization_id,
                    model.record_type == RECORD_MEDIA,
                    model.record_id == item.id,
                )
            )
        await self.db.execute(
            delete(HistoryMedia).where(
                HistoryMedia.id == item.id,
                HistoryMedia.organization_id == item.organization_id,
            )
        )
        self.db.expunge(item)
        await self.db.flush()
        return refs

    # ------------------------------------------------------------------
    # Publication
    # ------------------------------------------------------------------

    async def publish(
        self, item: HistoryMedia, level: PublicationLevel, actor_id: str
    ) -> tuple[HistoryMedia, list[str]]:
        """Publish, returning the tagged people whose consent is not granted
        (the warning is recorded with the publication; it never blocks)."""
        from app.services.history_clearance_service import HistoryClearanceService

        if level == PublicationLevel.PUBLIC:
            if (
                item.publication_level == PublicationLevel.PUBLIC
                and not self.public_changes_pending(item)
            ):
                raise ValueError("This item is already public and up to date")
            if not await HistoryClearanceService(self.db).is_cleared(
                item.organization_id,
                RECORD_MEDIA,
                item.id,
                item.substantial_revision_number,
            ):
                raise ValueError(
                    "This item must pass the department's clearance list before "
                    "it is published to the public"
                )
            item.public_snapshot = self._public_snapshot(item)
            item.public_revision_number = item.revision_number
        elif item.publication_level != PublicationLevel.DRAFT:
            raise ValueError("This item is already published to members")
        warnings = await self.consent_warnings(item)
        item.publication_level = level
        item.published_at = datetime.now(timezone.utc)
        item.published_by = actor_id
        await self.db.flush()
        note = f"Published to {level.value}"
        if warnings:
            note += f"; {len(warnings)} tagged person(s) had not granted photo use"
        await self._log(item, RevisionKind.PUBLISHED, actor_id, note)
        return item, warnings

    async def unpublish(
        self, item: HistoryMedia, level: PublicationLevel, actor_id: str
    ) -> HistoryMedia:
        order = [
            PublicationLevel.DRAFT,
            PublicationLevel.MEMBERS,
            PublicationLevel.PUBLIC,
        ]
        if order.index(level) >= order.index(item.publication_level):
            raise ValueError("Choose a level below the item's current one")
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

    # ------------------------------------------------------------------
    # A person's photos
    # ------------------------------------------------------------------

    async def for_person(
        self, viewer: Viewer, person: HistoricalMember, limit: int = 24
    ) -> list[HistoryMedia]:
        items, _ = await self.list_media(viewer, member_id=person.id, limit=limit)
        return items

    async def move_tags(self, from_member_id: str, to_member_id: str) -> None:
        """A person merge's part: the removed person's tags move to the kept
        person, and an item tagged with both keeps one tag."""
        both = set(
            (
                await self.db.execute(
                    select(HistoryMediaTag.media_id).where(
                        HistoryMediaTag.member_id == to_member_id
                    )
                )
            ).scalars()
        )
        if both:
            await self.db.execute(
                delete(HistoryMediaTag).where(
                    and_(
                        HistoryMediaTag.member_id == from_member_id,
                        HistoryMediaTag.media_id.in_(both),
                    )
                )
            )
        result = await self.db.execute(
            select(HistoryMediaTag).where(HistoryMediaTag.member_id == from_member_id)
        )
        for tag in result.scalars().all():
            self.db.add(
                HistoryMediaTag(
                    media_id=tag.media_id,
                    member_id=to_member_id,
                    created_by=tag.created_by,
                )
            )
            await self.db.delete(tag)
        await self.db.flush()
