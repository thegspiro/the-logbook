"""
History documents and document types (``/api/v1/history``, gated on the
module).

Who receives what is decided by the server, as for photos: members read
published documents without research notes or the original; the archive's
keepers read everything; ``history.manage`` alone downloads an original.
``/view`` serves the stripped copy (a PDF rebuilt without metadata, scripts,
actions or attachments, or a scan's WebP), inline, so a PDF opens in the
browser's own viewer in its own tab; ``/original`` is always an attachment.
Every file goes through an endpoint here that checks the document is readable
to the caller first, so a stored file is never reachable by its path.

Audit entries carry ids, never titles, file names or people's names.
"""

import json
import os
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.history import (
    HistoryDocument,
    HistoryDocumentType,
    MediaFileRole,
    PublicationLevel,
)
from app.models.user import User
from app.schemas.history import (
    ApparatusTagsReplace,
    DocumentFullView,
    DocumentList,
    DocumentMemberView,
    DocumentSummary,
    DocumentTagsReplace,
    DocumentUpdate,
    DocumentUploadFields,
    DocumentView,
    EventSummary,
    HistoryDocumentTypeCreate,
    HistoryDocumentTypeMerge,
    HistoryDocumentTypeResponse,
    HistoryDocumentTypeUpdate,
    PublishRequest,
    RevisionResponse,
    UnpublishRequest,
)
from app.services import file_storage_service as file_storage
from app.services import history_document_files as document_files
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_collection_service import HistoryDocumentTypeService
from app.services.history_document_service import (
    DERIVED_AREA,
    ORIGINAL_AREA,
    RECORD_DOCUMENT,
    HistoryDocumentService,
)
from app.services.history_event_service import HistoryEventService
from app.services.history_service import HistoryService, Viewer
from app.utils.upload_limits import read_upload_limited

router = APIRouter()

_DOCUMENT = "Document"
_TYPE = "Document type"


async def _audit(db: AsyncSession, user: User, event_type: str, data: dict) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="history",
        severity="info",
        event_data={"organization_id": str(user.organization_id), **data},
        user_id=str(user.id),
        username=user.username,
    )


async def _managed_document(
    db: AsyncSession, user: User, document_id: str
) -> HistoryDocument:
    return ensure_found(
        await HistoryDocumentService(db).get_document(
            str(user.organization_id), document_id
        ),
        _DOCUMENT,
    )


async def _full_view(
    db: AsyncSession, viewer: Viewer, item: HistoryDocument
) -> DocumentFullView:
    service = HistoryDocumentService(db)
    clearance = HistoryClearanceService(db)
    latest = await clearance.latest_request(
        viewer.organization_id, RECORD_DOCUMENT, item.document_id
    )
    clearance_view = (
        await clearance.request_view(
            latest, record_label=item.title, viewer_id=viewer.user_id
        )
        if latest
        else None
    )
    return DocumentFullView(
        **service.full_view(
            viewer,
            item,
            clearance_view,
            clearance_required=bool(await clearance.list_steps(viewer.organization_id)),
            cleared_for_public=await clearance.is_cleared(
                viewer.organization_id,
                RECORD_DOCUMENT,
                item.document_id,
                item.substantial_revision_number,
            ),
        ),
        events=await _events_of(db, viewer, item),
    )


async def _events_of(
    db: AsyncSession, viewer: Viewer, item: HistoryDocument
) -> list[EventSummary]:
    service = HistoryEventService(db)
    return [
        EventSummary(**service.summary(event))
        for event in await service.related(viewer, document_id=item.document_id)
    ]


async def _document_view(
    db: AsyncSession, viewer: Viewer, item: HistoryDocument
) -> DocumentView:
    if viewer.can_view_archive:
        return await _full_view(db, viewer, item)
    return DocumentMemberView(
        **HistoryDocumentService(db).member_view(viewer, item),
        events=await _events_of(db, viewer, item),
    )


async def _reloaded_full(
    db: AsyncSession, user: User, document_id: str
) -> DocumentFullView:
    # Re-read after every write: on MySQL the database-set timestamps are not
    # returned with an INSERT or UPDATE, and reading them unloaded from an
    # async session raises MissingGreenlet.
    item = await _managed_document(db, user, document_id)
    return await _full_view(db, Viewer.of(user), item)


# ----------------------------------------------------------------------
# Documents
# ----------------------------------------------------------------------


@router.get("/documents", response_model=DocumentList)
async def list_documents(
    search: Optional[str] = Query(None, max_length=100),
    document_type_id: Optional[str] = Query(None, max_length=36),
    decade: Optional[int] = Query(None, ge=1700, le=2100),
    album_id: Optional[str] = Query(None, max_length=36),
    member_id: Optional[str] = Query(None, max_length=36),
    apparatus_id: Optional[str] = Query(None, max_length=36),
    level: Optional[PublicationLevel] = None,
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The archive's documents. ``apparatus_id`` lists what an apparatus is
    tagged in. Search covers the title, description, place,
    author, recipient, accession number, transcription and the text a PDF
    carries. Members see what is published to members or the public; the
    archive's keepers also see drafts and may filter by publication level.

    **Authentication required**
    """
    if decade is not None and decade % 10:
        raise HTTPException(status_code=400, detail="A decade starts on a 0 year")
    service = HistoryDocumentService(db)
    items, total = await service.list_documents(
        Viewer.of(current_user),
        search=search,
        document_type_id=document_type_id,
        decade=decade,
        album_id=album_id,
        member_id=member_id,
        apparatus_id=apparatus_id,
        level=level,
        limit=limit,
        offset=offset,
    )
    return DocumentList(
        items=[DocumentSummary(**service.summary(i)) for i in items], total=total
    )


@router.post("/documents", response_model=DocumentFullView, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    catalogue: str = Form("{}", max_length=2_100_000),
    batch_id: Optional[str] = Form(None, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add one document, as a draft, with its catalogue (a JSON object of the
    catalogue fields and ``tag_member_ids``). A batch sends each file in its
    own request with the same ``batch_id``.

    **Requires permission: history.manage**
    """
    try:
        fields = DocumentUploadFields.model_validate(json.loads(catalogue or "{}"))
    except (ValueError, ValidationError):
        raise HTTPException(
            status_code=422, detail="The catalogue fields are not valid"
        )
    limit = document_files.DOCUMENT_MAX_BYTES
    try:
        content = await read_upload_limited(file, limit)
    except ValueError:
        raise HTTPException(
            status_code=413,
            detail=f"The file is over the {limit // document_files.MB} MB limit",
        )
    service = HistoryDocumentService(db)
    written: list[str] = []
    async with handle_service_errors("Could not add this document"):
        try:
            item, written = await service.store_document_upload(
                str(current_user.organization_id),
                content=content,
                filename=file.filename,
                values=fields.model_dump(exclude_unset=True),
                batch_id=batch_id,
                actor=current_user,
            )
        except document_files.UnreadableMedia as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        await db.commit()
    except BaseException:
        for path in written:
            await file_storage.delete_quietly(path)
        raise
    await _audit(
        db,
        current_user,
        "history_document_uploaded",
        {
            "document_id": item.document_id,
            "kind": item.kind.value,
            "batch_id": batch_id,
        },
    )
    return await _reloaded_full(db, current_user, item.document_id)


@router.get("/documents/{document_id}", response_model=DocumentView)
async def get_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One document. Members receive the published view; the archive's keepers
    receive every field.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    item = ensure_found(
        await HistoryDocumentService(db).get_readable_document(viewer, document_id),
        _DOCUMENT,
    )
    return await _document_view(db, viewer, item)


def _file_headers(response: Response) -> Response:
    # A browser may keep a copy for itself, never a shared cache: the document
    # can be unpublished, and the file then stops being readable to members.
    response.headers["cache-control"] = "private, max-age=300"
    response.headers["x-content-type-options"] = "nosniff"
    return response


async def _serve_derived(
    db: AsyncSession,
    request: Request,
    user: User,
    document_id: str,
    role: MediaFileRole,
) -> Response:
    viewer = Viewer.of(user)
    service = HistoryDocumentService(db)
    item = ensure_found(
        await service.get_readable_document(viewer, document_id), _DOCUMENT
    )
    stored = service.file_of(item, role)
    if stored is None:
        raise HTTPException(status_code=404, detail="File not found")
    ref = file_storage.resolve(stored.file_path, item.organization_id, DERIVED_AREA)
    if ref is None:
        raise HTTPException(status_code=404, detail="File not found")
    # Named for the document, not the uploader's file, so the name says no
    # more than the reader may already see.
    extension = os.path.splitext(stored.file_path)[1].lower()
    response = await file_storage.file_range_response(
        ref,
        range_header=request.headers.get("range"),
        filename=f"{item.document_id}-{role.value}{extension}",
        media_type=stored.mime_type,
        content_disposition_type="inline",
    )
    return _file_headers(response)


@router.get("/documents/{document_id}/thumbnail")
async def document_thumbnail(
    document_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    A 400 px WebP preview with no metadata: a PDF's first page, or a scan.

    **Authentication required**
    """
    return await _serve_derived(
        db, request, current_user, document_id, MediaFileRole.THUMBNAIL
    )


@router.get("/documents/{document_id}/view")
async def document_view_file(
    document_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    What a reader opens: the PDF rebuilt without metadata, scripts, actions
    or attachments, or a scan's WebP copy. Never the original. Inline, so a
    PDF opens in the browser's viewer; answers ``Range`` requests.

    **Authentication required**
    """
    return await _serve_derived(
        db, request, current_user, document_id, MediaFileRole.DISPLAY
    )


@router.get("/documents/{document_id}/original")
async def document_original(
    document_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    The original file exactly as uploaded, metadata included, as a download.

    **Requires permission: history.manage**
    """
    item = await _managed_document(db, current_user, document_id)
    original = item.document
    if original is None or not original.file_path:
        raise HTTPException(status_code=404, detail="File not found")
    ref = file_storage.resolve(original.file_path, item.organization_id, ORIGINAL_AREA)
    if ref is None:
        raise HTTPException(status_code=404, detail="File not found")
    response = await file_storage.file_range_response(
        ref,
        range_header=request.headers.get("range"),
        filename=item.original_filename or item.document_id,
        media_type=original.file_type or "application/octet-stream",
        content_disposition_type="attachment",
    )
    return _file_headers(response)


@router.patch("/documents/{document_id}", response_model=DocumentFullView)
async def update_document(
    document_id: str,
    payload: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Edit the catalogue. A change to the title, description, date, author,
    recipient or transcription is recorded as substantial whatever was
    chosen, so a public document keeps its cleared version until the change
    is cleared.

    **Requires permission: history.manage**
    """
    item = await _managed_document(db, current_user, document_id)
    values = payload.model_dump(exclude_unset=True)
    edit_kind = values.pop("edit_kind", "minor")
    edit_note = values.pop("edit_note", None)
    async with handle_service_errors("Could not save this document"):
        await HistoryDocumentService(db).update(
            item,
            values,
            edit_kind=edit_kind,
            edit_note=edit_note,
            actor_id=str(current_user.id),
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_document_updated",
        {"document_id": document_id, "fields": sorted(values)},
    )
    return await _reloaded_full(db, current_user, document_id)


@router.put("/documents/{document_id}/tags", response_model=DocumentFullView)
async def replace_document_tags(
    document_id: str,
    payload: DocumentTagsReplace,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Set the people the document concerns.

    **Requires permission: history.manage**
    """
    item = await _managed_document(db, current_user, document_id)
    async with handle_service_errors("Could not save these tags"):
        await HistoryDocumentService(db).replace_tags(
            item, payload.member_ids, str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_document_tagged",
        {"document_id": document_id, "member_ids": sorted(set(payload.member_ids))},
    )
    return await _reloaded_full(db, current_user, document_id)


@router.put("/documents/{document_id}/apparatus", response_model=DocumentFullView)
async def replace_document_apparatus(
    document_id: str,
    payload: ApparatusTagsReplace,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Set the apparatus the document concerns.

    **Requires permission: history.manage**
    """
    item = await _managed_document(db, current_user, document_id)
    async with handle_service_errors("Could not save these apparatus tags"):
        await HistoryDocumentService(db).replace_apparatus_tags(
            item, payload.apparatus_ids, str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_document_apparatus_tagged",
        {
            "document_id": document_id,
            "apparatus_ids": sorted(set(payload.apparatus_ids)),
        },
    )
    return await _reloaded_full(db, current_user, document_id)


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Delete a draft document, its file in the History folder and its copies.
    A published document is unpublished first.

    **Requires permission: history.manage**
    """
    item = await _managed_document(db, current_user, document_id)
    async with handle_service_errors("Could not delete this document"):
        refs = await HistoryDocumentService(db).delete(item)
    await db.commit()
    # Only once the rows are gone: a failed delete must never leave a record
    # pointing at a missing file.
    for ref in refs:
        await file_storage.delete_quietly(ref)
    await _audit(
        db, current_user, "history_document_deleted", {"document_id": document_id}
    )


@router.post("/documents/{document_id}/publish", response_model=DocumentFullView)
async def publish_document(
    document_id: str,
    payload: PublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Publish to members, or to the public once the clearance list has cleared
    the document's latest substantial revision.

    **Requires permission: history.publish**
    """
    item = await _managed_document(db, current_user, document_id)
    async with handle_service_errors("Could not publish this document"):
        await HistoryDocumentService(db).publish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_document_published",
        {"document_id": document_id, "level": payload.level},
    )
    return await _reloaded_full(db, current_user, document_id)


@router.post("/documents/{document_id}/unpublish", response_model=DocumentFullView)
async def unpublish_document(
    document_id: str,
    payload: UnpublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Return a document to members only, or to draft.

    **Requires permission: history.publish**
    """
    item = await _managed_document(db, current_user, document_id)
    async with handle_service_errors("Could not unpublish this document"):
        await HistoryDocumentService(db).unpublish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_document_unpublished",
        {"document_id": document_id, "level": payload.level},
    )
    return await _reloaded_full(db, current_user, document_id)


@router.get("/documents/{document_id}/revisions", response_model=list[RevisionResponse])
async def list_document_revisions(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The document's change history. Readable by the archive's keepers and by
    members holding a position on the department's clearance list.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    if not viewer.can_view_archive and not await HistoryClearanceService(db).is_clearer(
        viewer.organization_id, viewer.user_id
    ):
        raise HTTPException(status_code=403, detail="Not allowed")
    item = await _managed_document(db, current_user, document_id)
    revisions = await HistoryService(db).revisions(
        viewer.organization_id, RECORD_DOCUMENT, item.document_id
    )
    return [
        RevisionResponse(
            id=r.id,
            revision_number=r.revision_number,
            kind=r.kind,
            note=r.note,
            actor_name=r.actor.full_name if r.actor else None,
            created_at=r.created_at,
        )
        for r in revisions
    ]


@router.get("/people/{person_id}/documents", response_model=list[DocumentSummary])
async def person_documents(
    person_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The documents a person is tagged in that the caller may read.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    person = ensure_found(
        await HistoryService(db).get_readable_person(viewer, person_id), "Person"
    )
    service = HistoryDocumentService(db)
    return [
        DocumentSummary(**service.summary(i))
        for i in await service.for_person(viewer, person)
    ]


# ----------------------------------------------------------------------
# Document types
# ----------------------------------------------------------------------


def _type_response(
    entry: HistoryDocumentType, usage: int = 0
) -> HistoryDocumentTypeResponse:
    return HistoryDocumentTypeResponse(
        id=entry.id,
        name=entry.name,
        sort_order=entry.sort_order,
        is_retired=entry.is_retired,
        usage_count=usage,
    )


@router.get("/document-types", response_model=list[HistoryDocumentTypeResponse])
async def list_document_types(
    include_retired: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The department's managed list of document types. A department with none
    starts with Letter, Minutes, Newspaper clipping, Certificate, Programme,
    Report and Other.

    **Authentication required**
    """
    rows = await HistoryDocumentTypeService(db).list_types(
        str(current_user.organization_id), include_retired=include_retired
    )
    # The first read may have created the starting list.
    await db.commit()
    return [_type_response(entry, usage) for entry, usage in rows]


@router.post(
    "/document-types", response_model=HistoryDocumentTypeResponse, status_code=201
)
async def create_document_type(
    payload: HistoryDocumentTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add a document type to the list.

    **Requires permission: history.manage**
    """
    async with handle_service_errors("Could not add this document type"):
        entry = await HistoryDocumentTypeService(db).create_type(
            str(current_user.organization_id), payload.name, str(current_user.id)
        )
    await db.commit()
    await _audit(
        db, current_user, "history_document_type_created", {"type_id": entry.id}
    )
    return _type_response(entry)


@router.patch("/document-types/{type_id}", response_model=HistoryDocumentTypeResponse)
async def update_document_type(
    type_id: str,
    payload: HistoryDocumentTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Rename a document type, or retire it so it is no longer offered.

    **Requires permission: history.manage**
    """
    service = HistoryDocumentTypeService(db)
    entry = ensure_found(
        await service.get_type(str(current_user.organization_id), type_id), _TYPE
    )
    async with handle_service_errors("Could not save this document type"):
        entry = await service.update_type(entry, payload.model_dump(exclude_unset=True))
    await db.commit()
    await _audit(
        db, current_user, "history_document_type_updated", {"type_id": type_id}
    )
    return _type_response(entry)


@router.post(
    "/document-types/{type_id}/merge", response_model=HistoryDocumentTypeResponse
)
async def merge_document_type(
    type_id: str,
    payload: HistoryDocumentTypeMerge,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Move every document of one type to another, then remove the first.

    **Requires permission: history.manage**
    """
    org_id = str(current_user.organization_id)
    service = HistoryDocumentTypeService(db)
    entry = ensure_found(await service.get_type(org_id, type_id), _TYPE)
    target = ensure_found(await service.get_type(org_id, payload.into_type_id), _TYPE)
    async with handle_service_errors("Could not merge these document types"):
        target = await service.merge_type(entry, target)
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_document_type_merged",
        {"type_id": type_id, "into_type_id": target.id},
    )
    return _type_response(target)
