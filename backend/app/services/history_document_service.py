"""
History documents: letters, minutes, clippings and other papers, their
catalogue, tags and publication.

Phase 1 decided where they live: each document is a row in the Documents
module, filed in the protected History folder (``history.manage`` only), and
its catalogue sits beside it in ``history_documents``. That row holds the
original; everyone else reads the stripped copy in ``history_document_files``
(owner-approved spec, 2026-11-14).

The same three audiences as photos, decided by the server: the archive's
keepers read drafts and research notes; other members read what is published
to members or the public, without research notes or the original; the public
(phase 7) gets the cleared snapshot. Unlike photos there is no consent
warning on tags (owner decision 10: a letter naming someone is not a photo of
them).

Every query filters ``organization_id``; every client-sent id is resolved
inside the caller's department before it is stored (CLAUDE.md pitfall #14).
"""

import asyncio
import copy
import hashlib
import uuid
from datetime import date, datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import and_, delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.document import (
    HISTORY_DOCUMENT_SOURCE_TYPE,
    Document,
    DocumentStatus,
    DocumentType,
)
from app.models.history import (
    DatePrecision,
    DocumentKind,
    HistoricalMember,
    HistoryAlbumDocument,
    HistoryClearanceRequest,
    HistoryDocument,
    HistoryDocumentApparatusTag,
    HistoryDocumentFile,
    HistoryDocumentTag,
    HistoryDocumentType,
    HistoryRevision,
    HistorySource,
    MediaFileRole,
    PublicationLevel,
    RevisionKind,
)
from app.services import file_storage_service as file_storage
from app.services import history_document_files as document_files
from app.services.documents_service import DocumentsService
from app.services.file_storage_service import FileStorageService, StorageArea
from app.services.history_media_service import default_title
from app.services.history_records import (
    apparatus_tag_views,
    public_apparatus_names,
    validated_apparatus_ids,
)
from app.services.history_service import (
    HistoryService,
    Viewer,
    display_name,
    normalize_partial_date,
)
from app.utils.model_updates import apply_updates
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

RECORD_DOCUMENT = "document"

#: Marks a Documents-module row as History's, so the Documents screens treat
#: it as read-only and send people to History to change it.
SOURCE_TYPE = HISTORY_DOCUMENT_SOURCE_TYPE

#: The original goes where every Documents upload goes; the stripped copy and
#: preview go beside the archive's photos.
ORIGINAL_AREA = StorageArea.DOCUMENTS
DERIVED_AREA = StorageArea.HISTORY_MEDIA

CATALOGUE_FIELDS = (
    "title",
    "description",
    "taken_date",
    "taken_date_precision",
    "taken_date_circa",
    "place",
    "document_type_id",
    "author",
    "recipient",
    "source_id",
    "rights_note",
    "accession_number",
    "original_location",
    "research_notes",
    "transcription",
)

#: An edit to any of these is substantial whatever the keeper chose: it
#: changes what the document shows or says. Tags count as well.
SUBSTANTIAL_FIELDS = frozenset(
    {
        "title",
        "description",
        "taken_date",
        "taken_date_precision",
        "taken_date_circa",
        "author",
        "recipient",
        "transcription",
    }
)

_TEXT_FIELDS = (
    "title",
    "description",
    "place",
    "author",
    "recipient",
    "rights_note",
    "accession_number",
    "original_location",
    "research_notes",
    "transcription",
)

#: Searched by the documents list (owner decision 9: everything searchable).
#: Research notes are encrypted, so they are not among them.
_SEARCHED = (
    HistoryDocument.title,
    HistoryDocument.description,
    HistoryDocument.place,
    HistoryDocument.author,
    HistoryDocument.recipient,
    HistoryDocument.accession_number,
    HistoryDocument.transcription,
    HistoryDocument.extracted_text,
)

_READABLE_BY_MEMBERS = (PublicationLevel.MEMBERS, PublicationLevel.PUBLIC)

#: A department's starting list of document types, created the first time it
#: reads the list.
DEFAULT_DOCUMENT_TYPES = (
    "Letter",
    "Minutes",
    "Newspaper clipping",
    "Certificate",
    "Programme",
    "Report",
    "Other",
)


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def _clean(values: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(values)
    for field in _TEXT_FIELDS:
        if field in cleaned and isinstance(cleaned[field], str):
            cleaned[field] = cleaned[field].strip() or None
    return cleaned


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class HistoryDocumentService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.history = HistoryService(db)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    @staticmethod
    def _options():
        return (
            selectinload(HistoryDocument.files),
            selectinload(HistoryDocument.tags).selectinload(HistoryDocumentTag.member),
            selectinload(HistoryDocument.source),
            selectinload(HistoryDocument.document_type),
            selectinload(HistoryDocument.document),
            selectinload(HistoryDocument.apparatus_tags).selectinload(
                HistoryDocumentApparatusTag.apparatus
            ),
        )

    async def get_document(
        self, organization_id: str, document_id: str
    ) -> Optional[HistoryDocument]:
        return await self.db.scalar(
            select(HistoryDocument)
            .options(*self._options())
            .where(
                HistoryDocument.document_id == str(document_id),
                HistoryDocument.organization_id == str(organization_id),
            )
            .execution_options(populate_existing=True)
        )

    @staticmethod
    def can_read(viewer: Viewer, item: HistoryDocument) -> bool:
        return viewer.can_view_archive or item.publication_level in (
            _READABLE_BY_MEMBERS
        )

    async def get_readable_document(
        self, viewer: Viewer, document_id: str
    ) -> Optional[HistoryDocument]:
        item = await self.get_document(viewer.organization_id, document_id)
        if item is None or not self.can_read(viewer, item):
            return None
        return item

    async def list_documents(
        self,
        viewer: Viewer,
        *,
        search: Optional[str] = None,
        document_type_id: Optional[str] = None,
        decade: Optional[int] = None,
        album_id: Optional[str] = None,
        member_id: Optional[str] = None,
        apparatus_id: Optional[str] = None,
        level: Optional[PublicationLevel] = None,
        limit: int = 60,
        offset: int = 0,
    ) -> tuple[list[HistoryDocument], int]:
        conditions = [HistoryDocument.organization_id == viewer.organization_id]
        if not viewer.can_view_archive:
            conditions.append(
                HistoryDocument.publication_level.in_(_READABLE_BY_MEMBERS)
            )
        elif level is not None:
            conditions.append(HistoryDocument.publication_level == level)
        if document_type_id:
            conditions.append(HistoryDocument.document_type_id == str(document_type_id))
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
            conditions.append(
                HistoryDocument.taken_date.between(
                    date(decade, 1, 1), date(decade + 9, 12, 31)
                )
            )
        if album_id:
            conditions.append(
                exists(
                    select(HistoryAlbumDocument.document_id).where(
                        HistoryAlbumDocument.document_id == HistoryDocument.document_id,
                        HistoryAlbumDocument.album_id == str(album_id),
                    )
                )
            )
        if member_id:
            conditions.append(
                exists(
                    select(HistoryDocumentTag.document_id).where(
                        HistoryDocumentTag.document_id == HistoryDocument.document_id,
                        HistoryDocumentTag.member_id == str(member_id),
                    )
                )
            )
        if apparatus_id:
            conditions.append(
                exists(
                    select(HistoryDocumentApparatusTag.document_id).where(
                        HistoryDocumentApparatusTag.document_id
                        == HistoryDocument.document_id,
                        HistoryDocumentApparatusTag.apparatus_id == str(apparatus_id),
                    )
                )
            )
        total = int(
            await self.db.scalar(
                select(func.count()).select_from(HistoryDocument).where(*conditions)
            )
            or 0
        )
        result = await self.db.execute(
            select(HistoryDocument)
            .options(*self._options())
            .where(*conditions)
            .order_by(
                HistoryDocument.taken_date.is_(None),
                HistoryDocument.taken_date,
                HistoryDocument.created_at,
                HistoryDocument.document_id,
            )
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().unique().all()), total

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @staticmethod
    def file_of(
        item: HistoryDocument, role: MediaFileRole
    ) -> Optional[HistoryDocumentFile]:
        return next((f for f in item.files if f.role == role), None)

    def summary(self, item: HistoryDocument) -> dict[str, Any]:
        return {
            "id": item.document_id,
            "kind": item.kind,
            "title": item.title,
            "taken_date": item.taken_date,
            "taken_date_precision": item.taken_date_precision,
            "taken_date_circa": item.taken_date_circa,
            "document_type_name": (
                item.document_type.name if item.document_type is not None else None
            ),
            "page_count": item.page_count,
            "has_thumbnail": self.file_of(item, MediaFileRole.THUMBNAIL) is not None,
            "publication_level": item.publication_level,
        }

    def _catalogue(self, item: HistoryDocument) -> dict[str, Any]:
        display = self.file_of(item, MediaFileRole.DISPLAY)
        return {
            "id": item.document_id,
            "kind": item.kind,
            "title": item.title,
            "description": item.description,
            "taken_date": item.taken_date,
            "taken_date_precision": item.taken_date_precision,
            "taken_date_circa": item.taken_date_circa,
            "place": item.place,
            "document_type_id": item.document_type_id,
            "document_type_name": (
                item.document_type.name if item.document_type is not None else None
            ),
            "author": item.author,
            "recipient": item.recipient,
            "source_id": item.source_id,
            "source_name": item.source.name if item.source is not None else None,
            "rights_note": item.rights_note,
            "accession_number": item.accession_number,
            "original_location": item.original_location,
            "transcription": item.transcription,
            "text_truncated": item.text_truncated,
            "page_count": item.page_count,
            "width": item.width,
            "height": item.height,
            "has_thumbnail": self.file_of(item, MediaFileRole.THUMBNAIL) is not None,
            "mime_type": display.mime_type if display else None,
            "publication_level": item.publication_level,
        }

    def member_view(self, viewer: Viewer, item: HistoryDocument) -> dict[str, Any]:
        view = self._catalogue(item)
        view["view"] = "member"
        view["tags"] = [
            {"member_id": tag.member_id, "display_name": display_name(tag.member)}
            for tag in sorted(item.tags, key=lambda t: t.member.last_name)
            if self.history.can_read(viewer, tag.member)
        ]
        view["apparatus"] = apparatus_tag_views(
            viewer.can_view_archive, (tag.apparatus for tag in item.apparatus_tags)
        )
        return view

    def full_view(
        self,
        viewer: Viewer,
        item: HistoryDocument,
        clearance: Optional[dict[str, Any]],
        *,
        clearance_required: bool,
        cleared_for_public: bool,
    ) -> dict[str, Any]:
        view = self._catalogue(item)
        original = item.document
        view.update(
            {
                "view": "full",
                "research_notes": item.research_notes,
                "original_filename": item.original_filename,
                "original_mime_type": original.file_type if original else None,
                "original_size_bytes": original.file_size if original else None,
                "batch_id": item.batch_id,
                "tags": [
                    {
                        "member_id": tag.member_id,
                        "display_name": display_name(tag.member),
                    }
                    for tag in sorted(item.tags, key=lambda t: t.member.last_name)
                ],
                "apparatus": apparatus_tag_views(
                    True, (tag.apparatus for tag in item.apparatus_tags)
                ),
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
    def public_changes_pending(item: HistoryDocument) -> bool:
        return (
            item.publication_level == PublicationLevel.PUBLIC
            and (item.public_revision_number or 0) < item.substantial_revision_number
        )

    # ------------------------------------------------------------------
    # Change history
    # ------------------------------------------------------------------

    def _snapshot(self, item: HistoryDocument) -> dict[str, Any]:
        data: dict[str, Any] = {}
        for field in CATALOGUE_FIELDS:
            value = getattr(item, field)
            data[field] = (
                value.isoformat() if isinstance(value, date) else _enum_value(value)
            )
        data["kind"] = _enum_value(item.kind)
        data["tag_member_ids"] = sorted(tag.member_id for tag in item.tags)
        data["tag_apparatus_ids"] = sorted(
            tag.apparatus_id for tag in item.apparatus_tags
        )
        display = self.file_of(item, MediaFileRole.DISPLAY)
        data["display_sha256"] = display.sha256 if display else None
        return data

    def _public_snapshot(self, item: HistoryDocument) -> dict[str, Any]:
        """What the public may see: the catalogue without the research notes,
        and a tag only for a person whose own record is public."""
        snapshot = copy.deepcopy(
            {
                key: value
                for key, value in self._snapshot(item).items()
                if key
                not in (
                    "research_notes",
                    "tag_member_ids",
                    "tag_apparatus_ids",
                    "source_id",
                    "document_type_id",
                )
            }
        )
        snapshot["source_name"] = item.source.name if item.source else None
        snapshot["document_type_name"] = (
            item.document_type.name if item.document_type else None
        )
        snapshot["tags"] = sorted(
            display_name(tag.member)
            for tag in item.tags
            if tag.member.publication_level == PublicationLevel.PUBLIC
        )
        snapshot["apparatus"] = public_apparatus_names(
            tag.apparatus for tag in item.apparatus_tags
        )
        return snapshot

    async def _log(
        self,
        item: HistoryDocument,
        kind: RevisionKind,
        actor_id: Optional[str],
        note: Optional[str] = None,
        *,
        with_snapshot: bool = False,
    ) -> None:
        self.db.add(
            HistoryRevision(
                organization_id=item.organization_id,
                record_type=RECORD_DOCUMENT,
                record_id=item.document_id,
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
        item: HistoryDocument,
        substantial: bool,
        note: Optional[str],
        actor_id: str,
    ) -> HistoryDocument:
        """The people records' rule: a substantial edit needs clearing again
        and withdraws a waiting request; a minor one reaches the public copy
        unless substantial changes already wait."""
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
                item.organization_id, RECORD_DOCUMENT, item.document_id, actor_id
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

    async def _validated_type_id(
        self, organization_id: str, type_id: Optional[str]
    ) -> Optional[str]:
        if not type_id:
            return None
        found = await self.db.scalar(
            select(HistoryDocumentType.id).where(
                HistoryDocumentType.id == str(type_id),
                HistoryDocumentType.organization_id == str(organization_id),
            )
        )
        if found is None:
            raise ValueError("That document type is not on this department's list")
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

    # ------------------------------------------------------------------
    # Upload
    # ------------------------------------------------------------------

    async def store_document_upload(
        self,
        organization_id: str,
        *,
        content: bytes,
        filename: Optional[str],
        values: dict[str, Any],
        batch_id: Optional[str],
        actor: Any,
    ) -> tuple[HistoryDocument, list[str]]:
        """Check, scan and store one document, its copies and its catalogue.

        Returns the new item and every stored reference, so the caller can
        remove them if its commit fails. Anything that fails here removes
        what it already stored before raising.
        """
        if not document_files.accepts(filename):
            raise ValueError(
                "This file type is not accepted. Documents: PDF, JPEG, PNG or WebP. "
                "Convert Word and other files to PDF first"
            )
        values = _clean(values)
        source_id = await self._validated_source_id(
            organization_id, values.pop("source_id", None)
        )
        type_id = await self._validated_type_id(
            organization_id, values.pop("document_type_id", None)
        )
        tag_ids = await self._validated_member_ids(
            organization_id, values.pop("tag_member_ids", None) or []
        )
        folder = await DocumentsService(self.db).ensure_history_folder(organization_id)
        document_id = str(uuid.uuid4())
        written: list[str] = []
        try:
            stored = await FileStorageService(self.db).store_bytes(
                content,
                original_name=filename,
                organization_id=organization_id,
                area=ORIGINAL_AREA,
                rules=document_files.DOCUMENT_RULES,
                user=actor,
                record_id=document_id,
                upload_kind="history_document",
            )
            written.append(stored.path)
            kind = (
                DocumentKind.PDF
                if document_files.is_pdf(stored.mime_type)
                else DocumentKind.IMAGE
            )
            derived: list[tuple[MediaFileRole, bytes, str, str]] = []
            page_count = width = height = None
            text: Optional[str] = None
            truncated = False
            if kind == DocumentKind.PDF:
                pdf = await asyncio.to_thread(document_files.make_pdf_copies, content)
                page_count = pdf.page_count
                text = pdf.text or None
                truncated = pdf.text_truncated
                derived.append(
                    (MediaFileRole.DISPLAY, pdf.cleaned, ".pdf", "application/pdf")
                )
                if pdf.preview is not None:
                    derived.append(
                        (MediaFileRole.THUMBNAIL, pdf.preview, ".webp", "image/webp")
                    )
            else:
                scan = await asyncio.to_thread(document_files.make_scan_copies, content)
                width, height, page_count = scan.width, scan.height, 1
                derived = [
                    (MediaFileRole.DISPLAY, scan.display, ".webp", "image/webp"),
                    (MediaFileRole.THUMBNAIL, scan.thumbnail, ".webp", "image/webp"),
                ]
            files: list[HistoryDocumentFile] = []
            for role, data, extension, mime_type in derived:
                path = await file_storage.write_file(
                    organization_id,
                    DERIVED_AREA,
                    document_id,
                    f"{uuid.uuid4().hex}{extension}",
                    data,
                    db=self.db,
                )
                written.append(path)
                files.append(
                    HistoryDocumentFile(
                        document_id=document_id,
                        role=role,
                        file_path=path,
                        mime_type=mime_type,
                        size_bytes=len(data),
                        sha256=_sha(data),
                    )
                )
            title = (values.get("title") or default_title(filename))[:200]
            self.db.add(
                Document(
                    id=document_id,
                    organization_id=str(organization_id),
                    folder_id=str(folder.id),
                    name=title[:255],
                    file_name=stored.original_name,
                    file_path=stored.path,
                    file_size=stored.size,
                    file_type=stored.mime_type,
                    document_type=DocumentType.UPLOADED,
                    status=DocumentStatus.ACTIVE,
                    source_type=SOURCE_TYPE,
                    source_id=document_id,
                    uploaded_by=str(actor.id),
                )
            )
            await self.db.flush()
            item = HistoryDocument(
                document_id=document_id,
                organization_id=str(organization_id),
                kind=kind,
                title=title,
                original_filename=stored.original_name[:255],
                page_count=page_count,
                width=width,
                height=height,
                extracted_text=text,
                text_truncated=truncated,
                batch_id=batch_id,
                source_id=source_id,
                document_type_id=type_id,
                created_by=str(actor.id),
                updated_by=str(actor.id),
                revision_number=1,
                substantial_revision_number=1,
            )
            for field in CATALOGUE_FIELDS:
                if field in ("title", "source_id", "document_type_id"):
                    continue
                if values.get(field) is not None:
                    setattr(item, field, values[field])
            item.taken_date = normalize_partial_date(
                item.taken_date, item.taken_date_precision or DatePrecision.YEAR
            )
            self.db.add(item)
            await self.db.flush()
            for stored_file in files:
                self.db.add(stored_file)
            for member_id in tag_ids:
                self.db.add(
                    HistoryDocumentTag(
                        document_id=document_id,
                        member_id=member_id,
                        created_by=str(actor.id),
                    )
                )
            await self.db.flush()
            created = await self.get_document(organization_id, document_id)
            if created is None:
                raise ValueError("The new document could not be read back")
            await self._log(
                created, RevisionKind.CREATED, str(actor.id), with_snapshot=True
            )
            return created, written
        except BaseException:
            for path in written:
                await file_storage.delete_quietly(path)
            raise

    # ------------------------------------------------------------------
    # Edits
    # ------------------------------------------------------------------

    async def update(
        self,
        item: HistoryDocument,
        values: dict[str, Any],
        *,
        edit_kind: str,
        edit_note: Optional[str],
        actor_id: str,
    ) -> HistoryDocument:
        values = _clean(values)
        if "title" in values and not values["title"]:
            raise ValueError("Enter a title")
        if "source_id" in values:
            values["source_id"] = await self._validated_source_id(
                item.organization_id, values["source_id"]
            )
        if "document_type_id" in values:
            values["document_type_id"] = await self._validated_type_id(
                item.organization_id, values["document_type_id"]
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
        # The Documents module lists the file under its catalogue title.
        if item.document is not None:
            item.document.name = item.title[:255]
        changed = any(getattr(item, f) != before[f] for f in SUBSTANTIAL_FIELDS)
        await self.db.flush()
        reloaded = await self.get_document(item.organization_id, item.document_id)
        if reloaded is None:
            raise ValueError("This document could not be read back")
        return await self._after_edit(
            reloaded, edit_kind == "substantial" or changed, edit_note, actor_id
        )

    async def replace_tags(
        self, item: HistoryDocument, member_ids: list[str], actor_id: str
    ) -> HistoryDocument:
        wanted = await self._validated_member_ids(item.organization_id, member_ids)
        current = {tag.member_id for tag in item.tags}
        if set(wanted) == current:
            return item
        stale = [member_id for member_id in current if member_id not in wanted]
        if stale:
            await self.db.execute(
                delete(HistoryDocumentTag).where(
                    HistoryDocumentTag.document_id == item.document_id,
                    HistoryDocumentTag.member_id.in_(stale),
                )
            )
        for member_id in wanted:
            if member_id not in current:
                self.db.add(
                    HistoryDocumentTag(
                        document_id=item.document_id,
                        member_id=member_id,
                        created_by=actor_id,
                    )
                )
        item.updated_by = actor_id
        await self.db.flush()
        reloaded = await self.get_document(item.organization_id, item.document_id)
        if reloaded is None:
            raise ValueError("This document could not be read back")
        return await self._after_edit(reloaded, True, "Tags changed", actor_id)

    async def replace_apparatus_tags(
        self, item: HistoryDocument, apparatus_ids: list[str], actor_id: str
    ) -> HistoryDocument:
        """Set the apparatus a document concerns. A change is substantial, as
        a change of people is."""
        wanted = await validated_apparatus_ids(
            self.db, item.organization_id, apparatus_ids
        )
        current = {tag.apparatus_id for tag in item.apparatus_tags}
        if set(wanted) == current:
            return item
        stale = [apparatus_id for apparatus_id in current if apparatus_id not in wanted]
        if stale:
            await self.db.execute(
                delete(HistoryDocumentApparatusTag).where(
                    HistoryDocumentApparatusTag.document_id == item.document_id,
                    HistoryDocumentApparatusTag.apparatus_id.in_(stale),
                )
            )
        for apparatus_id in wanted:
            if apparatus_id not in current:
                self.db.add(
                    HistoryDocumentApparatusTag(
                        document_id=item.document_id,
                        apparatus_id=apparatus_id,
                        created_by=actor_id,
                    )
                )
        item.updated_by = actor_id
        await self.db.flush()
        reloaded = await self.get_document(item.organization_id, item.document_id)
        if reloaded is None:
            raise ValueError("This document could not be read back")
        return await self._after_edit(
            reloaded, True, "Apparatus tags changed", actor_id
        )

    async def delete(self, item: HistoryDocument) -> list[str]:
        """Remove a draft document, its Documents row and its records.
        Returns the stored references for the caller to delete once the
        change has committed."""
        if item.publication_level != PublicationLevel.DRAFT:
            raise ValueError("Unpublish this document before deleting it")
        refs = [f.file_path for f in item.files]
        if item.document is not None and item.document.file_path:
            refs.append(item.document.file_path)
        for model in (HistoryRevision, HistoryClearanceRequest):
            await self.db.execute(
                delete(model).where(
                    model.organization_id == item.organization_id,
                    model.record_type == RECORD_DOCUMENT,
                    model.record_id == item.document_id,
                )
            )
        # The catalogue, its files, tags and album places follow by cascade.
        await self.db.execute(
            delete(Document).where(
                Document.id == item.document_id,
                Document.organization_id == item.organization_id,
            )
        )
        self.db.expunge(item)
        await self.db.flush()
        return refs

    # ------------------------------------------------------------------
    # Publication
    # ------------------------------------------------------------------

    async def publish(
        self, item: HistoryDocument, level: PublicationLevel, actor_id: str
    ) -> HistoryDocument:
        from app.services.history_clearance_service import HistoryClearanceService

        if level == PublicationLevel.PUBLIC:
            if (
                item.publication_level == PublicationLevel.PUBLIC
                and not self.public_changes_pending(item)
            ):
                raise ValueError("This document is already public and up to date")
            if not await HistoryClearanceService(self.db).is_cleared(
                item.organization_id,
                RECORD_DOCUMENT,
                item.document_id,
                item.substantial_revision_number,
            ):
                raise ValueError(
                    "This document must pass the department's clearance list "
                    "before it is published to the public"
                )
            item.public_snapshot = self._public_snapshot(item)
            item.public_revision_number = item.revision_number
        elif item.publication_level != PublicationLevel.DRAFT:
            raise ValueError("This document is already published to members")
        item.publication_level = level
        item.published_at = datetime.now(timezone.utc)
        item.published_by = actor_id
        await self.db.flush()
        await self._log(
            item, RevisionKind.PUBLISHED, actor_id, f"Published to {level.value}"
        )
        return item

    async def unpublish(
        self, item: HistoryDocument, level: PublicationLevel, actor_id: str
    ) -> HistoryDocument:
        order = [
            PublicationLevel.DRAFT,
            PublicationLevel.MEMBERS,
            PublicationLevel.PUBLIC,
        ]
        if order.index(level) >= order.index(item.publication_level):
            raise ValueError("Choose a level below the document's current one")
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
    # A person's documents
    # ------------------------------------------------------------------

    async def for_person(
        self, viewer: Viewer, person: HistoricalMember, limit: int = 24
    ) -> list[HistoryDocument]:
        items, _ = await self.list_documents(viewer, member_id=person.id, limit=limit)
        return items

    async def move_tags(self, from_member_id: str, to_member_id: str) -> None:
        """A person merge's part: the removed person's tags move to the kept
        person, and a document tagged with both keeps one tag."""
        both = set(
            (
                await self.db.execute(
                    select(HistoryDocumentTag.document_id).where(
                        HistoryDocumentTag.member_id == to_member_id
                    )
                )
            ).scalars()
        )
        if both:
            await self.db.execute(
                delete(HistoryDocumentTag).where(
                    and_(
                        HistoryDocumentTag.member_id == from_member_id,
                        HistoryDocumentTag.document_id.in_(both),
                    )
                )
            )
        result = await self.db.execute(
            select(HistoryDocumentTag).where(
                HistoryDocumentTag.member_id == from_member_id
            )
        )
        for tag in result.scalars().all():
            self.db.add(
                HistoryDocumentTag(
                    document_id=tag.document_id,
                    member_id=to_member_id,
                    created_by=tag.created_by,
                )
            )
            await self.db.delete(tag)
        await self.db.flush()
