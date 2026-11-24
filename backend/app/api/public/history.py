"""
The department's History on its own website (``/api/public/v1/history``).

Two routers, because they are reached two ways:

- ``router``: the public portal API. Each call carries the portal's API key and
  is rate-limited and written to the access log like every other portal call.
  The portal must be on, the History module on, and the part of History asked
  for switched on in History's "Public website" settings. A part that is off
  answers 404, the same as a record that does not exist, so a website cannot
  tell what the department keeps.
- ``open_router``: what a browser fetches without a key. The signed links to
  files (a photo's display copy or thumbnail, a document's thumbnail or cleaned
  PDF, an article's public PDF) and the "Today in history" widget, reached by
  its own secret link. Both are rate-limited per address and re-check, on every
  request, everything the API would: a withdrawn record's link stops working
  at once, not when it expires.

Everything served is a record's cleared public copy; see
``HistoryPublicService``.
"""

import mimetypes
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from fastapi.responses import Response
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.public.portal import check_portal_enabled, log_public_api_request
from app.core.database import get_db
from app.core.public_portal_security import authenticate_api_key
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.models.history import (
    HistoryArticle,
    HistoryDocument,
    HistoryMedia,
    MediaFileRole,
)
from app.models.public_portal import PublicPortalAPIKey, PublicPortalConfig
from app.models.user import Organization
from app.schemas.forms import EmbedPolicyResponse
from app.services import file_storage_service as file_storage
from app.services import history_public_links as links
from app.services.history_article_export import (
    ExportMeta,
    read_photos,
    render_article_pdf,
)
from app.services.history_public_service import (
    TYPE_APPARATUS,
    TYPE_ARTICLES,
    TYPE_DOCUMENTS,
    TYPE_EVENTS,
    TYPE_HONOR_ROLL,
    TYPE_PEOPLE,
    TYPE_PHOTOS,
    TYPE_TIMELINE,
    TYPE_TODAY,
    HistoryPublicService,
    PublicRecords,
)
from app.services.organization_service import OrganizationService
from app.utils.embed_origins import department_embed_origins
from app.utils.org_timezone import resolve_org_today

router = APIRouter(prefix="/public/v1/history", tags=["public-history"])
open_router = APIRouter(prefix="/public/v1/history", tags=["public-history"])

_NOT_FOUND = "Not found"


def _record_id() -> Any:
    """A record id as the archive issues them. A new ``Path`` per route: one
    shared object keeps the name of the first parameter it was bound to."""
    return Path(..., min_length=1, max_length=36, pattern=r"^[A-Za-z0-9-]+$")


#: Decades are named by their first year: 1950 for the 1950s.
# The header nginx copies into ``frame-ancestors`` for /embed/history/<token>.
EMBED_ANCESTORS_HEADER = "X-Embed-Frame-Ancestors"
NO_EMBED = "'none'"


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)


async def _history_on(db: AsyncSession, organization_id: str) -> bool:
    modules = (
        await OrganizationService(db).get_enabled_modules(organization_id)
    ).enabled_modules
    return "history" in modules


async def _portal_open(db: AsyncSession, organization_id: str) -> bool:
    """Whether the department's portal is on, for the routes reached without
    a key. Answers False rather than raising, so every refusal is a 404."""
    config = await db.scalar(
        select(PublicPortalConfig).where(
            PublicPortalConfig.organization_id == str(organization_id)
        )
    )
    if config is None:
        return False
    try:
        await check_portal_enabled(config, db)
    except HTTPException:
        return False
    return await _history_on(db, organization_id)


# ----------------------------------------------------------------------
# The portal API
# ----------------------------------------------------------------------


@asynccontextmanager
async def _logged(
    request: Request, api_key: PublicPortalAPIKey, db: AsyncSession
) -> AsyncIterator[None]:
    """Write the call to the portal's access log with the status it answers,
    as the other portal routes do."""
    start = time.time()
    try:
        yield
    except HTTPException as exc:
        await log_public_api_request(request, api_key, exc.status_code, start, db)
        raise
    except Exception:
        logger.exception("Public History request failed")
        await log_public_api_request(request, api_key, 500, start, db)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )
    await log_public_api_request(request, api_key, 200, start, db)


async def _records(
    db: AsyncSession, api_key: PublicPortalAPIKey, kind: Optional[str]
) -> tuple[HistoryPublicService, PublicRecords]:
    """The department's public records, once the portal, the History module
    and (when *kind* is named) that part's switch are all on."""
    organization_id = str(api_key.organization_id)
    config = await db.scalar(
        select(PublicPortalConfig).where(
            PublicPortalConfig.organization_id == organization_id
        )
    )
    if config is None:
        raise _not_found()
    await check_portal_enabled(config, db)
    if not await _history_on(db, organization_id):
        raise _not_found()
    service = HistoryPublicService(db)
    records = await service.records(organization_id)
    if kind is not None and not service.is_on(records.settings, kind):
        raise _not_found()
    return service, records


def _found(value: Any) -> Any:
    if value is None:
        raise _not_found()
    return value


@router.get("/feed")
async def get_feed(
    request: Request,
    limit: int = Query(20, ge=1, le=50),
    before: Optional[datetime] = Query(None),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """What the department most recently made public, newest first, across
    every part of History that is switched on. Page back with ``before`` set
    to the last item's ``published_at``."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, None)
        if before is not None and before.tzinfo is None:
            before = before.replace(tzinfo=timezone.utc)
        items = await service.feed(records, before, limit)
    return {"items": items}


@router.get("/people")
async def list_people(
    request: Request,
    decade: Optional[int] = Query(None, ge=1700, le=2990, multiple_of=10),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """People whose records are public, by surname. ``decade`` keeps those
    who served in it."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_PEOPLE)
        page = await service.list_people(records, decade, limit, offset)
    return page


@router.get("/people/{member_id}")
async def get_person(
    request: Request,
    member_id: str = _record_id(),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One person's public record."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_PEOPLE)
        view = service.person_view(_found(records.people.get(member_id)))
    return view


@router.get("/honor-roll")
async def get_honor_roll(
    request: Request,
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The members who died in the line of duty, whose records are public,
    in order of their deaths."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_HONOR_ROLL)
        items = await service.honor_roll(records)
    return {"items": items}


@router.get("/photos")
async def list_photos(
    request: Request,
    decade: Optional[int] = Query(None, ge=1700, le=2990, multiple_of=10),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Public photos, recordings and films, oldest first. Recordings and
    films are listed but not streamed."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_PHOTOS)
        page = await service.list_media(records, decade, limit, offset)
    return page


@router.get("/photos/{media_id}")
async def get_photo(
    request: Request,
    media_id: str = _record_id(),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One public photo, recording or film."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_PHOTOS)
        view = service.media_view(_found(records.media.get(media_id)))
    return view


@router.get("/documents")
async def list_documents(
    request: Request,
    decade: Optional[int] = Query(None, ge=1700, le=2990, multiple_of=10),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Public documents, oldest first."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_DOCUMENTS)
        page = await service.list_documents(records, decade, limit, offset)
    return page


@router.get("/documents/{document_id}")
async def get_document(
    request: Request,
    document_id: str = _record_id(),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One public document."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_DOCUMENTS)
        view = service.document_view(_found(records.documents.get(document_id)))
    return view


@router.get("/events")
async def list_events(
    request: Request,
    decade: Optional[int] = Query(None, ge=1700, le=2990, multiple_of=10),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Public events, oldest first."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_EVENTS)
        page = await service.list_events(records, decade, limit, offset)
    return page


@router.get("/events/{event_id}")
async def get_event(
    request: Request,
    event_id: str = _record_id(),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One public event, with the public photos and documents it links to."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_EVENTS)
        view = service.event_view(_found(records.events.get(event_id)), records)
    return view


@router.get("/apparatus")
async def list_apparatus(
    request: Request,
    decade: Optional[int] = Query(None, ge=1700, le=2990, multiple_of=10),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Public apparatus, by the date each entered service. ``decade`` keeps
    those in service during it."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_APPARATUS)
        page = await service.list_apparatus(records, decade, limit, offset)
    return page


@router.get("/apparatus/{apparatus_id}")
async def get_apparatus(
    request: Request,
    apparatus_id: str = _record_id(),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One public apparatus."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_APPARATUS)
        view = service.apparatus_view(_found(records.apparatus.get(apparatus_id)))
    return view


@router.get("/articles")
async def list_articles(
    request: Request,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Public articles, most recently published first."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_ARTICLES)
        page = await service.list_articles(records, limit, offset)
    return page


@router.get("/articles/{article_id}")
async def get_article(
    request: Request,
    article_id: str = _record_id(),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One public article: its text, its public photos, the public records it
    links to, and a link to its PDF."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_ARTICLES)
        view = await service.article_view(
            _found(records.articles.get(article_id)), records
        )
    return view


@router.get("/timeline/decades")
async def get_timeline_decades(
    request: Request,
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The decades the public timeline has entries in, with how many."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_TIMELINE)
        items = await service.decades(records)
    return {"items": items}


@router.get("/timeline")
async def get_timeline(
    request: Request,
    decade: int = Query(..., ge=1700, le=2990, multiple_of=10),
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One decade of the public timeline, oldest first."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_TIMELINE)
        items = await service.timeline(records, decade)
    return {"decade": decade, "items": items}


@router.get("/today")
async def get_today(
    request: Request,
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """ "Today in history": what happened on today's date in earlier years, by
    the department's own calendar. On a quiet day, the next seven days'
    anniversaries (``mode`` ``week``); with none of those, ``mode`` ``none``."""
    async with _logged(request, api_key, db):
        service, records = await _records(db, api_key, TYPE_TODAY)
        today = await resolve_org_today(db, str(api_key.organization_id))
        answer = await service.today(records, today)
    return answer


# ----------------------------------------------------------------------
# Signed files
# ----------------------------------------------------------------------


async def _rate_limit(request: Request, scope: str, per_minute: int) -> None:
    is_limited, _ = await public_rate_limit(
        key=f"{scope}:{get_client_ip(request)}",
        max_requests=per_minute,
        window_seconds=60,
        lockout_seconds=300,
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


async def _rate_limit_files(request: Request) -> None:
    # A page of thumbnails asks for many at once.
    await _rate_limit(request, "pub_history_file", 300)


async def _rate_limit_widget(request: Request) -> None:
    await _rate_limit(request, "pub_history_widget", 60)


_ROLES = {
    links.VARIANT_THUMBNAIL: MediaFileRole.THUMBNAIL,
    links.VARIANT_DISPLAY: MediaFileRole.DISPLAY,
    # A document's readable copy is its stripped display file; the original
    # (the document's own file) is never served.
    links.VARIANT_FILE: MediaFileRole.DISPLAY,
}


async def _stored_file(item: Any, variant: str, record_id: str) -> Response:
    role = _ROLES[variant]
    stored = next((f for f in item.files if f.role == role), None)
    if stored is None:
        raise _not_found()
    extension = mimetypes.guess_extension(stored.mime_type) or ""
    return await file_storage.file_response(
        stored.file_path,
        filename=f"{record_id}-{variant}{extension}",
        media_type=stored.mime_type,
        content_disposition_type="inline",
    )


def _written_date(day: date) -> str:
    return f"{day:%B} {day.day}, {day.year}"


async def _article_pdf(
    db: AsyncSession, service: HistoryPublicService, article: HistoryArticle
) -> Response:
    """The public article as a PDF, printed from its cleared copy with only
    its public photos, in the members' export layout."""
    printed, media = await service.article_pdf_view(article)
    organization = await db.get(Organization, article.organization_id)
    today = await resolve_org_today(db, article.organization_id)
    meta = ExportMeta(
        org_name=organization.name if organization else None,
        logo=organization.logo if organization else None,
        generated_on=_written_date(today),
        photos=await read_photos(media, printed, article.id),
    )
    return Response(
        content=render_article_pdf(printed, meta),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{article.id}.pdf"'},
    )


@open_router.get(
    "/files/{token}",
    response_class=Response,
    responses={
        200: {
            "content": {
                "image/webp": {},
                "image/jpeg": {},
                "application/pdf": {},
            }
        }
    },
    dependencies=[Depends(_rate_limit_files)],
)
async def get_public_file(
    token: str = Path(
        ...,
        min_length=20,
        max_length=links.MAX_TOKEN_LENGTH,
        pattern=r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$",
    ),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    A file a public History record shows, by the signed link the API gave.

    No API key: a browser drawing an image cannot carry one. The link names
    one copy of one record and expires after a day, and every request
    re-checks that the record is still public, its part of History still
    switched on and the portal still on. Any failure is a 404.
    """
    claim = links.verify(token)
    if claim is None or not await _portal_open(db, claim.organization_id):
        raise _not_found()
    service = HistoryPublicService(db)
    record = await service.file_allowed(claim)
    if record is None:
        raise _not_found()
    if isinstance(record, HistoryArticle):
        return await _article_pdf(db, service, record)
    if isinstance(record, (HistoryMedia, HistoryDocument)):
        return await _stored_file(record, claim.variant, claim.record_id)
    raise _not_found()


# ----------------------------------------------------------------------
# The "Today in history" widget
# ----------------------------------------------------------------------


def _widget_token() -> Any:
    return Path(..., min_length=32, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


@open_router.get("/widget/{token}/today", dependencies=[Depends(_rate_limit_widget)])
async def get_widget_today(
    token: str = _widget_token(),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    What the department's "Today in history" widget shows, reached by the
    widget's own secret link rather than an API key.

    404 when the link has been replaced or removed, "Today in history" is
    switched off, or the portal or the History module is off.
    """
    service = HistoryPublicService(db)
    settings = await service.settings_for_widget(token)
    if (
        settings is None
        or not service.is_on(settings, TYPE_TODAY)
        or not await _portal_open(db, settings.organization_id)
    ):
        raise _not_found()
    records = await service.records(settings.organization_id)
    today = await resolve_org_today(db, settings.organization_id)
    answer = await service.today(records, today)
    organization = (
        await db.get(Organization, settings.organization_id)
        if settings.widget_show_branding
        else None
    )
    return {
        **answer,
        "theme": settings.widget_theme.value,
        "organization_name": organization.name if organization else None,
        "has_logo": bool(organization and organization.logo),
    }


@open_router.get(
    "/widget/{token}/embed-policy",
    response_model=EmbedPolicyResponse,
    dependencies=[Depends(_rate_limit_widget)],
)
async def get_widget_embed_policy(
    response: Response,
    token: str = _widget_token(),
    db: AsyncSession = Depends(get_db),
) -> EmbedPolicyResponse:
    """
    Which websites may show the widget in an iframe (public, no auth).

    Asked by nginx (``auth_request``) each time ``/embed/history/<token>`` is
    served, and copied into that page's ``frame-ancestors``. The answer is the
    department's websites as listed under Organization Settings → Forms (the
    same list embedded forms use), each re-checked as an exact ``https`` origin,
    while the widget would answer; anything else, a link that matches nothing
    included, is ``'none'``, still with a 200, so the page renders and simply
    cannot be framed.
    """
    origins: list[str] = []
    service = HistoryPublicService(db)
    settings = await service.settings_for_widget(token)
    if (
        settings is not None
        and service.is_on(settings, TYPE_TODAY)
        and await _portal_open(db, settings.organization_id)
    ):
        org_settings = await db.scalar(
            select(Organization.settings).where(
                Organization.id == settings.organization_id
            )
        )
        # Re-checked on the way out: the stored list is free-form JSON, and
        # this value is written into a response header.
        origins = department_embed_origins(org_settings)
    frame_ancestors = " ".join(origins) if origins else NO_EMBED
    response.headers[EMBED_ANCESTORS_HEADER] = frame_ancestors
    response.headers["Cache-Control"] = "no-store"
    return EmbedPolicyResponse(frame_ancestors=frame_ancestors)
