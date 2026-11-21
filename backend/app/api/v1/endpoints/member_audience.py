"""What the "email members" picker offers, and how many members a choice
reaches before anything is sent.

Shared by the apparatus-event open-seat email and the request pipeline's
volunteer call, so either permission opens it. Neither endpoint names a
member: the options are classes, statuses and positions, and the preview is a
count.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import Organization, User
from app.schemas.member_audience import (
    MemberAudienceOptions,
    MemberAudiencePayload,
    MemberAudiencePreview,
)
from app.services.member_audience import audience_options, resolve_audience

router = APIRouter()


async def _organization(db: AsyncSession, organization_id: str) -> Organization:
    org = (
        await db.execute(select(Organization).where(Organization.id == organization_id))
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(status_code=404, detail="Department not found")
    return org


@router.get("/options", response_model=MemberAudienceOptions)
async def get_member_audience_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("events.manage", "apparatus_events.manage")
    ),
):
    """
    The member classes, statuses (including the department's own tiers) and
    positions a coordinator can choose from.

    **Requires permission: events.manage OR apparatus_events.manage**
    """
    org_id = str(current_user.organization_id)
    org = await _organization(db, org_id)
    return await audience_options(db, org, org_id)


@router.post("/preview", response_model=MemberAudiencePreview)
async def preview_member_audience(
    data: MemberAudiencePayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("events.manage", "apparatus_events.manage")
    ),
):
    """
    How many members an email with these choices would reach, and how many
    match but have turned off volunteer call emails.

    **Requires permission: events.manage OR apparatus_events.manage**
    """
    org_id = str(current_user.organization_id)
    org = await _organization(db, org_id)
    try:
        audience = await resolve_audience(db, org, org_id, data.to_filter())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    return MemberAudiencePreview(
        recipients=len(audience.emails),
        skipped_opted_out=audience.skipped_opted_out,
    )
