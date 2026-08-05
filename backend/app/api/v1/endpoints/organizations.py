"""
Organizations API Endpoints

Endpoints for organization settings management.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.core.utils import ensure_found, handle_service_errors
from app.models.user import Role, User
from app.schemas.organization import (
    AuthSettings,
    ContactInfoSettings,
    EmailServiceSettings,
    EnabledModulesResponse,
    FileStorageSettings,
    MembershipIdSettings,
    ModuleSettingsUpdate,
    OrganizationProfileUpdate,
    OrganizationSettingsResponse,
    OrganizationSettingsUpdate,
    SetupChecklistItem,
    SetupChecklistResponse,
)
from app.services.org_template_service import OrgTemplateService
from app.services.organization_service import OrganizationService

router = APIRouter()

# Setup checklist items with no measurable completion signal — they ask the
# admin to look something over, and only the admin can say they did. Every
# other item derives completion from entity counts and must not be hand-waved
# complete, so acknowledgment is restricted to this set.
REVIEW_CHECKLIST_KEYS = {"org_settings", "modules"}


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

    # Convert internal model to response schema so we can call .redacted()
    response = OrganizationSettingsResponse.model_validate(
        settings, from_attributes=True
    )

    # SEC: Redact secrets (OAuth client secrets, SMTP passwords, etc.)
    # before returning to the client to prevent credential exfiltration.
    redacted = response.redacted()

    # SEC (ORU-8): this endpoint is open to every authenticated member, so
    # also strip the infrastructure identifiers those secrets authenticate to
    # (mail host, S3 bucket/endpoint, SSO issuer, OAuth tenant/client IDs)
    # unless the caller actually administers settings.
    if not _has_permission("settings.manage", _collect_user_permissions(current_user)):
        redacted = redacted.without_infrastructure()

    # Return as dict so FastAPI's response_model validation preserves
    # extra fields (e.g. station_mode).  Pydantic V2 drops __pydantic_extra__
    # when converting between model instances via model_validate(from_attributes=True).
    return redacted.model_dump()


@router.patch("/settings", response_model=OrganizationSettingsResponse)
async def update_organization_settings(
    settings_update: OrganizationSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "settings.manage",
            "organization.update_settings",
        )
    ),
):
    """
    Update organization settings

    This endpoint requires any of:
    - settings.manage
    - organization.update_settings

    This accepts the full settings body (auth/SSO, SMTP, file-storage, modules,
    IT team). It intentionally does NOT accept the narrow
    `settings.manage_contact_visibility` secretary permission: that permission
    grants only contact-info visibility toggling via `PATCH /settings/contact-info`,
    and allowing it here would let a contact-visibility secretary rewrite auth/SMTP/
    storage secrets and disable modules through the full settings schema.

    **Authentication and permission required**
    """
    org_service = OrganizationService(db)

    # Convert Pydantic model to dict for updating
    settings_dict = settings_update.model_dump(exclude_unset=True)

    # model_dump() already converts nested Pydantic models to dicts,
    # so contact_info_visibility is already in the correct format for JSONB.

    # Update settings
    async with handle_service_errors("Failed to update organization settings"):
        updated_settings = await org_service.update_organization_settings(
            current_user.organization_id, settings_dict
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

        # Convert internal model to response schema and redact secrets.
        # Return as dict to preserve extra fields (see GET /settings comment).
        response = OrganizationSettingsResponse.model_validate(
            updated_settings, from_attributes=True
        )
        return response.redacted().model_dump()


@router.patch("/settings/contact-info", response_model=ContactInfoSettings)
async def update_contact_info_settings(
    contact_settings: ContactInfoSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "settings.manage",
            "settings.manage_contact_visibility",
            "organization.update_settings",
        )
    ),
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

    async with handle_service_errors("Failed to update contact info settings"):
        await org_service.update_organization_settings(
            current_user.organization_id, settings_dict
        )

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


@router.patch("/settings/email", response_model=EmailServiceSettings)
async def update_email_settings(
    email_settings: EmailServiceSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    Update email service settings

    Configure the email platform (Gmail, Microsoft 365, self-hosted SMTP)
    and connection details for sending notifications.

    **Authentication and admin permission required**
    """
    org_service = OrganizationService(db)

    settings_dict = {"email_service": email_settings.model_dump(exclude_unset=False)}

    async with handle_service_errors("Failed to update email settings"):
        await org_service.update_organization_settings(
            current_user.organization_id, settings_dict
        )

        await log_audit_event(
            db=db,
            event_type="organization_settings_updated",
            event_category="administration",
            severity="warning",
            event_data={
                "settings_changed": ["email_service"],
                "email_platform": email_settings.platform,
                "email_enabled": email_settings.enabled,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        # SEC: Redact secrets before returning to the client
        return email_settings.redacted()


@router.patch("/settings/file-storage", response_model=FileStorageSettings)
async def update_file_storage_settings(
    storage_settings: FileStorageSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    Update file storage settings

    Configure the file storage platform (Google Drive, OneDrive, S3, local)
    and connection details.

    **Authentication and admin permission required**
    """
    org_service = OrganizationService(db)

    settings_dict = {"file_storage": storage_settings.model_dump(exclude_unset=False)}

    async with handle_service_errors("Failed to update file storage settings"):
        await org_service.update_organization_settings(
            current_user.organization_id, settings_dict
        )

        await log_audit_event(
            db=db,
            event_type="organization_settings_updated",
            event_category="administration",
            severity="warning",
            event_data={
                "settings_changed": ["file_storage"],
                "storage_platform": storage_settings.platform,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        # SEC: Redact secrets before returning to the client
        return storage_settings.redacted()


@router.patch("/settings/auth", response_model=AuthSettings)
async def update_auth_settings(
    auth_settings: AuthSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    Update authentication settings

    Configure the authentication provider (Google OAuth, Microsoft Azure AD,
    Authentik SSO, or local passwords).

    **Authentication and admin permission required**
    """
    org_service = OrganizationService(db)

    settings_dict = {"auth": auth_settings.model_dump(exclude_unset=False)}

    async with handle_service_errors("Failed to update auth settings"):
        await org_service.update_organization_settings(
            current_user.organization_id, settings_dict
        )

        await log_audit_event(
            db=db,
            event_type="organization_settings_updated",
            event_category="administration",
            severity="warning",
            event_data={
                "settings_changed": ["auth"],
                "auth_provider": auth_settings.provider,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

        # Redact secrets in the response, matching the email/file-storage
        # siblings — never echo SSO client secrets back in a response body/log.
        return auth_settings.redacted()


@router.patch("/settings/membership-id", response_model=MembershipIdSettings)
async def update_membership_id_settings(
    membership_id_settings: MembershipIdSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.edit", "organization.update_settings")
    ),
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

    async with handle_service_errors("Failed to update membership ID settings"):
        await org_service.update_organization_settings(
            current_user.organization_id, settings_dict
        )

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
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    Update module settings for the current organization

    Enable or disable optional modules. Essential modules (members, events,
    documents, roles, settings) are always enabled and cannot be disabled.

    Configurable modules:
    - training: Training & Certifications
    - inventory: Equipment & Inventory
    - scheduling: Scheduling & Shifts
    - apparatus: Apparatus Management
    - communications: Communications
    - elections: Elections & Voting
    - minutes: Meeting Minutes
    - reports: Reports & Analytics
    - notifications: Email Notifications
    - mobile: Mobile App Access
    - forms: Custom Forms
    - integrations: External Integrations
    - facilities: Facilities Management
    - incidents: Incidents & Reports
    - hr_payroll: HR & Payroll
    - grants: Grants & Fundraising
    - prospective_members: Prospective Members Pipeline
    - public_info: Public Information

    **Authentication and admin permission required**
    """
    org_service = OrganizationService(db)

    # Convert to dict, excluding unset values
    module_updates = module_update.model_dump(exclude_unset=True)

    async with handle_service_errors("Failed to update module settings"):
        result = await org_service.update_module_settings(
            current_user.organization_id, module_updates
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
    org_settings = await org_service.get_organization_settings(
        current_user.organization_id
    )
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
    from app.models.apparatus import Apparatus
    from app.models.document import Document, DocumentStatus
    from app.models.event import Event
    from app.models.forms import Form
    from app.models.inventory import InventoryCategory
    from app.models.location import Location
    from app.models.membership_pipeline import MembershipPipeline
    from app.models.notification import NotificationChannel, NotificationLog
    from app.models.training import (
        BasicApparatus,
        ShiftTemplate,
        TrainingCourse,
        TrainingRequirement,
    )

    org_id = str(current_user.organization_id)

    # Run all counts in parallel-ish (sequential awaits, but fast DB queries)
    member_count = (
        await db.execute(
            select(func.count()).select_from(User).where(User.organization_id == org_id)
        )
    ).scalar() or 0

    # Members who have actually signed in at least once. Adding a member row is
    # not the same as that member having working access, and the gap between the
    # two is the most common "we set it up but nobody uses it" failure.
    signed_in_count = (
        await db.execute(
            select(func.count())
            .select_from(User)
            .where(
                User.organization_id == org_id,
                User.last_login_at.isnot(None),
            )
        )
    ).scalar() or 0

    mfa_user_count = (
        await db.execute(
            select(func.count())
            .select_from(User)
            .where(
                User.organization_id == org_id,
                User.mfa_enabled == True,  # noqa: E712
            )
        )
    ).scalar() or 0

    role_count = (
        await db.execute(
            select(func.count()).select_from(Role).where(Role.organization_id == org_id)
        )
    ).scalar() or 0

    # Count from both BasicApparatus and full Apparatus tables
    basic_apparatus_count = (
        await db.execute(
            select(func.count())
            .select_from(BasicApparatus)
            .where(
                BasicApparatus.organization_id == org_id,
                BasicApparatus.is_active == True,
            )  # noqa: E712
        )
    ).scalar() or 0

    full_apparatus_count = 0
    try:
        full_apparatus_count = (
            await db.execute(
                select(func.count())
                .select_from(Apparatus)
                .where(
                    Apparatus.organization_id == org_id,
                    Apparatus.is_archived == False,
                )  # noqa: E712
            )
        ).scalar() or 0
    except Exception as e:
        logger.warning(f"Failed to query full apparatus count for setup checklist: {e}")

    apparatus_count = basic_apparatus_count + full_apparatus_count

    location_count = (
        await db.execute(
            select(func.count())
            .select_from(Location)
            .where(
                Location.organization_id == org_id, Location.is_active == True
            )  # noqa: E712
        )
    ).scalar() or 0

    shift_template_count = (
        await db.execute(
            select(func.count())
            .select_from(ShiftTemplate)
            .where(
                ShiftTemplate.organization_id == org_id, ShiftTemplate.is_active == True
            )  # noqa: E712
        )
    ).scalar() or 0

    course_count = (
        await db.execute(
            select(func.count())
            .select_from(TrainingCourse)
            .where(TrainingCourse.organization_id == org_id)
        )
    ).scalar() or 0

    requirement_count = (
        await db.execute(
            select(func.count())
            .select_from(TrainingRequirement)
            .where(TrainingRequirement.organization_id == org_id)
        )
    ).scalar() or 0

    inventory_category_count = (
        await db.execute(
            select(func.count())
            .select_from(InventoryCategory)
            .where(
                InventoryCategory.organization_id == org_id,
                InventoryCategory.active == True,
            )  # noqa: E712
        )
    ).scalar() or 0

    form_count = 0
    try:
        form_count = (
            await db.execute(
                select(func.count())
                .select_from(Form)
                .where(Form.organization_id == org_id)
            )
        ).scalar() or 0
    except Exception as e:
        logger.warning(f"Failed to query form count for setup checklist: {e}")

    pipeline_count = 0
    try:
        pipeline_count = (
            await db.execute(
                select(func.count())
                .select_from(MembershipPipeline)
                .where(
                    MembershipPipeline.organization_id == org_id,
                    MembershipPipeline.is_active == True,
                )  # noqa: E712
            )
        ).scalar() or 0
    except Exception as e:
        logger.warning(f"Failed to query pipeline count for setup checklist: {e}")

    document_count = (
        await db.execute(
            select(func.count())
            .select_from(Document)
            .where(
                Document.organization_id == org_id,
                Document.status == DocumentStatus.ACTIVE,
            )
        )
    ).scalar() or 0

    event_count = (
        await db.execute(
            select(func.count())
            .select_from(Event)
            .where(Event.organization_id == org_id)
        )
    ).scalar() or 0

    # A configured email service is not a working one — SMTP hosts reject,
    # API keys expire, and departments discover it when the first reminder
    # never arrives. Count messages the mailer confirmed it delivered.
    delivered_email_count = (
        await db.execute(
            select(func.count())
            .select_from(NotificationLog)
            .where(
                NotificationLog.organization_id == org_id,
                NotificationLog.channel == NotificationChannel.EMAIL,
                NotificationLog.delivered == True,  # noqa: E712
            )
        )
    ).scalar() or 0

    # Get organization settings for email/module info
    org_service = OrganizationService(db)
    settings = await org_service.get_organization_settings(current_user.organization_id)
    enabled_modules = settings.modules.get_enabled_modules()
    email_configured = settings.email_service.enabled
    acknowledged = set(settings.setup.acknowledged)

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
            path=(
                "/apparatus-basic"
                if "apparatus" not in enabled_modules
                else "/apparatus"
            ),
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
            is_complete="org_settings" in acknowledged,
            count=0,
            required=True,
            kind="review",
        ),
        SetupChecklistItem(
            key="modules",
            title="Review Enabled Modules",
            description="Enable the modules your department needs: training, scheduling, inventory, forms, and more.",
            path="/settings?tab=modules",
            category="essential",
            is_complete="modules" in acknowledged,
            count=len(enabled_modules),
            required=True,
            kind="review",
        ),
        SetupChecklistItem(
            key="members_signed_in",
            title="Get Members Signed In",
            description="Send member logins and confirm they can sign in. Adding a member to the roster does not give them access on its own.",
            path="/members/admin",
            category="essential",
            is_complete=signed_in_count > 1,
            count=signed_in_count,
            required=True,
        ),
        SetupChecklistItem(
            key="documents",
            title="Upload SOPs & Policies",
            description="Add your standard operating procedures, bylaws, and policy documents so members can find them in one place.",
            path="/documents",
            category="essential",
            is_complete=document_count > 0,
            count=document_count,
            required=True,
        ),
        SetupChecklistItem(
            key="events",
            title="Schedule Your First Event",
            description="Create a drill, business meeting, or training so members have something to RSVP to and check in against.",
            path="/events",
            category="essential",
            is_complete=event_count > 0,
            count=event_count,
            required=True,
        ),
        SetupChecklistItem(
            key="mfa",
            title="Enable Multi-Factor Authentication",
            description="Turn on MFA for administrators. This system holds protected health information, and admin accounts are the highest-value target.",
            path="/account?tab=security",
            category="essential",
            is_complete=mfa_user_count > 0,
            count=mfa_user_count,
            required=True,
        ),
    ]

    # Module-specific items (only shown if module is enabled)
    if "scheduling" in enabled_modules:
        items.append(
            SetupChecklistItem(
                key="scheduling",
                title="Create Shift Templates",
                description="Define reusable shift templates (Day Shift, Night Shift, etc.) for faster schedule building.",
                path="/scheduling",
                category="scheduling",
                is_complete=shift_template_count > 0,
                count=shift_template_count,
                required=False,
            )
        )

    if "training" in enabled_modules:
        items.append(
            SetupChecklistItem(
                key="training",
                title="Set Up Training Courses & Requirements",
                description="Create training courses, set certification requirements, and define expiration periods.",
                path="/training/admin",
                category="training",
                is_complete=course_count > 0,
                count=course_count,
                required=False,
            )
        )
        items.append(
            SetupChecklistItem(
                key="training_requirements",
                title="Add Training Requirements",
                description="Define mandatory training requirements such as state certifications, NFPA standards, and department-specific courses.",
                path="/training/admin?page=setup&tab=requirements",
                category="training",
                is_complete=requirement_count > 0,
                count=requirement_count,
                required=False,
            )
        )

    if "inventory" in enabled_modules:
        items.append(
            SetupChecklistItem(
                key="inventory",
                title="Set Up Inventory Categories",
                description="Create equipment categories (PPE, tools, uniforms, etc.) so items can be tracked and assigned to members.",
                path="/inventory/admin",
                category="inventory",
                is_complete=inventory_category_count > 0,
                count=inventory_category_count,
                required=False,
            )
        )

    if "forms" in enabled_modules:
        items.append(
            SetupChecklistItem(
                key="forms",
                title="Create Custom Forms",
                description="Build forms for shift checkouts, equipment inspections, surveys, and other data collection.",
                path="/forms",
                category="forms",
                is_complete=form_count > 0,
                count=form_count,
                required=False,
            )
        )

    if "notifications" in enabled_modules:
        items.append(
            SetupChecklistItem(
                key="email",
                title="Configure & Verify Email Delivery",
                description=(
                    "Set up your email service, then send a test message to confirm it "
                    "actually delivers before members start relying on reminders."
                    if not email_configured
                    else "Email is configured. Send a test message to confirm it delivers."
                ),
                path="/settings",
                category="notifications",
                is_complete=email_configured and delivered_email_count > 0,
                count=delivered_email_count,
                required=False,
            )
        )

    if "prospective_members" in enabled_modules:
        items.append(
            SetupChecklistItem(
                key="pipeline",
                title="Configure Prospective Members Pipeline",
                description="Define the stages applicants go through from initial interest to full membership.",
                path="/prospective-members/settings",
                category="prospective_members",
                is_complete=pipeline_count > 0,
                count=pipeline_count,
                required=False,
            )
        )

    if "integrations" in enabled_modules:
        items.append(
            SetupChecklistItem(
                key="integrations",
                title="Set Up Integrations",
                description="Connect external services like Google Calendar, Slack, or other tools your department uses.",
                path="/integrations",
                category="integrations",
                is_complete=False,
                count=0,
                required=False,
            )
        )

    completed_count = sum(1 for item in items if item.is_complete)

    return SetupChecklistResponse(
        items=items,
        completed_count=completed_count,
        total_count=len(items),
        enabled_modules=enabled_modules,
    )


@router.post("/setup-checklist/{item_key}/acknowledge")
async def acknowledge_setup_checklist_item(
    item_key: str,
    acknowledged: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
):
    """
    Mark a review-type setup checklist item as reviewed (or clear that mark).

    Only items with `kind == "review"` can be acknowledged. Items whose
    completion is derived from entity counts must be completed by doing the
    work, not by asserting it was done.

    **Requires `settings.manage`**
    """
    if item_key not in REVIEW_CHECKLIST_KEYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{item_key}' is not a review checklist item. "
                "Only review items can be acknowledged."
            ),
        )

    org_service = OrganizationService(db)
    settings = await org_service.get_organization_settings(current_user.organization_id)

    keys = set(settings.setup.acknowledged)
    if acknowledged:
        keys.add(item_key)
    else:
        keys.discard(item_key)

    updated = await org_service.update_organization_settings(
        current_user.organization_id,
        {"setup": {"acknowledged": sorted(keys)}},
    )

    return {
        "item_key": item_key,
        "acknowledged": item_key in updated.setup.acknowledged,
    }


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


@router.get("/profile")
async def get_organization_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get organization profile details (name, timezone, logo, contact, address).
    Accessible by any authenticated user.
    """
    from app.models.user import Organization

    result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = ensure_found(result.scalar_one_or_none(), "Organization")

    return {
        "name": org.name,
        "timezone": org.timezone or "America/New_York",
        "phone": org.phone or "",
        "email": org.email or "",
        "website": org.website or "",
        "county": org.county or "",
        "founded_year": org.founded_year,
        "logo": org.logo,
        "mailing_address": {
            "line1": org.mailing_address_line1 or "",
            "line2": org.mailing_address_line2 or "",
            "city": org.mailing_city or "",
            "state": org.mailing_state or "",
            "zip": org.mailing_zip or "",
        },
        "physical_address_same": (
            org.physical_address_same if org.physical_address_same is not None else True
        ),
        "physical_address": {
            "line1": org.physical_address_line1 or "",
            "line2": org.physical_address_line2 or "",
            "city": org.physical_city or "",
            "state": org.physical_state or "",
            "zip": org.physical_zip or "",
        },
    }


@router.patch("/profile")
async def update_organization_profile(
    updates: OrganizationProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
):
    """
    Update organization profile details.
    Requires settings.manage permission.
    """

    from app.models.user import Organization

    result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = ensure_found(result.scalar_one_or_none(), "Organization")

    # Apply validated scalar fields (only those explicitly provided)
    update_data = updates.model_dump(
        exclude_unset=True, exclude={"mailing_address", "physical_address"}
    )
    for field, value in update_data.items():
        setattr(org, field, value)

    # Handle mailing address
    if updates.mailing_address is not None:
        addr = updates.mailing_address.model_dump(exclude_unset=True)
        field_map = {
            "line1": "mailing_address_line1",
            "line2": "mailing_address_line2",
            "city": "mailing_city",
            "state": "mailing_state",
            "zip": "mailing_zip",
        }
        for key, value in addr.items():
            setattr(org, field_map[key], value)

    # Handle physical address
    if updates.physical_address is not None:
        addr = updates.physical_address.model_dump(exclude_unset=True)
        field_map = {
            "line1": "physical_address_line1",
            "line2": "physical_address_line2",
            "city": "physical_city",
            "state": "physical_state",
            "zip": "physical_zip",
        }
        for key, value in addr.items():
            setattr(org, field_map[key], value)

    await db.commit()
    await db.refresh(org)

    # Also update localStorage branding for the caller
    await log_audit_event(
        db=db,
        event_type="organization.profile_updated",
        event_category="administration",
        severity="info",
        event_data={
            "fields_changed": list(updates.model_dump(exclude_unset=True).keys())
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "name": org.name,
        "timezone": org.timezone or "America/New_York",
        "phone": org.phone or "",
        "email": org.email or "",
        "website": org.website or "",
        "county": org.county or "",
        "founded_year": org.founded_year,
        "logo": org.logo,
        "mailing_address": {
            "line1": org.mailing_address_line1 or "",
            "line2": org.mailing_address_line2 or "",
            "city": org.mailing_city or "",
            "state": org.mailing_state or "",
            "zip": org.mailing_zip or "",
        },
        "physical_address_same": (
            org.physical_address_same if org.physical_address_same is not None else True
        ),
        "physical_address": {
            "line1": org.physical_address_line1 or "",
            "line2": org.physical_address_line2 or "",
            "city": org.physical_city or "",
            "state": org.physical_state or "",
            "zip": org.physical_zip or "",
        },
    }


@router.get("/template/export")
async def export_department_template(
    modules: str | None = Query(
        None,
        description="Comma-separated module names to export; all when omitted.",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("organization.template.manage")),
) -> Response:
    """
    Export this department's structural template as a downloadable ``.zip``.

    Restricted to the System Owner (``organization.template.manage``). Contains
    configuration/definitions only — no members, PHI, history, or secrets — and
    is always scoped to the caller's own organization.
    """
    module_names: set[str] | None = None
    if modules:
        module_names = {m.strip() for m in modules.split(",") if m.strip()}

    service = OrgTemplateService(db)
    async with handle_service_errors("Failed to export department template"):
        zip_bytes, filename, manifest = await service.export_template(
            str(current_user.organization_id), module_names
        )
        await log_audit_event(
            db=db,
            event_type="organization_template_exported",
            event_category="administration",
            severity="warning",
            event_data={
                "modules": manifest.get("modules"),
                "tables": manifest.get("tables", {}),
                "data_sha256": manifest.get("data_sha256"),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


@router.get("/retention-policy")
async def get_retention_policy(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    The organization's records-retention schedule: every managed record
    class with its default, floor, and effective setting. Documents and
    meeting minutes are deliberately not auto-deleted — see
    retention_service.py for the rationale.
    """
    from app.models.user import Organization
    from app.services.retention_service import RetentionService

    org = await db.get(Organization, str(current_user.organization_id))
    ensure_found(org, "Organization")
    return RetentionService(db).get_policy(org)


@router.put("/retention-policy/{record_class}")
async def set_retention_policy(
    record_class: str,
    request: Request,
    days: int | None = Query(
        default=None,
        ge=0,
        description="Retention in days; omit for keep-forever",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    Set one record class's retention. Enforced daily by the
    retention_enforcement task; class floors prevent accidental
    short-retention foot-guns.
    """
    from app.models.user import Organization
    from app.services.retention_service import RetentionService

    org = await db.get(Organization, str(current_user.organization_id))
    ensure_found(org, "Organization")

    try:
        result = await RetentionService(db).set_policy(org, record_class, days)
    except ValueError as e:
        from fastapi import HTTPException
        from fastapi import status as http_status

        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(e))

    await log_audit_event(
        db=db,
        event_type="retention_policy_updated",
        event_category="security",
        severity="info",
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        ip_address=get_client_ip(request),
        event_data={"record_class": record_class, "days": days},
    )
    await db.commit()
    return result
