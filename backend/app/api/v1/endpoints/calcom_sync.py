"""
Cal.com API Endpoints

Authenticated helpers for using a connected Cal.com integration beyond the
membership pipeline — e.g. surfacing upcoming bookings (interviews, station
tours, inspections) in the scheduling UI.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.integration import Integration
from app.models.user import User
from app.services.integration_services.calcom_service import CalcomService

router = APIRouter()


async def _get_calcom_integration(
    db: AsyncSession, organization_id: str
) -> Integration:
    """Load the connected Cal.com integration or raise 404."""
    result = await db.execute(
        select(Integration).where(
            Integration.organization_id == organization_id,
            Integration.integration_type == "calcom",
            Integration.enabled.is_(True),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cal.com is not connected",
        )
    return integration


@router.get("/bookings")
async def list_calcom_bookings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Return upcoming Cal.com bookings mapped to Logbook event shape."""
    integration = await _get_calcom_integration(
        db, str(current_user.organization_id)
    )
    api_key = integration.get_secret("api_key")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cal.com API key is not configured",
        )

    service = CalcomService(
        {
            "api_base_url": (integration.config or {}).get("api_base_url", ""),
            "api_key": api_key,
        }
    )
    try:
        bookings = await service.list_bookings()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=safe_error_detail(e),
        )
    return {"bookings": bookings}
