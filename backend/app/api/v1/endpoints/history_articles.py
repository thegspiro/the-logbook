"""
History articles (``/api/v1/history/articles``, gated on the module): the
archive's written pieces, published like every other History record, and
exported as PDF or Word.

Who receives what is decided by the server: members read what is published
to members or the public, with only the photos and links they could open;
the archive's keepers read everything, drafts included. An export holds what
the caller could read on the page, never the research notes.

Audit entries carry ids and the export format, never titles or text.
"""

import re
from datetime import date
from typing import Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.api.v1.endpoints.history_events import (
    _audit,
    _clearance_state,
    _may_read_revisions,
    _revisions,
)
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.history import HistoryArticle, PublicationLevel
from app.models.user import Organization, User
from app.schemas.history import (
    ArticleCreate,
    ArticleFullView,
    ArticleList,
    ArticleMemberView,
    ArticleSummary,
    ArticleUpdate,
    ArticleView,
    PublishRequest,
    RevisionResponse,
    UnpublishRequest,
)
from app.services.history_article_export import (
    ExportMeta,
    load_photos,
    render_article_docx,
    render_article_pdf,
)
from app.services.history_article_service import (
    LINK_KEYS,
    RECORD_ARTICLE,
    HistoryArticleService,
)
from app.services.history_service import Viewer
from app.utils.org_timezone import resolve_org_today

router = APIRouter()

_ARTICLE = "Article"

_EXPORT_TYPES = {
    "pdf": "application/pdf",
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
}


async def _managed_article(
    db: AsyncSession, user: User, article_id: str
) -> HistoryArticle:
    return ensure_found(
        await HistoryArticleService(db).get_article(
            str(user.organization_id), article_id
        ),
        _ARTICLE,
    )


async def _article_full(
    db: AsyncSession, viewer: Viewer, item: HistoryArticle
) -> ArticleFullView:
    state = await _clearance_state(db, viewer, RECORD_ARTICLE, item, item.title)
    return ArticleFullView(
        **HistoryArticleService(db).full_view(
            viewer,
            item,
            state["clearance"],
            clearance_required=state["clearance_required"],
            cleared_for_public=state["cleared_for_public"],
        )
    )


async def _reloaded_article(
    db: AsyncSession, user: User, article_id: str
) -> ArticleFullView:
    item = await _managed_article(db, user, article_id)
    return await _article_full(db, Viewer.of(user), item)


def _split_payload(
    values: dict[str, Any],
) -> tuple[dict[str, Any], Optional[list[dict[str, Any]]], dict[str, Any]]:
    blocks = values.pop("blocks", None)
    links = {key: values.pop(key) for key in LINK_KEYS if key in values}
    return values, blocks, links


def export_filename(title: str, today: date, extension: str) -> str:
    """``the_mill_fire_2026-11-23.pdf``. Anything but letters, digits and
    hyphens becomes an underscore, so no title can put a path separator or a
    quote into the header."""
    stem = re.sub(r"[^\w-]+", "_", title).strip("_")[:80].lower() or "article"
    return f"{stem}_{today.isoformat()}.{extension}"


def _disposition(filename: str) -> str:
    # A title can hold any script; a header carries only latin-1 unless the
    # name is RFC 5987 encoded.
    quoted = quote(filename, safe="")
    if quoted == filename:
        return f'attachment; filename="{filename}"'
    return f"attachment; filename*=utf-8''{quoted}"


def _written_date(day: date) -> str:
    return f"{day:%B} {day.day}, {day.year}"


@router.get("/articles", response_model=ArticleList)
async def list_articles(
    search: Optional[str] = Query(None, max_length=100),
    member_id: Optional[str] = Query(None, max_length=36),
    event_id: Optional[str] = Query(None, max_length=36),
    apparatus_id: Optional[str] = Query(None, max_length=36),
    document_id: Optional[str] = Query(None, max_length=36),
    media_id: Optional[str] = Query(None, max_length=36),
    level: Optional[PublicationLevel] = None,
    sort: str = Query("updated", pattern="^(updated|title)$"),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The archive's articles, most recently updated first or A to Z. Search
    covers the title, subtitle, summary and text. Filtered by a linked person,
    event, apparatus or document, or a photo the article shows. Members see
    what is published; the archive's keepers also see drafts and may filter by
    level.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    service = HistoryArticleService(db)
    items, total = await service.list_articles(
        viewer,
        search=search,
        member_id=member_id,
        event_id=event_id,
        apparatus_id=apparatus_id,
        document_id=document_id,
        media_id=media_id,
        level=level,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return ArticleList(
        items=[ArticleSummary(**service.summary(viewer, i)) for i in items],
        total=total,
    )


@router.post("/articles", response_model=ArticleFullView, status_code=201)
async def create_article(
    payload: ArticleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add an article, as a draft, with its body and the people, events,
    apparatus and documents it links to. A byline left out defaults to the
    writer's name.

    **Requires permission: history.manage**
    """
    values, blocks, links = _split_payload(payload.model_dump(exclude_unset=True))
    async with handle_service_errors("Could not add this article"):
        item = await HistoryArticleService(db).create(
            str(current_user.organization_id),
            values,
            blocks,
            links,
            str(current_user.id),
            current_user.full_name,
        )
    await db.commit()
    await _audit(db, current_user, "history_article_created", {"article_id": item.id})
    return await _reloaded_article(db, current_user, item.id)


@router.get("/articles/{article_id}", response_model=ArticleView)
async def get_article(
    article_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One article. Members receive the published view, with only the photos
    and links they may read; the archive's keepers receive every field, and
    the editor's view of the body (a photo since withdrawn kept as a gap).

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    service = HistoryArticleService(db)
    item = ensure_found(
        await service.get_readable_article(viewer, article_id), _ARTICLE
    )
    if viewer.can_view_archive:
        return await _article_full(db, viewer, item)
    return ArticleMemberView(**service.member_view(viewer, item))


@router.patch("/articles/{article_id}", response_model=ArticleFullView)
async def update_article(
    article_id: str,
    payload: ArticleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Edit the article, and replace the body or any link set that is sent. A
    change to anything a reader sees, its body and links included, is
    recorded as substantial whatever was chosen.

    **Requires permission: history.manage**
    """
    item = await _managed_article(db, current_user, article_id)
    values = payload.model_dump(exclude_unset=True)
    edit_kind = values.pop("edit_kind", "minor")
    edit_note = values.pop("edit_note", None)
    values, blocks, links = _split_payload(values)
    async with handle_service_errors("Could not save this article"):
        await HistoryArticleService(db).update(
            item,
            values,
            blocks,
            links,
            edit_kind=edit_kind,
            edit_note=edit_note,
            actor_id=str(current_user.id),
        )
    await db.commit()
    fields = sorted([*values, *links, *(["blocks"] if blocks is not None else [])])
    await _audit(
        db,
        current_user,
        "history_article_updated",
        {"article_id": article_id, "fields": fields},
    )
    return await _reloaded_article(db, current_user, article_id)


@router.delete("/articles/{article_id}", status_code=204)
async def delete_article(
    article_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Delete a draft article, its body and its links. The photos and records it
    showed or linked to are untouched. A published article is unpublished
    first.

    **Requires permission: history.manage**
    """
    item = await _managed_article(db, current_user, article_id)
    async with handle_service_errors("Could not delete this article"):
        await HistoryArticleService(db).delete(item)
    await db.commit()
    await _audit(
        db, current_user, "history_article_deleted", {"article_id": article_id}
    )


@router.post("/articles/{article_id}/publish", response_model=ArticleFullView)
async def publish_article(
    article_id: str,
    payload: PublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Publish to members, or to the public once the clearance list has cleared
    the article's latest substantial revision.

    **Requires permission: history.publish**
    """
    item = await _managed_article(db, current_user, article_id)
    async with handle_service_errors("Could not publish this article"):
        await HistoryArticleService(db).publish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_article_published",
        {"article_id": article_id, "level": payload.level},
    )
    return await _reloaded_article(db, current_user, article_id)


@router.post("/articles/{article_id}/unpublish", response_model=ArticleFullView)
async def unpublish_article(
    article_id: str,
    payload: UnpublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Return an article to members only, or to draft.

    **Requires permission: history.publish**
    """
    item = await _managed_article(db, current_user, article_id)
    async with handle_service_errors("Could not unpublish this article"):
        await HistoryArticleService(db).unpublish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_article_unpublished",
        {"article_id": article_id, "level": payload.level},
    )
    return await _reloaded_article(db, current_user, article_id)


@router.get("/articles/{article_id}/revisions", response_model=list[RevisionResponse])
async def list_article_revisions(
    article_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The article's change history. Readable by the archive's keepers and by
    members holding a position on the department's clearance list.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    await _may_read_revisions(db, viewer)
    item = await _managed_article(db, current_user, article_id)
    return await _revisions(db, viewer, RECORD_ARTICLE, item.id)


@router.get("/articles/{article_id}/export")
async def export_article(
    article_id: str,
    export_format: str = Query("pdf", alias="format", pattern="^(pdf|docx)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The article as a PDF or a Word file, holding what the caller could read
    on its page: only the photos and links they may see, and never the
    research notes. Anyone who may read the article may export it.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    service = HistoryArticleService(db)
    item = ensure_found(
        await service.get_readable_article(viewer, article_id), _ARTICLE
    )
    view = service.export_view(viewer, item)
    organization = await db.get(Organization, viewer.organization_id)
    today = await resolve_org_today(db, viewer.organization_id)
    meta = ExportMeta(
        org_name=organization.name if organization else None,
        logo=organization.logo if organization else None,
        generated_on=_written_date(today),
        photos=await load_photos(item, view),
    )
    # Rendered in full before anything is sent, so a failure answers with an
    # error rather than half a file.
    async with handle_service_errors("Could not make this file"):
        content = (
            render_article_pdf(view, meta)
            if export_format == "pdf"
            else render_article_docx(view, meta)
        )
    await _audit(
        db,
        current_user,
        "history_article_exported",
        {"article_id": article_id, "format": export_format},
    )
    return Response(
        content=content,
        media_type=_EXPORT_TYPES[export_format],
        headers={
            "Content-Disposition": _disposition(
                export_filename(item.title, today, export_format)
            )
        },
    )
