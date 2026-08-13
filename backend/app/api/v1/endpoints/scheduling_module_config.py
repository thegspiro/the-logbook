"""
Scheduling Module Configuration API Endpoints

GET    /        - Any authenticated member can read the department shift
                  settings (they drive template forms and position pickers)
PUT    /        - Scheduling managers replace the department shift settings
DELETE /        - Scheduling managers reset the settings to built-in defaults
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.scheduling_module_config import (
    ShiftSettingsResponse,
    ShiftSettingsSchema,
)
from app.services.scheduling_module_config_service import (
    SchedulingModuleConfigService,
)

router = APIRouter()


@router.get("", response_model=ShiftSettingsResponse)
async def get_shift_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Department-wide shift settings (defaults when the org never saved)."""
    service = SchedulingModuleConfigService(db)
    settings, row = await service.get_settings(current_user.organization_id)
    return ShiftSettingsResponse(
        settings=ShiftSettingsSchema(**settings),
        stored=row is not None,
        updated_by=str(row.updated_by) if row and row.updated_by else None,
    )


@router.put("", response_model=ShiftSettingsResponse)
async def update_shift_settings(
    payload: ShiftSettingsSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Replace the department-wide shift settings (scheduling managers)."""
    service = SchedulingModuleConfigService(db)
    try:
        settings = await service.update_settings(
            organization_id=current_user.organization_id,
            payload=payload,
            updated_by=str(current_user.id),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    return ShiftSettingsResponse(
        settings=ShiftSettingsSchema(**settings),
        stored=True,
        updated_by=str(current_user.id),
    )


@router.delete("", response_model=ShiftSettingsResponse)
async def reset_shift_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Reset the department shift settings back to the built-in defaults."""
    service = SchedulingModuleConfigService(db)
    await service.reset_settings(current_user.organization_id)
    settings, _ = await service.get_settings(current_user.organization_id)
    return ShiftSettingsResponse(
        settings=ShiftSettingsSchema(**settings),
        stored=False,
        updated_by=None,
    )
