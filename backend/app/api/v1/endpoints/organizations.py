"""
Organizations API Endpoints

Endpoints for organization settings management.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.schemas.organization import (
    OrganizationSettingsResponse,
    OrganizationSettingsUpdate,
    ContactInfoSettings,
    EnabledModulesResponse,
    ModuleSettingsUpdate,
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

        await log_audit_event(
            db=db,
            event_type="organization_settings_updated",
            event_category="administration",
            severity="warning",
            event_data={
                "settings_changed": list(settings_dict.keys()),
            },
            user_id=str(current_user.id),
            username=current_user.username,
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

        await log_audit_event(
            db=db,
            event_type="organization_settings_updated",
            event_category="administration",
            severity="warning",
            event_data={
                "settings_changed": ["contact_info_visibility"],
                "contact_info_enabled": contact_settings.enabled,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        return contact_settings
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.get("/modules", response_model=EnabledModulesResponse)
async def get_enabled_modules(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get enabled modules for the current organization

    Returns the list of module IDs that are enabled for this organization.
    This is used to conditionally display module-specific UI components.

    **Authentication required**
    """
    org_service = OrganizationService(db)
    return await org_service.get_enabled_modules(current_user.organization_id)


@router.patch("/modules", response_model=EnabledModulesResponse)
async def update_module_settings(
    module_update: ModuleSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage", "organization.update_settings")),
):
    """
    Update module settings for the current organization

    Enable or disable optional modules. Essential modules (members, events,
    documents, roles, settings) are always enabled and cannot be disabled.

    Configurable modules:
    - training: Training & Certifications
    - inventory: Equipment & Inventory
    - scheduling: Scheduling & Shifts
    - elections: Elections & Voting
    - minutes: Meeting Minutes
    - reports: Reports & Analytics
    - notifications: Email Notifications
    - mobile: Mobile App Access
    - forms: Custom Forms
    - integrations: External Integrations

    **Authentication and admin permission required**
    """
    org_service = OrganizationService(db)

    # Convert to dict, excluding unset values
    module_updates = module_update.model_dump(exclude_unset=True)

    try:
        result = await org_service.update_module_settings(
            current_user.organization_id,
            module_updates
        )

        await log_audit_event(
            db=db,
            event_type="organization_settings_updated",
            event_category="administration",
            severity="warning",
            event_data={
                "settings_changed": ["modules"],
                "module_updates": module_updates,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
