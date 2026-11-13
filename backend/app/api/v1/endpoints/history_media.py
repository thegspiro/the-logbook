"""
History photos, audio and video, sources and albums
(``/api/v1/history``, gated on the module).

Who receives what is decided by the server: members read published items
without research notes, the original file or anyone's consent answer; the
archive's keepers read everything; ``history.manage`` alone downloads an
original. Every file goes through an endpoint here that checks the item is
readable to the caller first, so a stored file is never reachable by its path.

Audit entries carry ids, never captions, file names or people's names.
"""

import json
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
    HistoryAlbum,
    HistoryMedia,
    MediaFileRole,
    MediaKind,
    PublicationLevel,
)
from app.models.user import User
from app.schemas.history import (
    AlbumCreate,
    AlbumDetail,
    AlbumItemsReplace,
    AlbumSummary,
    AlbumUpdate,
    HistorySourceCreate,
    HistorySourceMerge,
    HistorySourceResponse,
    HistorySourceUpdate,
    MediaFullView,
    MediaList,
    MediaMemberView,
    MediaPublishResult,
    MediaSummary,
    MediaTagFull,
    MediaTagsReplace,
    MediaUpdate,
    MediaUploadFields,
    MediaView,
    PublishRequest,
    RevisionResponse,
    UnpublishRequest,
)
from app.services import file_storage_service as file_storage
from app.services import history_media_files as media_files
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_collection_service import (
    HistoryAlbumService,
    HistorySourceService,
)
from app.services.history_media_service import RECORD_MEDIA, HistoryMediaService
from app.services.history_service import HistoryService, Viewer
from app.utils.upload_limits import read_upload_limited

router = APIRouter()

_ITEM = "Item"
_ALBUM = "Album"


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


async def _managed_item(db: AsyncSession, user: User, media_id: str) -> HistoryMedia:
    return ensure_found(
        await HistoryMediaService(db).get_media(str(user.organization_id), media_id),
        _ITEM,
    )


async def _full_view(
    db: AsyncSession, viewer: Viewer, item: HistoryMedia
) -> MediaFullView:
    service = HistoryMediaService(db)
    clearance = HistoryClearanceService(db)
    latest = await clearance.latest_request(
        viewer.organization_id, RECORD_MEDIA, item.id
    )
    clearance_view = (
        await clearance.request_view(
            latest, record_label=item.title, viewer_id=viewer.user_id
        )
        if latest
        else None
    )
    return MediaFullView(
        **await service.full_view(
            viewer,
            item,
            clearance_view,
            clearance_required=bool(await clearance.list_steps(viewer.organization_id)),
            cleared_for_public=await clearance.is_cleared(
                viewer.organization_id,
                RECORD_MEDIA,
                item.id,
                item.substantial_revision_number,
            ),
        )
    )


async def _item_view(db: AsyncSession, viewer: Viewer, item: HistoryMedia) -> MediaView:
    if viewer.can_view_archive:
        return await _full_view(db, viewer, item)
    return MediaMemberView(**HistoryMediaService(db).member_view(viewer, item))


async def _reloaded_full(db: AsyncSession, user: User, media_id: str) -> MediaFullView:
    # Re-read after every write: on MySQL the database-set timestamps are not
    # returned with an INSERT or UPDATE, and reading them unloaded from an
    # async session raises MissingGreenlet.
    item = await _managed_item(db, user, media_id)
    return await _full_view(db, Viewer.of(user), item)


# ----------------------------------------------------------------------
# Items
# ----------------------------------------------------------------------


@router.get("/media", response_model=MediaList)
async def list_media(
    search: Optional[str] = Query(None, max_length=100),
    kind: Optional[MediaKind] = None,
    decade: Optional[int] = Query(None, ge=1700, le=2100),
    album_id: Optional[str] = Query(None, max_length=36),
    member_id: Optional[str] = Query(None, max_length=36),
    level: Optional[PublicationLevel] = None,
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The gallery. Members see what is published to members or the public; the
    archive's keepers also see drafts and may filter by publication level.

    **Authentication required**
    """
    service = HistoryMediaService(db)
    items, total = await service.list_media(
        Viewer.of(current_user),
        search=search,
        kind=kind,
        decade=decade,
        album_id=album_id,
        member_id=member_id,
        level=level,
        limit=limit,
        offset=offset,
    )
    return MediaList(
        items=[MediaSummary(**service.summary(i)) for i in items], total=total
    )


@router.post("/media", response_model=MediaFullView, status_code=201)
async def upload_media(
    file: UploadFile = File(...),
    catalogue: str = Form("{}", max_length=100_000),
    batch_id: Optional[str] = Form(None, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add one photo, audio recording or video, as a draft, with its catalogue
    (a JSON object of the catalogue fields and ``tag_member_ids``). A batch
    sends each file in its own request with the same ``batch_id``.

    **Requires permission: history.manage**
    """
    try:
        fields = MediaUploadFields.model_validate(json.loads(catalogue or "{}"))
    except (ValueError, ValidationError):
        raise HTTPException(
            status_code=422, detail="The catalogue fields are not valid"
        )
    rules = media_files.rules_for(file.filename)
    limit = rules.max_bytes if rules else media_files.AV_MAX_BYTES
    try:
        content = await read_upload_limited(file, limit)
    except ValueError:
        raise HTTPException(
            status_code=413,
            detail=f"The file is over the {limit // media_files.MB} MB limit",
        )
    service = HistoryMediaService(db)
    written: list[str] = []
    async with handle_service_errors("Could not add this file"):
        try:
            item, written = await service.store_media_upload(
                str(current_user.organization_id),
                content=content,
                filename=file.filename,
                values=fields.model_dump(exclude_unset=True),
                batch_id=batch_id,
                actor=current_user,
            )
        except media_files.UnreadableImage as exc:
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
        "history_media_uploaded",
        {"media_id": item.id, "kind": item.kind.value, "batch_id": batch_id},
    )
    return await _reloaded_full(db, current_user, item.id)


@router.get("/media/{media_id}", response_model=MediaView)
async def get_media(
    media_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One item. Members receive the published view; the archive's keepers
    receive every field and each tagged person's photo-use answer.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    item = ensure_found(
        await HistoryMediaService(db).get_readable_media(viewer, media_id), _ITEM
    )
    return await _item_view(db, viewer, item)


async def _serve(
    db: AsyncSession,
    request: Request,
    user: User,
    media_id: str,
    role: MediaFileRole,
    *,
    attachment: bool = False,
) -> Response:
    viewer = Viewer.of(user)
    service = HistoryMediaService(db)
    item = ensure_found(await service.get_readable_media(viewer, media_id), _ITEM)
    stored = service.file_of(item, role)
    if stored is None:
        raise HTTPException(status_code=404, detail="File not found")
    ref = file_storage.resolve(
        stored.file_path, item.organization_id, file_storage.StorageArea.HISTORY_MEDIA
    )
    if ref is None:
        raise HTTPException(status_code=404, detail="File not found")
    # The uploader's name only for the original; a derived copy is named for
    # the item, so the name never says more than the reader may already see.
    name = (
        item.original_filename or item.id
        if role == MediaFileRole.ORIGINAL
        else f"{item.id}-{role.value}.webp"
    )
    response = await file_storage.file_range_response(
        ref,
        range_header=request.headers.get("range"),
        filename=name,
        media_type=stored.mime_type,
        content_disposition_type="attachment" if attachment else "inline",
    )
    # A browser may keep a copy for itself, never a shared cache: the item can
    # be unpublished, and the file then stops being readable to members.
    response.headers["cache-control"] = "private, max-age=300"
    response.headers["x-content-type-options"] = "nosniff"
    return response


@router.get("/media/{media_id}/thumbnail")
async def media_thumbnail(
    media_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    A photo's 400 px thumbnail, with its location and camera data stripped.

    **Authentication required**
    """
    return await _serve(db, request, current_user, media_id, MediaFileRole.THUMBNAIL)


@router.get("/media/{media_id}/view")
async def media_view_file(
    media_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    What a reader sees or hears: a photo's viewing copy (2048 px WebP, turned
    upright, location and camera data stripped), or the audio or video file
    itself. Answers ``Range`` requests, so a player can seek.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    item = ensure_found(
        await HistoryMediaService(db).get_readable_media(viewer, media_id), _ITEM
    )
    role = (
        MediaFileRole.DISPLAY
        if item.kind == MediaKind.PHOTO
        else MediaFileRole.ORIGINAL
    )
    return await _serve(db, request, current_user, media_id, role)


@router.get("/media/{media_id}/original")
async def media_original(
    media_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    The original file exactly as uploaded, metadata included.

    **Requires permission: history.manage**
    """
    return await _serve(
        db, request, current_user, media_id, MediaFileRole.ORIGINAL, attachment=True
    )


@router.patch("/media/{media_id}", response_model=MediaFullView)
async def update_media(
    media_id: str,
    payload: MediaUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Edit the catalogue. A change to the title, description or date is
    recorded as substantial whatever was chosen, so a public item keeps its
    cleared version until the change is cleared.

    **Requires permission: history.manage**
    """
    item = await _managed_item(db, current_user, media_id)
    values = payload.model_dump(exclude_unset=True)
    edit_kind = values.pop("edit_kind", "minor")
    edit_note = values.pop("edit_note", None)
    async with handle_service_errors("Could not save this item"):
        await HistoryMediaService(db).update(
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
        "history_media_updated",
        {"media_id": media_id, "fields": sorted(values)},
    )
    return await _reloaded_full(db, current_user, media_id)


@router.put("/media/{media_id}/tags", response_model=MediaFullView)
async def replace_media_tags(
    media_id: str,
    payload: MediaTagsReplace,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Set who is shown or heard in the item. The response carries each tagged
    person's photo-use answer as a warning; it never refuses.

    **Requires permission: history.manage**
    """
    item = await _managed_item(db, current_user, media_id)
    async with handle_service_errors("Could not save these tags"):
        await HistoryMediaService(db).replace_tags(
            item, payload.member_ids, str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_media_tagged",
        {"media_id": media_id, "member_ids": sorted(set(payload.member_ids))},
    )
    return await _reloaded_full(db, current_user, media_id)


@router.delete("/media/{media_id}", status_code=204)
async def delete_media(
    media_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Delete a draft item and its stored files. A published item is unpublished
    first.

    **Requires permission: history.manage**
    """
    item = await _managed_item(db, current_user, media_id)
    async with handle_service_errors("Could not delete this item"):
        refs = await HistoryMediaService(db).delete(item)
    await db.commit()
    # Only once the rows are gone: a failed delete must never leave a record
    # pointing at a missing file.
    for ref in refs:
        await file_storage.delete_quietly(ref)
    await _audit(db, current_user, "history_media_deleted", {"media_id": media_id})


@router.post("/media/{media_id}/publish", response_model=MediaPublishResult)
async def publish_media(
    media_id: str,
    payload: PublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Publish to members, or to the public once the clearance list has cleared
    the item's latest substantial revision. Tagged people who have not granted
    photo use are reported back, and the publication records it; they never
    stop it.

    **Requires permission: history.publish**
    """
    item = await _managed_item(db, current_user, media_id)
    async with handle_service_errors("Could not publish this item"):
        _, warnings = await HistoryMediaService(db).publish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_media_published",
        {
            "media_id": media_id,
            "level": payload.level,
            "consent_warning_member_ids": warnings,
        },
    )
    view = await _reloaded_full(db, current_user, media_id)
    return MediaPublishResult(
        item=view,
        consent_warnings=[
            MediaTagFull(**t.model_dump()) for t in view.tags if t.member_id in warnings
        ],
    )


@router.post("/media/{media_id}/unpublish", response_model=MediaFullView)
async def unpublish_media(
    media_id: str,
    payload: UnpublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Return an item to members only, or to draft.

    **Requires permission: history.publish**
    """
    item = await _managed_item(db, current_user, media_id)
    async with handle_service_errors("Could not unpublish this item"):
        await HistoryMediaService(db).unpublish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_media_unpublished",
        {"media_id": media_id, "level": payload.level},
    )
    return await _reloaded_full(db, current_user, media_id)


@router.get("/media/{media_id}/revisions", response_model=list[RevisionResponse])
async def list_media_revisions(
    media_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The item's change history. Readable by the archive's keepers and by
    members holding a position on the department's clearance list.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    if not viewer.can_view_archive and not await HistoryClearanceService(db).is_clearer(
        viewer.organization_id, viewer.user_id
    ):
        raise HTTPException(status_code=403, detail="Not allowed")
    item = await _managed_item(db, current_user, media_id)
    revisions = await HistoryService(db).revisions(
        viewer.organization_id, RECORD_MEDIA, item.id
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


@router.get("/people/{person_id}/media", response_model=list[MediaSummary])
async def person_media(
    person_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The items a person is tagged in that the caller may read.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    person = ensure_found(
        await HistoryService(db).get_readable_person(viewer, person_id), "Person"
    )
    service = HistoryMediaService(db)
    return [
        MediaSummary(**service.summary(i))
        for i in await service.for_person(viewer, person)
    ]


# ----------------------------------------------------------------------
# Sources
# ----------------------------------------------------------------------


def _source_response(source, usage: int = 0) -> HistorySourceResponse:
    return HistorySourceResponse(
        id=source.id,
        name=source.name,
        sort_order=source.sort_order,
        is_retired=source.is_retired,
        usage_count=usage,
    )


@router.get("/sources", response_model=list[HistorySourceResponse])
async def list_sources(
    include_retired: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The department's managed list of sources and donors.

    **Authentication required**
    """
    rows = await HistorySourceService(db).list_sources(
        str(current_user.organization_id), include_retired=include_retired
    )
    return [_source_response(source, usage) for source, usage in rows]


@router.post("/sources", response_model=HistorySourceResponse, status_code=201)
async def create_source(
    payload: HistorySourceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add a source or donor to the list.

    **Requires permission: history.manage**
    """
    async with handle_service_errors("Could not add this source"):
        source = await HistorySourceService(db).create_source(
            str(current_user.organization_id), payload.name, str(current_user.id)
        )
    await db.commit()
    await _audit(db, current_user, "history_source_created", {"source_id": source.id})
    return _source_response(source)


@router.patch("/sources/{source_id}", response_model=HistorySourceResponse)
async def update_source(
    source_id: str,
    payload: HistorySourceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Rename or retire a source. A retired source stays on the items that carry
    it but is no longer offered.

    **Requires permission: history.manage**
    """
    service = HistorySourceService(db)
    source = ensure_found(
        await service.get_source(str(current_user.organization_id), source_id),
        "Source",
    )
    async with handle_service_errors("Could not save this source"):
        source = await service.update_source(
            source, payload.model_dump(exclude_unset=True)
        )
    await db.commit()
    await _audit(db, current_user, "history_source_updated", {"source_id": source_id})
    return _source_response(source)


@router.post("/sources/{source_id}/merge", response_model=HistorySourceResponse)
async def merge_source(
    source_id: str,
    payload: HistorySourceMerge,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Merge a source into another: every item moves to the other source, and
    this one is removed.

    **Requires permission: history.manage**
    """
    service = HistorySourceService(db)
    org_id = str(current_user.organization_id)
    source = ensure_found(await service.get_source(org_id, source_id), "Source")
    target = ensure_found(
        await service.get_source(org_id, payload.into_source_id), "Source"
    )
    async with handle_service_errors("Could not merge these sources"):
        target = await service.merge_source(source, target)
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_source_merged",
        {"from_source_id": source_id, "into_source_id": target.id},
    )
    return _source_response(target)


# ----------------------------------------------------------------------
# Albums
# ----------------------------------------------------------------------


async def _album_summary(
    db: AsyncSession, viewer: Viewer, album: HistoryAlbum, count: Optional[int] = None
) -> AlbumSummary:
    media = HistoryMediaService(db)
    cover = None
    if album.cover_media_id:
        readable = await media.get_readable_media(viewer, album.cover_media_id)
        cover = readable.id if readable else None
    if count is None:
        _, count = await media.list_media(viewer, album_id=album.id, limit=1)
    return AlbumSummary(
        id=album.id,
        name=album.name,
        description=album.description,
        level=album.level,
        cover_media_id=cover,
        item_count=count,
    )


async def _album_detail(
    db: AsyncSession, viewer: Viewer, album: HistoryAlbum
) -> AlbumDetail:
    service = HistoryAlbumService(db)
    items = await service.album_items(viewer, album)
    summary = await _album_summary(db, viewer, album, len(items))
    media = HistoryMediaService(db)
    return AlbumDetail(
        **summary.model_dump(),
        items=[MediaSummary(**media.summary(i)) for i in items],
        can_edit=viewer.can_manage,
    )


async def _managed_album(db: AsyncSession, user: User, album_id: str) -> HistoryAlbum:
    return ensure_found(
        await HistoryAlbumService(db).get_album(Viewer.of(user), album_id), _ALBUM
    )


@router.get("/albums", response_model=list[AlbumSummary])
async def list_albums(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Albums the caller may see: members see albums shown to members, each
    counting only the items they may read.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    return [
        await _album_summary(db, viewer, album, count)
        for album, count in await HistoryAlbumService(db).list_albums(viewer)
    ]


@router.get("/albums/{album_id}", response_model=AlbumDetail)
async def get_album(
    album_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One album and the items in it the caller may read, in order.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    album = ensure_found(
        await HistoryAlbumService(db).get_album(viewer, album_id), _ALBUM
    )
    return await _album_detail(db, viewer, album)


@router.post("/albums", response_model=AlbumDetail, status_code=201)
async def create_album(
    payload: AlbumCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Create an album, as a draft unless shown to members.

    **Requires permission: history.manage**
    """
    async with handle_service_errors("Could not create this album"):
        album = await HistoryAlbumService(db).create_album(
            str(current_user.organization_id),
            payload.model_dump(),
            str(current_user.id),
        )
    await db.commit()
    await _audit(db, current_user, "history_album_created", {"album_id": album.id})
    return await _album_detail(db, Viewer.of(current_user), album)


@router.patch("/albums/{album_id}", response_model=AlbumDetail)
async def update_album(
    album_id: str,
    payload: AlbumUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Rename an album, change its description or cover, or show it to members.

    **Requires permission: history.manage**
    """
    album = await _managed_album(db, current_user, album_id)
    async with handle_service_errors("Could not save this album"):
        album = await HistoryAlbumService(db).update_album(
            album, payload.model_dump(exclude_unset=True)
        )
    await db.commit()
    await _audit(db, current_user, "history_album_updated", {"album_id": album_id})
    return await _album_detail(db, Viewer.of(current_user), album)


@router.put("/albums/{album_id}/items", response_model=AlbumDetail)
async def replace_album_items(
    album_id: str,
    payload: AlbumItemsReplace,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Set the album's items, in order.

    **Requires permission: history.manage**
    """
    album = await _managed_album(db, current_user, album_id)
    async with handle_service_errors("Could not save this album"):
        await HistoryAlbumService(db).set_items(album, payload.media_ids)
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_album_items_set",
        {"album_id": album_id, "count": len(payload.media_ids)},
    )
    album = await _managed_album(db, current_user, album_id)
    return await _album_detail(db, Viewer.of(current_user), album)


@router.delete("/albums/{album_id}", status_code=204)
async def delete_album(
    album_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Delete an album. Its items stay in the archive.

    **Requires permission: history.manage**
    """
    album = await _managed_album(db, current_user, album_id)
    async with handle_service_errors("Could not delete this album"):
        await HistoryAlbumService(db).delete_album(album)
    await db.commit()
    await _audit(db, current_user, "history_album_deleted", {"album_id": album_id})
