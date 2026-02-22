"""
Organizations API Endpoints

Endpoints for organization settings management.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.schemas.organization import (
    OrganizationSettingsResponse,
    OrganizationSettingsUpdate,
    ContactInfoSettings,
    MembershipIdSettings,
    EnabledModulesResponse,
    ModuleSettingsUpdate,
    SetupChecklistResponse,
    SetupChecklistItem,
)
from app.services.organization_service import OrganizationService
from app.api.dependencies import get_current_user, require_permission
from app.models.user import User, Role


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

    # Return as dict so FastAPI's response_model validation preserves
    # extra fields (e.g. station_mode).  Pydantic V2 drops __pydantic_extra__
    # when converting between model instances via model_validate(from_attributes=True).
    return settings.model_dump()


@router.patch("/settings", response_model=OrganizationSettingsResponse)
async def update_organization_settings(
    settings_update: OrganizationSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage", "settings.manage_contact_visibility", "organization.update_settings")),
):
    """
    Update organization settings

    This endpoint requires any of:
    - settings.manage
    - settings.manage_contact_visibility
    - organization.update_settings

    Secretary users can toggle the contact information visibility feature on/off,
    and control which specific contact fields (email, phone, mobile) are displayed.

    **Authentication and permission required**
    """
    org_service = OrganizationService(db)

    # Convert Pydantic model to dict for updating
    settings_dict = settings_update.model_dump(exclude_unset=True)

    # model_dump() already converts nested Pydantic models to dicts,
    # so contact_info_visibility is already in the correct format for JSONB.

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

        # Return as dict to preserve extra fields (see GET /settings comment).
        return updated_settings.model_dump()
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.patch("/settings/contact-info", response_model=ContactInfoSettings)
async def update_contact_info_settings(
    contact_settings: ContactInfoSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage", "settings.manage_contact_visibility", "organization.update_settings")),
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


@router.patch("/settings/membership-id", response_model=MembershipIdSettings)
async def update_membership_id_settings(
    membership_id_settings: MembershipIdSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.edit", "organization.update_settings")),
):
    """
    Update membership ID number settings

    Configure whether membership IDs are enabled, auto-generated, and their format.

    **Authentication and permission required**
    """
    org_service = OrganizationService(db)

    settings_dict = {
        "membership_id": {
            "enabled": membership_id_settings.enabled,
            "auto_generate": membership_id_settings.auto_generate,
            "prefix": membership_id_settings.prefix,
            "next_number": membership_id_settings.next_number,
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
                "settings_changed": ["membership_id"],
                "membership_id_enabled": membership_id_settings.enabled,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        return membership_id_settings
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


@router.get("/settings/membership-id", response_model=MembershipIdSettings)
async def get_membership_id_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get membership ID settings for the organization.

    **Authentication required**
    """
    org_service = OrganizationService(db)
    return await org_service.get_membership_id_settings(current_user.organization_id)




@router.get("/settings/membership-id/preview")
async def preview_next_membership_id(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Preview the next membership ID that would be assigned without incrementing.

    **Authentication required**
    """
    org_service = OrganizationService(db)
    org_settings = await org_service.get_organization_settings(current_user.organization_id)
    membership_id_settings = org_settings.membership_id

    if not membership_id_settings.enabled:
        return {"enabled": False, "next_id": None}

    number_str = str(membership_id_settings.next_number).zfill(4)
    next_id = f"{membership_id_settings.prefix}{number_str}"
    return {"enabled": True, "next_id": next_id}


@router.get("/setup-checklist", response_model=SetupChecklistResponse)
async def get_setup_checklist(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the department setup checklist with completion status.

    Queries entity counts to determine which setup steps have been completed.
    Used by the Department Setup page to guide administrators through
    post-onboarding configuration.

    **Authentication required**
    """
    from app.models.user import Organization
    from app.models.training import (
        BasicApparatus, Shift, ShiftTemplate,
        TrainingCourse,
    )
    from app.models.location import Location
    from app.models.forms import Form
    from app.models.membership_pipeline import MembershipPipeline

    org_id = str(current_user.organization_id)

    # Run all counts in parallel-ish (sequential awaits, but fast DB queries)
    member_count = (await db.execute(
        select(func.count()).select_from(User).where(User.organization_id == org_id)
    )).scalar() or 0

    role_count = (await db.execute(
        select(func.count()).select_from(Role).where(Role.organization_id == org_id)
    )).scalar() or 0

    apparatus_count = (await db.execute(
        select(func.count()).select_from(BasicApparatus)
        .where(BasicApparatus.organization_id == org_id, BasicApparatus.is_active == True)  # noqa: E712
    )).scalar() or 0

    location_count = (await db.execute(
        select(func.count()).select_from(Location)
        .where(Location.organization_id == org_id, Location.is_active == True)  # noqa: E712
    )).scalar() or 0

    shift_template_count = (await db.execute(
        select(func.count()).select_from(ShiftTemplate)
        .where(ShiftTemplate.organization_id == org_id, ShiftTemplate.is_active == True)  # noqa: E712
    )).scalar() or 0

    course_count = (await db.execute(
        select(func.count()).select_from(TrainingCourse)
        .where(TrainingCourse.organization_id == org_id)
    )).scalar() or 0

    form_count = 0
    try:
        form_count = (await db.execute(
            select(func.count()).select_from(Form)
            .where(Form.organization_id == org_id)
        )).scalar() or 0
    except Exception as e:
        logger.warning(f"Failed to query form count for setup checklist: {e}")

    pipeline_count = 0
    try:
        pipeline_count = (await db.execute(
            select(func.count()).select_from(MembershipPipeline)
            .where(MembershipPipeline.organization_id == org_id, MembershipPipeline.is_active == True)  # noqa: E712
        )).scalar() or 0
    except Exception as e:
        logger.warning(f"Failed to query pipeline count for setup checklist: {e}")

    # Get organization settings for email/module info
    org_service = OrganizationService(db)
    settings = await org_service.get_organization_settings(current_user.organization_id)
    enabled_modules = settings.modules.get_enabled_modules()
    email_configured = settings.email_service.enabled

    # Build the checklist items
    items = [
        SetupChecklistItem(
            key="members",
            title="Add Department Members",
            description="Import or manually add your department roster. Members need accounts to use the system.",
            path="/members/admin",
            category="essential",
            is_complete=member_count > 1,
            count=member_count,
            required=True,
        ),
        SetupChecklistItem(
            key="roles",
            title="Review Roles & Permissions",
            description="Verify role assignments and fine-tune permissions for each role in your department.",
            path="/settings/roles",
            category="essential",
            is_complete=role_count >= 2,
            count=role_count,
            required=True,
        ),
        SetupChecklistItem(
            key="apparatus",
            title="Set Up Apparatus & Vehicles",
            description="Define your apparatus with unit numbers, types, and crew positions for shift staffing.",
            path="/apparatus-basic" if "apparatus" not in enabled_modules else "/apparatus",
            category="essential",
            is_complete=apparatus_count > 0,
            count=apparatus_count,
            required=True,
        ),
        SetupChecklistItem(
            key="locations",
            title="Set Up Stations & Locations",
            description="Add your stations and rooms for event check-in, scheduling, and resource management.",
            path="/locations" if "facilities" not in enabled_modules else "/facilities",
            category="essential",
            is_complete=location_count > 0,
            count=location_count,
            required=True,
        ),
        SetupChecklistItem(
            key="org_settings",
            title="Review Organization Settings",
            description="Verify department contact info, membership ID format, and contact visibility preferences.",
            path="/settings",
            category="essential",
            is_complete=True,
            count=0,
            required=True,
        ),
    ]

    # Module-specific items (only shown if module is enabled)
    if "scheduling" in enabled_modules:
        items.append(SetupChecklistItem(
            key="scheduling",
            title="Create Shift Templates",
            description="Define reusable shift templates (Day Shift, Night Shift, etc.) for faster schedule building.",
            path="/scheduling",
            category="scheduling",
            is_complete=shift_template_count > 0,
            count=shift_template_count,
            required=False,
        ))

    if "training" in enabled_modules:
        items.append(SetupChecklistItem(
            key="training",
            title="Set Up Training Courses & Requirements",
            description="Create training courses, set certification requirements, and define expiration periods.",
            path="/training/admin",
            category="training",
            is_complete=course_count > 0,
            count=course_count,
            required=False,
        ))

    if "forms" in enabled_modules:
        items.append(SetupChecklistItem(
            key="forms",
            title="Create Custom Forms",
            description="Build forms for shift checkouts, equipment inspections, surveys, and other data collection.",
            path="/forms",
            category="forms",
            is_complete=form_count > 0,
            count=form_count,
            required=False,
        ))

    if "notifications" in enabled_modules:
        items.append(SetupChecklistItem(
            key="email",
            title="Configure Email Notifications",
            description="Set up SMTP/email service so the system can send notifications, reminders, and alerts.",
            path="/settings",
            category="notifications",
            is_complete=email_configured,
            count=1 if email_configured else 0,
            required=False,
        ))

    if "prospective_members" in enabled_modules or True:
        items.append(SetupChecklistItem(
            key="pipeline",
            title="Configure Prospective Members Pipeline",
            description="Define the stages applicants go through from initial interest to full membership.",
            path="/prospective-members/settings",
            category="prospective_members",
            is_complete=pipeline_count > 0,
            count=pipeline_count,
            required=False,
        ))

    if "integrations" in enabled_modules:
        items.append(SetupChecklistItem(
            key="integrations",
            title="Set Up Integrations",
            description="Connect external services like Google Calendar, Slack, or other tools your department uses.",
            path="/integrations",
            category="integrations",
            is_complete=False,
            count=0,
            required=False,
        ))

    completed_count = sum(1 for item in items if item.is_complete)

    return SetupChecklistResponse(
        items=items,
        completed_count=completed_count,
        total_count=len(items),
        enabled_modules=enabled_modules,
    )


@router.get("/address")
async def get_organization_address(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the organization's physical/mailing address.
    Used by the location wizard to pre-fill the single-station address.
    """
    from app.models.user import Organization

    result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = result.scalar_one_or_none()
    if not org:
        return {"address": "", "city": "", "state": "", "zip": ""}

    # Prefer physical address; fall back to mailing address
    if org.physical_address_line1 and not org.physical_address_same:
        return {
            "address": org.physical_address_line1 or "",
            "city": org.physical_city or "",
            "state": org.physical_state or "",
            "zip": org.physical_zip or "",
        }
    return {
        "address": org.mailing_address_line1 or "",
        "city": org.mailing_city or "",
        "state": org.mailing_state or "",
        "zip": org.mailing_zip or "",
    }
