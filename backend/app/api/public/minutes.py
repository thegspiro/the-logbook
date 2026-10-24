"""Public minutes endpoints.

Unauthenticated, read-only, behind the ``/public/minutes`` page. Serves only the
public copies a department posted on purpose (``MinutesPublicCopy``): a snapshot
narrowed to what a public page may show, never the minutes themselves.

Whether anything is served at all is decided on every request from the
department's current settings, not from when a copy was posted, so switching
public posting off, or withdrawing a copy, takes effect immediately. Responses
are ``no-store`` for the same reason: a cached copy would outlive a withdrawal.

Multi-tenant note, as for the legal text endpoint: an anonymous caller carries
no organization, so these answer only on a deployment with exactly one. With
two or more they answer 404 rather than guess whose minutes to show.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.models.minute import MinutesPublicCopy
from app.models.user import Organization
from app.schemas.base import UTCResponseBase
from app.services.minutes_publishing_service import MinutesPublishingService
from app.services.organization_service import OrganizationService
from app.utils.org_timezone import scheduling_timezone

router = APIRouter(prefix="/public/v1/minutes", tags=["public-minutes"])

_NOT_AVAILABLE = "Minutes are not available"


class PublicMinutesItem(UTCResponseBase):
    id: str
    title: str
    meeting_type_display: Optional[str] = None
    meeting_date: Optional[datetime] = None
    meeting_date_display: Optional[str] = None
    posted_at: datetime
    version: Optional[int] = None
    under_correction: bool = False


class PublicMinutesList(BaseModel):
    organization_name: str
    minutes: List[PublicMinutesItem]
    total: int
    skip: int
    limit: int


class PublicMinutesReplaces(BaseModel):
    version: Optional[int] = None
    posted_on: Optional[str] = None


class PublicMinutesDetail(PublicMinutesItem):
    organization_name: str
    replaces: Optional[PublicMinutesReplaces] = None
    content: Dict[str, Any]


async def _rate_limit_minutes(request: Request) -> None:
    """Rate limit the public minutes page: 60/minute per IP (DoS guard)."""
    client_ip = get_client_ip(request)
    is_limited, _ = await public_rate_limit(
        key=f"pub_minutes:{client_ip}", max_requests=60, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


async def _the_organization(db: AsyncSession) -> Organization:
    """The deployment's one organization, or 404.

    ``limit(2)`` and an exact count of one is the whole safeguard: ``.first()``
    would serve an arbitrary department's minutes once a second exists.
    """
    orgs = (await db.execute(select(Organization).limit(2))).scalars().all()
    if len(orgs) != 1:
        raise HTTPException(status_code=404, detail=_NOT_AVAILABLE)
    org = orgs[0]
    enabled = (
        await OrganizationService(db).get_enabled_modules(org.id)
    ).enabled_modules
    if "minutes" not in enabled:
        raise HTTPException(status_code=404, detail=_NOT_AVAILABLE)
    return org


def _item(copy: MinutesPublicCopy) -> Dict[str, Any]:
    content = copy.content if isinstance(copy.content, dict) else {}
    return {
        "id": copy.id,
        "title": copy.title,
        "meeting_type_display": content.get("meeting_type_display"),
        "meeting_date": copy.meeting_date,
        "meeting_date_display": content.get("meeting_date_display"),
        "posted_at": copy.posted_at,
        "version": copy.revision_version,
        "under_correction": copy.under_correction_since is not None,
    }


@router.get("", response_model=PublicMinutesList)
async def list_public_minutes(
    response: Response,
    skip: int = Query(0, ge=0, le=100_000),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_rate_limit_minutes),
) -> PublicMinutesList:
    """The minutes this department has posted publicly, newest meeting first."""
    response.headers["Cache-Control"] = "no-store"
    org = await _the_organization(db)
    copies, total = await MinutesPublishingService(db).list_public(
        org.id, skip=skip, limit=limit
    )
    return PublicMinutesList(
        organization_name=org.name,
        minutes=[PublicMinutesItem(**_item(c)) for c in copies],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/{copy_id}", response_model=PublicMinutesDetail)
async def get_public_minutes(
    copy_id: UUID,
    response: Response,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_rate_limit_minutes),
) -> PublicMinutesDetail:
    """One set of minutes as posted publicly."""
    response.headers["Cache-Control"] = "no-store"
    org = await _the_organization(db)
    copy = await MinutesPublishingService(db).get_public(org.id, str(copy_id))
    if copy is None:
        raise HTTPException(status_code=404, detail=_NOT_AVAILABLE)

    replaces = None
    if copy.replaced_version is not None or copy.replaced_posted_at is not None:
        posted_on = None
        if copy.replaced_posted_at is not None:
            stamp = copy.replaced_posted_at
            if stamp.tzinfo is None:
                # Stored as UTC; MySQL hands it back without a zone.
                stamp = stamp.replace(tzinfo=timezone.utc)
            posted_on = stamp.astimezone(scheduling_timezone(org)).strftime("%B %d, %Y")
        replaces = PublicMinutesReplaces(
            version=copy.replaced_version, posted_on=posted_on
        )
    return PublicMinutesDetail(
        **_item(copy),
        organization_name=org.name,
        replaces=replaces,
        content=copy.content if isinstance(copy.content, dict) else {},
    )
