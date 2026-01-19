"""
Organizations API Endpoints

Endpoints for organization settings management.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.organization import (
    OrganizationSettingsResponse,
    OrganizationSettingsUpdate,
    ContactInfoSettings,
)
from app.services.organization_service import OrganizationService
from app.api.dependencies import get_current_user, require_permission
from app.models.user import User


router = APIRouter()


@router.get("/settings", response_model=OrganizationSettingsResponse)
async def get_organization_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get organization settings

    Returns all organization settings including contact info visibility settings.

    **Authentication required**
    """
    org_service = OrganizationService(db)
    settings = await org_service.get_organization_settings(current_user.organization_id)

    return settings


@router.patch("/settings", response_model=OrganizationSettingsResponse)
async def update_organization_settings(
    settings_update: OrganizationSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage_contact_visibility", "organization.update_settings")),
):
    """
    Update organization settings

    This endpoint requires secretary permissions:
    - settings.manage_contact_visibility
    - organization.update_settings

    Secretary users can toggle the contact information visibility feature on/off,
    and control which specific contact fields (email, phone, mobile) are displayed.

    **Authentication and permission required**
    """
    org_service = OrganizationService(db)

    # Convert Pydantic model to dict for updating
    settings_dict = settings_update.model_dump(exclude_unset=True)

    # Convert nested contact_info_visibility to dict format for JSONB
    if "contact_info_visibility" in settings_dict:
        contact_info = settings_dict["contact_info_visibility"]
        settings_dict["contact_info_visibility"] = {
            "enabled": contact_info.enabled,
            "show_email": contact_info.show_email,
            "show_phone": contact_info.show_phone,
            "show_mobile": contact_info.show_mobile,
        }

    # Update settings
    try:
        updated_settings = await org_service.update_organization_settings(
            current_user.organization_id,
            settings_dict
        )
        return updated_settings
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.patch("/settings/contact-info", response_model=ContactInfoSettings)
async def update_contact_info_settings(
    contact_settings: ContactInfoSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage_contact_visibility", "organization.update_settings")),
):
    """
    Update contact information visibility settings

    This is a convenience endpoint specifically for updating contact info settings.
    Requires secretary permissions.

    **Authentication and permission required**
    """
    org_service = OrganizationService(db)

    # Update just the contact info visibility settings
    settings_dict = {
        "contact_info_visibility": {
            "enabled": contact_settings.enabled,
            "show_email": contact_settings.show_email,
            "show_phone": contact_settings.show_phone,
            "show_mobile": contact_settings.show_mobile,
        }
    }

    try:
        await org_service.update_organization_settings(current_user.organization_id, settings_dict)
        return contact_settings
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
