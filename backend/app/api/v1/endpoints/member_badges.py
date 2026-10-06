"""
Member badge codes: read, reissue, resolve a scan, and the old-badge switch.

The badge code is a credential: whoever holds it can present a badge that
scans as that member. So it is served only here — to the member, and to the
officers who issue badges — never in a roster or profile response, and the
scanners send what they read here instead of matching it against a roster.
"""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import check_rate_limit
from app.core.utils import safe_error_detail
from app.models.user import User
from app.services.member_badge_service import MemberBadgeService
from app.utils.member_badge import MAX_SCANNED_LENGTH

router = APIRouter()

# Who may see or reissue another member's badge: the ID-card rule
# (frontend utils/memberIdCardAccess.ts), never the directory's members.view.
BADGE_OFFICER_PERMISSIONS = ("members.manage", "members.manage_id_cards")

# Who may look up a scanned badge: the two scanners' own gates — the member
# badge scanner (users.view / members.manage) and inventory's issue-by-badge
# (inventory.manage) — plus the badge officers who test the cards they print.
BADGE_SCANNER_PERMISSIONS = (
    "users.view",
    "members.manage",
    "members.manage_id_cards",
    "inventory.manage",
)

ScannedCode = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_SCANNED_LENGTH)
]


class MemberBadgeResponse(BaseModel):
    user_id: str
    badge_code: str


class MemberBadgeSettings(BaseModel):
    accept_legacy: bool


class ResolveBadgeBody(BaseModel):
    code: ScannedCode


class ResolvedMember(BaseModel):
    user_id: str
    name: str
    membership_number: Optional[str] = None
    is_active: bool
    # "badge_code" or "legacy", so a station can tell an officer which members
    # still carry an old badge before the department switches those off.
    matched: str


async def _rate_limit_resolve(request: Request) -> None:
    """120 lookups a minute per address: a busy check-in line, not a guesser."""
    await check_rate_limit(
        request,
        max_requests=120,
        window_seconds=60,
        lockout_seconds=300,
        scope="member_badge_resolve",
    )


def _is_badge_officer(user: User) -> bool:
    held = _collect_user_permissions(user)
    return any(_has_permission(p, held) for p in BADGE_OFFICER_PERMISSIONS)


@router.get("/settings", response_model=MemberBadgeSettings)
async def get_badge_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*BADGE_OFFICER_PERMISSIONS)),
):
    """Whether old-style badges (membership number, short id) still scan.

    **Permissions required:** members.manage or members.manage_id_cards
    """
    try:
        accept = await MemberBadgeService(db).get_accept_legacy(
            current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=safe_error_detail(e))
    return {"accept_legacy": accept}


@router.put("/settings", response_model=MemberBadgeSettings)
async def save_badge_settings(
    data: MemberBadgeSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*BADGE_OFFICER_PERMISSIONS)),
):
    """Allow or refuse old-style badges at every scanner.

    **Permissions required:** members.manage or members.manage_id_cards
    """
    try:
        accept = await MemberBadgeService(db).set_accept_legacy(
            current_user.organization_id, data.accept_legacy
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=safe_error_detail(e))
    await log_audit_event(
        db=db,
        event_type="member_badge_settings_updated",
        event_category="settings",
        severity="warning" if not accept else "info",
        event_data={"accept_legacy": accept},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return {"accept_legacy": accept}


@router.post(
    "/resolve",
    response_model=ResolvedMember,
    dependencies=[Depends(_rate_limit_resolve)],
)
async def resolve_badge(
    data: ResolveBadgeBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*BADGE_SCANNER_PERMISSIONS)),
):
    """The member a scanned badge names, in the caller's organization.

    **Permissions required:** users.view, members.manage,
    members.manage_id_cards or inventory.manage
    """
    user, matched = await MemberBadgeService(db).resolve(
        current_user.organization_id, data.code
    )
    if user is None:
        raise HTTPException(status_code=404, detail="No member found for this badge")
    return {
        "user_id": str(user.id),
        "name": user.display_name or user.username,
        "membership_number": user.membership_number,
        "is_active": bool(user.is_active),
        "matched": matched,
    }


@router.get("/{user_id}", response_model=MemberBadgeResponse)
async def get_member_badge(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """A member's badge code, for their own digital ID card.

    Another member's code is limited to members.manage or
    members.manage_id_cards; anyone else gets 404, so the response does not
    confirm that the member exists.

    **Authentication required**
    """
    if str(current_user.id) != str(user_id) and not _is_badge_officer(current_user):
        raise HTTPException(status_code=404, detail="Member not found")
    service = MemberBadgeService(db)
    user = await service.get_member(current_user.organization_id, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if not user.badge_code:
        await service.ensure_codes([user])
        await db.commit()
    return {"user_id": str(user.id), "badge_code": user.badge_code}


@router.post("/{user_id}/reissue", response_model=MemberBadgeResponse)
async def reissue_member_badge(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*BADGE_OFFICER_PERMISSIONS)),
):
    """Give a member a new badge code; every badge printed before stops scanning.

    **Permissions required:** members.manage or members.manage_id_cards
    """
    user = await MemberBadgeService(db).reissue(current_user.organization_id, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Member not found")
    await log_audit_event(
        db=db,
        event_type="member_badge_reissued",
        event_category="user_management",
        severity="warning",
        event_data={"member_id": str(user.id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return {"user_id": str(user.id), "badge_code": user.badge_code}
