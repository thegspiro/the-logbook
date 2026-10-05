"""
Member ID card printing (CR80 plastic cards).

Gated on the two grants that already decide who may see another member's
badge: ``members.manage`` and ``members.manage_id_cards``. A printed card is
that badge in a form that leaves the building, so it cannot be looser than the
on-screen view (``utils/memberIdCardAccess.ts`` on the frontend).
"""

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.services.member_id_card_service import (
    MAX_CARDS_PER_JOB,
    MemberIdCardService,
)

router = APIRouter()

ID_CARD_PERMISSIONS = ("members.manage", "members.manage_id_cards")

UserId = Annotated[str, StringConstraints(min_length=1, max_length=36)]
Option = Annotated[str, StringConstraints(min_length=1, max_length=20)]


class IdCardLayout(BaseModel):
    orientation: Option
    sides: Option
    symbology: Option


class IdCardPrintBody(BaseModel):
    user_ids: List[UserId] = Field(min_length=1, max_length=MAX_CARDS_PER_JOB)
    # Omitted options take the department's saved layout.
    orientation: Optional[Option] = None
    sides: Optional[Option] = None
    symbology: Optional[Option] = None


@router.get("/layout", response_model=IdCardLayout)
async def get_id_card_layout(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*ID_CARD_PERMISSIONS)),
):
    """The department's saved ID card layout, or the default when none is saved.

    **Permissions required:** members.manage or members.manage_id_cards
    """
    try:
        return await MemberIdCardService(db).get_layout(current_user.organization_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=safe_error_detail(e))


@router.put("/layout", response_model=IdCardLayout)
async def save_id_card_layout(
    data: IdCardLayout,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*ID_CARD_PERMISSIONS)),
):
    """Save the department's ID card layout (orientation, sides, symbology).

    **Permissions required:** members.manage or members.manage_id_cards
    """
    try:
        layout = await MemberIdCardService(db).save_layout(
            current_user.organization_id,
            data.orientation,
            data.sides,
            data.symbology,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await log_audit_event(
        db=db,
        event_type="id_card_layout_updated",
        event_category="settings",
        severity="info",
        event_data=layout,
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return layout


@router.post("/pdf")
async def print_id_cards(
    data: IdCardPrintBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*ID_CARD_PERMISSIONS)),
):
    """Render CR80 ID cards for the selected members as a PDF.

    One page per card side, sized to the card, for any ID card printer's
    ordinary driver.

    **Permissions required:** members.manage or members.manage_id_cards
    """
    try:
        pdf, count = await MemberIdCardService(db).generate(
            current_user.organization_id,
            data.user_ids,
            data.orientation,
            data.sides,
            data.symbology,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    # Each card is a credential that scans as its member, so who printed whose
    # cards is recorded the way label badges for members already are.
    await log_audit_event(
        db=db,
        event_type="id_cards_printed",
        event_category="data_access",
        severity="info",
        event_data={"count": count},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return Response(
        content=pdf.getvalue(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="member-id-cards.pdf"',
            "Cache-Control": "no-store",
        },
    )
