"""
Onboarding API Endpoints

Handles first-time system setup and configuration.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, EmailStr, Field, validator
from loguru import logger
import re
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import asyncio
from functools import partial

from app.core.database import get_db
from app.core.security_middleware import check_rate_limit
from app.services.onboarding import OnboardingService
from app.services.auth_service import AuthService
from app.models.onboarding import OnboardingStatus, OnboardingChecklistItem, OnboardingSessionModel
from app.api.v1.email_test_helper import test_smtp_connection, test_gmail_oauth, test_microsoft_oauth
from app.schemas.organization import OrganizationSetupCreate, OrganizationSetupResponse
from app.utils.image_validator import validate_logo_image
from datetime import datetime, timedelta
import secrets


router = APIRouter(prefix="/onboarding", tags=["onboarding"])


# ============================================
# Request/Response Models
# ============================================

class OnboardingStatusResponse(BaseModel):
    """Response model for onboarding status"""
    needs_onboarding: bool
    is_completed: bool
    current_step: int
    total_steps: int
    steps_completed: dict
    organization_name: Optional[str]

    class Config:
        from_attributes = True


class SecurityCheckResponse(BaseModel):
    """Response for security configuration check"""
    passed: bool
    issues: List[dict]
    warnings: List[dict]
    total_issues: int
    total_warnings: int


class OrganizationCreate(BaseModel):
    """Request model for creating organization"""
    name: str = Field(..., min_length=2, max_length=255, description="Organization name")
    slug: str = Field(..., min_length=2, max_length=100, description="URL-friendly slug")
    organization_type: str = Field(default="fire_department", description="Type of organization")
    timezone: str = Field(default="America/New_York")

    @validator('slug')
    def validate_slug(cls, v):
        if not re.match(r'^[a-z0-9-_]+$', v):
            raise ValueError('Slug must contain only lowercase letters, numbers, hyphens, and underscores')
        return v

    @validator('organization_type')
    def validate_org_type(cls, v):
        # Must match OrganizationType enum values in models/user.py
        valid_types = ['fire_department', 'ems_only', 'fire_ems_combined']
        if v not in valid_types:
            raise ValueError(f'Organization type must be one of: {", ".join(valid_types)}')
        return v


class OrganizationResponse(BaseModel):
    """Response model for organization"""
    id: str
    name: str
    slug: str
    type: str
    description: Optional[str]
    active: bool

    class Config:
        from_attributes = True


class SystemOwnerCreate(BaseModel):
    """Request model for creating the System Owner (IT Manager) user"""
    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=12)
    password_confirm: str = Field(..., min_length=12)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    badge_number: Optional[str] = Field(None, max_length=50)

    @validator('password_confirm')
    def passwords_match(cls, v, values):
        if 'password' in values and v != values['password']:
            raise ValueError('Passwords do not match')
        return v

    @validator('username')
    def validate_username(cls, v):
        if not re.match(r'^[a-zA-Z0-9_-]+$', v):
            raise ValueError('Username can only contain letters, numbers, hyphens, and underscores')
        return v


class UserResponse(BaseModel):
    """Response model for user"""
    id: str
    username: str
    email: str
    first_name: str
    last_name: str
    badge_number: Optional[str]
    status: str

    class Config:
        from_attributes = True


class SystemOwnerResponse(BaseModel):
    """Response model for System Owner creation with access token"""
    id: str
    username: str
    email: str
    first_name: str
    last_name: str
    badge_number: Optional[str]
    status: str
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"

    class Config:
        from_attributes = True


class ModulesConfig(BaseModel):
    """Request model for module configuration"""
    enabled_modules: List[str] = Field(default_factory=list)


class NotificationsConfig(BaseModel):
    """Request model for notifications configuration"""
    email_enabled: bool = False
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_from_email: Optional[EmailStr] = None

    sms_enabled: bool = False
    twilio_account_sid: Optional[str] = None
    twilio_phone_number: Optional[str] = None


class CompleteOnboardingRequest(BaseModel):
    """Request model for completing onboarding"""
    notes: Optional[str] = Field(None, max_length=2000)


class SystemInfoResponse(BaseModel):
    """Response model for system information"""
    app_name: str
    version: str
    environment: str
    database: dict
    security: dict
    features: dict


class DatabaseCheckResponse(BaseModel):
    """Response model for database connectivity check"""
    connected: bool
    database: str
    host: str
    port: int
    server_time: Optional[str] = None
    organizations_count: Optional[int] = None
    error: Optional[str] = None


class ChecklistItemResponse(BaseModel):
    """Response model for checklist item"""
    id: str
    title: str
    description: Optional[str]
    category: str
    priority: str
    is_completed: bool
    completed_at: Optional[str]
    documentation_link: Optional[str]
    estimated_time_minutes: Optional[int]

    class Config:
        from_attributes = True


class EmailTestRequest(BaseModel):
    """Request model for testing email configuration"""
    platform: str = Field(..., description="Email platform: gmail, microsoft, selfhosted, other")
    config: Dict[str, Any] = Field(..., description="Email configuration")

    @validator('platform')
    def validate_platform(cls, v):
        valid_platforms = ['gmail', 'microsoft', 'selfhosted', 'other']
        if v not in valid_platforms:
            raise ValueError(f'Platform must be one of: {", ".join(valid_platforms)}')
        return v


class EmailTestResponse(BaseModel):
    """Response model for email test"""
    success: bool
    message: str
    details: Optional[Dict[str, Any]] = None


class StartSessionResponse(BaseModel):
    """Response model for starting onboarding session"""
    session_id: str
    expires_at: str
    csrf_token: str
    message: str
    current_step: int
    steps: List[Dict[str, Any]]


class DepartmentInfoRequest(BaseModel):
    """Request model for saving department information"""
    name: str = Field(..., min_length=3, max_length=100, description="Department name")
    logo: Optional[str] = Field(None, description="Base64-encoded logo image")
    navigation_layout: str = Field(..., description="Navigation layout: 'top' or 'left'")

    @validator('navigation_layout')
    def validate_layout(cls, v):
        if v not in ['top', 'left']:
            raise ValueError('Navigation layout must be "top" or "left"')
        return v


class EmailConfigRequest(BaseModel):
    """Request model for saving email configuration"""
    platform: str = Field(..., description="Email platform: gmail, microsoft, selfhosted, other")
    config: Dict[str, Any] = Field(..., description="Email configuration")


class FileStorageConfigRequest(BaseModel):
    """Request model for saving file storage configuration"""
    platform: str = Field(..., description="Platform: googledrive, onedrive, s3, local, other")
    config: Dict[str, Any] = Field(..., description="Storage configuration")


class AuthConfigRequest(BaseModel):
    """Request model for saving authentication configuration"""
    platform: str = Field(..., description="Platform: google, microsoft, authentik")


class ITTeamRequest(BaseModel):
    """Request model for saving IT team information"""
    it_team: List[Dict[str, Any]] = Field(default_factory=list, description="IT team members")
    backup_access: Dict[str, Any] = Field(..., description="Backup access information")


class SessionModulesRequest(BaseModel):
    """Request model for saving module configuration via session"""
    modules: List[str] = Field(default_factory=list, description="List of enabled modules")


class RolePermission(BaseModel):
    """Permission settings for a module"""
    view: bool = True
    manage: bool = False


class RoleSetupItem(BaseModel):
    """Individual role configuration"""
    id: str = Field(..., description="Unique role identifier (slug)")
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    priority: int = Field(default=50, ge=0, le=100)
    permissions: Dict[str, RolePermission] = Field(
        default_factory=dict,
        description="Module permissions with view/manage flags"
    )
    is_custom: bool = Field(default=False, description="Whether this is a custom role")


class RolesSetupRequest(BaseModel):
    """Request model for role setup during onboarding"""
    roles: List[RoleSetupItem] = Field(
        ...,
        min_length=1,
        description="List of roles to create for the organization"
    )


class RolesSetupResponse(BaseModel):
    """Response model for role setup"""
    success: bool
    message: str
    created: List[str] = Field(default_factory=list)
    updated: List[str] = Field(default_factory=list)
    total_roles: int


class PositionsSetupRequest(BaseModel):
    """Request model for position setup during onboarding (frontend uses 'positions' key)"""
    positions: List[RoleSetupItem] = Field(
        ...,
        min_length=1,
        description="List of positions to create for the organization"
    )


class PositionsSetupResponse(BaseModel):
    """Response model for position setup"""
    success: bool
    message: str
    created: List[str] = Field(default_factory=list)
    updated: List[str] = Field(default_factory=list)
    total_positions: int


class SessionDataResponse(BaseModel):
    """Response model for session data operations"""
    success: bool
    message: str
    step: Optional[str] = None


# ============================================
# Session Helper Functions
# ============================================

SESSION_EXPIRY_HOURS = 0.5  # 30 minutes


async def get_or_create_session(
    request: Request,
    db: AsyncSession
) -> OnboardingSessionModel:
    """
    Get existing session or create a new one.

    Args:
        request: FastAPI request object
        db: Database session

    Returns:
        OnboardingSessionModel instance

    Raises:
        HTTPException: If session is invalid or expired
    """
    session_id = request.headers.get('X-Session-ID')

    if session_id:
        # Try to get existing session
        result = await db.execute(
            select(OnboardingSessionModel).where(
                OnboardingSessionModel.session_id == session_id,
                OnboardingSessionModel.expires_at > datetime.utcnow()
            )
        )
        session = result.scalar_one_or_none()

        if session:
            # Update expiration on activity
            session.expires_at = datetime.utcnow() + timedelta(hours=SESSION_EXPIRY_HOURS)
            await db.commit()
            return session

    # Create new session
    ip_address = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent")

    new_session = OnboardingSessionModel(
        session_id=secrets.token_urlsafe(32),
        data={},
        ip_address=ip_address,
        user_agent=user_agent,
        expires_at=datetime.utcnow() + timedelta(hours=SESSION_EXPIRY_HOURS)
    )

    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)

    return new_session


async def validate_session(
    request: Request,
    db: AsyncSession,
    require_csrf: bool = True
) -> OnboardingSessionModel:
    """
    Validate an existing session from X-Session-ID header.

    Args:
        request: FastAPI request object
        db: Database session
        require_csrf: Whether to validate CSRF token (default True)

    Returns:
        OnboardingSessionModel instance

    Raises:
        HTTPException: If session is invalid or expired
    """
    session_id = request.headers.get('X-Session-ID')

    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session ID required. Please start onboarding first."
        )

    # Get session
    result = await db.execute(
        select(OnboardingSessionModel).where(
            OnboardingSessionModel.session_id == session_id
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session. Please restart onboarding."
        )

    # Check expiration
    if session.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your onboarding session has expired due to inactivity (30-minute limit). Please refresh the page to start a new session. Your previously saved progress will be retained."
        )

    # Validate CSRF token if required
    if require_csrf:
        csrf_token = request.headers.get('X-CSRF-Token')
        stored_csrf = session.data.get('csrf_token') if session.data else None

        if not csrf_token or csrf_token != stored_csrf:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF validation failed. Please refresh and try again."
            )

    # Update expiration on activity
    session.expires_at = datetime.utcnow() + timedelta(hours=SESSION_EXPIRY_HOURS)
    await db.commit()

    return session


def generate_csrf_token() -> str:
    """Generate a CSRF token"""
    return secrets.token_urlsafe(32)


async def _persist_session_data_to_org(
    session: OnboardingSessionModel,
    db: AsyncSession,
) -> None:
    """
    Copy IT team and auth configuration from the ephemeral onboarding session
    into the permanent Organization.settings JSON column.

    Called during onboarding completion so the data survives after the
    session is cleaned up.
    """
    from app.models.user import Organization

    session_data = session.data or {}

    # Find the organization (single-org system)
    org_result = await db.execute(
        select(Organization)
        .where(Organization.active == True)
        .order_by(Organization.created_at.asc())
        .limit(1)
    )
    organization = org_result.scalar_one_or_none()
    if not organization:
        return

    org_settings = dict(organization.settings or {})

    # Persist IT team data
    it_team_data = session_data.get("it_team")
    if it_team_data:
        org_settings["it_team"] = {
            "members": it_team_data.get("members", []),
            "backup_access": it_team_data.get("backup_access", {}),
        }

    # Persist auth provider choice
    auth_data = session_data.get("auth")
    if auth_data and auth_data.get("platform"):
        org_settings.setdefault("auth", {})
        org_settings["auth"]["provider"] = auth_data["platform"]

    organization.settings = org_settings
    await db.flush()
    logger.info("Persisted session data (IT team, auth) to Organization.settings")


# ============================================
# Endpoints
# ============================================

@router.get("/status", response_model=OnboardingStatusResponse)
async def get_onboarding_status(
    db: AsyncSession = Depends(get_db)
):
    """
    Check if onboarding is needed and get current status

    Returns onboarding status including:
    - Whether onboarding is needed
    - Current completion status
    - Steps completed
    - Current step number
    """
    service = OnboardingService(db)

    needs_onboarding = await service.needs_onboarding()
    status = await service.get_onboarding_status()

    if status:
        return OnboardingStatusResponse(
            needs_onboarding=not status.is_completed,
            is_completed=status.is_completed,
            current_step=status.current_step,
            total_steps=len(service.STEPS),
            steps_completed=status.steps_completed or {},
            organization_name=status.organization_name
        )
    else:
        return OnboardingStatusResponse(
            needs_onboarding=needs_onboarding,
            is_completed=False,
            current_step=0,
            total_steps=len(service.STEPS),
            steps_completed={},
            organization_name=None
        )


@router.post("/start", response_model=StartSessionResponse)
async def start_onboarding(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Start the onboarding process

    Initializes onboarding tracking, creates a server-side session,
    and returns session ID and CSRF token for secure form submissions.
    """
    service = OnboardingService(db)

    # Check if already completed
    if not await service.needs_onboarding():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Onboarding has already been completed"
        )

    # Get client info
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    onboarding_status = await service.start_onboarding(
        ip_address=ip_address,
        user_agent=user_agent
    )

    # Create server-side session for secure data storage
    session = await get_or_create_session(request, db)

    # Generate CSRF token
    csrf_token = generate_csrf_token()

    # Store CSRF token in session data
    session.data = session.data or {}
    session.data['csrf_token'] = csrf_token
    await db.commit()

    # Set CSRF token in response header for client to store
    response.headers['X-CSRF-Token'] = csrf_token

    return StartSessionResponse(
        session_id=session.session_id,
        expires_at=session.expires_at.isoformat(),
        csrf_token=csrf_token,
        message="Onboarding started successfully",
        current_step=onboarding_status.current_step,
        steps=service.STEPS
    )


@router.get("/system-info", response_model=SystemInfoResponse)
async def get_system_info(
    db: AsyncSession = Depends(get_db)
):
    """
    Get system information for display during onboarding

    Returns app version, security features, and configuration.
    """
    service = OnboardingService(db)
    return await service.get_system_info()


@router.get("/security-check", response_model=SecurityCheckResponse)
async def verify_security(
    db: AsyncSession = Depends(get_db)
):
    """
    Verify security configuration

    Checks:
    - SECRET_KEY is not default value
    - ENCRYPTION_KEY is not default value
    - Database password is not default
    - Other security settings

    Returns issues and warnings that need to be addressed.
    """
    service = OnboardingService(db)
    result = await service.verify_security_configuration()

    # Track security verification status (not a separate onboarding step)
    if result["passed"]:
        status = await service.get_onboarding_status()
        if status and not status.is_completed:
            status.security_keys_verified = True
            await db.commit()

    return result


@router.get("/database-check", response_model=DatabaseCheckResponse)
async def verify_database(
    db: AsyncSession = Depends(get_db)
):
    """
    Verify database connectivity and configuration

    Tests database connection and returns connection info.
    """
    service = OnboardingService(db)
    result = await service.verify_database_connection()

    # Mark database as verified if connected
    if result.get("connected"):
        status = await service.get_onboarding_status()
        if status:
            status.database_verified = True
            await db.commit()

    return result


@router.post("/organization", response_model=OrganizationResponse)
async def create_organization(
    request: Request,
    org_data: OrganizationCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create the first organization

    This creates the organization and default roles.
    Can only be called during onboarding.
    """
    # Validate session
    await validate_session(request, db)

    service = OnboardingService(db)

    # Verify onboarding is in progress
    if not await service.needs_onboarding():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Onboarding has already been completed"
        )

    try:
        org = await service.create_organization(
            name=org_data.name,
            slug=org_data.slug,
            organization_type=org_data.organization_type,
            description=None,
            settings_dict={"timezone": org_data.timezone}
        )

        return OrganizationResponse(
            id=str(org.id),
            name=org.name,
            slug=org.slug,
            type=org.type,
            description=None,
            active=org.active
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/system-owner", response_model=SystemOwnerResponse)
async def create_system_owner(
    request: Request,
    user_data: SystemOwnerCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create the System Owner (IT Manager) user

    Creates the first user with the IT Manager position (full system access).
    Requires organization to be created first.
    Returns access token for automatic login.
    """
    # Validate session
    await validate_session(request, db)

    service = OnboardingService(db)

    # Verify onboarding is in progress
    if not await service.needs_onboarding():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Onboarding has already been completed"
        )

    # Get organization from onboarding status
    onboarding_status = await service.get_onboarding_status()
    if not onboarding_status or not onboarding_status.organization_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organization must be created before adding an admin user. Please complete the organization setup step first."
        )

    # Find organization — use first active org (single-org system).
    # Matching by name is fragile; onboarding creates exactly one org,
    # so look it up the same robust way as /auth/register.
    from app.models.user import Organization
    result = await db.execute(
        select(Organization)
        .where(Organization.active == True)
        .order_by(Organization.created_at.asc())
        .limit(1)
    )
    org = result.scalar_one_or_none()

    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found. The organization setup may not have completed. Please go back and complete the organization setup step."
        )

    try:
        user = await service.create_system_owner(
            organization_id=str(org.id),
            username=user_data.username,
            email=user_data.email,
            password=user_data.password,
            first_name=user_data.first_name,
            last_name=user_data.last_name,
            badge_number=user_data.badge_number
        )

        # Commit all changes (user, role assignment, onboarding step) before
        # returning — the frontend immediately calls /complete which needs
        # to see the admin_user step as committed in a new DB session.
        await db.commit()

        # Create a proper session so the token works with get_user_from_token().
        # A bare create_access_token() would produce a JWT with no matching
        # UserSession row, causing immediate 401 on any authenticated request.
        auth_service = AuthService(db)
        access_token, refresh_token = await auth_service.create_user_tokens(
            user=user,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )

        return SystemOwnerResponse(
            id=str(user.id),
            username=user.username,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            badge_number=user.badge_number,
            status=user.status.value,
            access_token=access_token,
            refresh_token=refresh_token,
        )
    except ValueError as e:
        logger.error(f"Admin user creation failed with ValueError: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        # Log full details server-side, return generic message to client
        logger.error(f"Admin user creation failed with unexpected error: {type(e).__name__}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create admin user due to an unexpected error. Please try again. If the problem persists, check the server logs or contact support."
        )


@router.post("/modules")
async def configure_modules(
    request: Request,
    modules: ModulesConfig,
    db: AsyncSession = Depends(get_db)
):
    """
    Configure enabled modules

    Select which modules to enable for the organization.
    """
    # Validate session
    await validate_session(request, db)

    service = OnboardingService(db)

    try:
        result = await service.configure_modules(modules.enabled_modules)
        return {
            "message": "Modules configured successfully",
            "modules": result
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/notifications")
async def configure_notifications(
    request: Request,
    config: NotificationsConfig,
    db: AsyncSession = Depends(get_db)
):
    """
    Configure notification settings (optional)

    Sets up email and SMS notifications.
    This step is optional and can be skipped.
    """
    # Validate session
    await validate_session(request, db)

    service = OnboardingService(db)

    onboarding_status = await service.get_onboarding_status()
    if onboarding_status:
        onboarding_status.email_configured = config.email_enabled
        await service._mark_step_completed(onboarding_status, 6, "notifications")

    return {
        "message": "Notifications configured successfully",
        "email_enabled": config.email_enabled,
        "sms_enabled": config.sms_enabled
    }


@router.post("/complete")
async def complete_onboarding(
    request: Request,
    request_data: CompleteOnboardingRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Complete the onboarding process

    Marks onboarding as finished and creates post-onboarding checklist.
    Persists IT team and auth config from session data into Organization.settings.
    """
    # Validate session
    session = await validate_session(request, db)

    # Persist session-collected data into Organization.settings before completion
    await _persist_session_data_to_org(session, db)

    service = OnboardingService(db)

    try:
        onboarding_status = await service.complete_onboarding(notes=request_data.notes)

        # Commit all changes (org settings, onboarding status, checklist items)
        # before returning the response to ensure data is persisted
        await db.commit()

        return {
            "message": "Onboarding completed successfully!",
            "organization": onboarding_status.organization_name,
            "admin_user": onboarding_status.admin_username,
            "completed_at": onboarding_status.completed_at.isoformat() if onboarding_status.completed_at else None,
            "next_steps": "Review the post-onboarding checklist for additional configuration"
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/checklist", response_model=List[ChecklistItemResponse])
async def get_post_onboarding_checklist(
    db: AsyncSession = Depends(get_db)
):
    """
    Get post-onboarding checklist

    Returns list of recommended tasks to complete after onboarding.
    """
    service = OnboardingService(db)
    items = await service.get_post_onboarding_checklist()

    return [
        ChecklistItemResponse(
            id=str(item.id),
            title=item.title,
            description=item.description,
            category=item.category,
            priority=item.priority,
            is_completed=item.is_completed,
            completed_at=item.completed_at.isoformat() if item.completed_at else None,
            documentation_link=item.documentation_link,
            estimated_time_minutes=item.estimated_time_minutes
        )
        for item in items
    ]


@router.patch("/checklist/{item_id}/complete")
async def mark_checklist_item_complete(
    item_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Mark a checklist item as completed

    Updates the completion status of a post-onboarding checklist item.
    """
    from sqlalchemy import select, update
    from datetime import datetime

    # Find item
    result = await db.execute(
        select(OnboardingChecklistItem).where(OnboardingChecklistItem.id == item_id)
    )
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Checklist item not found"
        )

    # Mark as completed
    item.is_completed = True
    item.completed_at = datetime.utcnow()
    await db.commit()

    return {
        "message": "Checklist item marked as complete",
        "item_id": item_id,
        "title": item.title
    }


@router.post("/test/email", response_model=EmailTestResponse)
async def test_email_configuration(
    request: EmailTestRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Test email configuration without saving it

    Tests SMTP connection, authentication, and validates email settings.
    Supports Gmail, Microsoft 365, self-hosted SMTP, and other email platforms.

    Args:
        request: Email configuration to test

    Returns:
        EmailTestResponse with success status and details

    Raises:
        HTTPException: If configuration is invalid
    """
    platform = request.platform
    config = request.config

    # Run SMTP tests in thread pool to avoid blocking async event loop
    # Use a 30-second timeout to prevent indefinite hangs if mail server is unreachable
    EMAIL_TEST_TIMEOUT = 30
    loop = asyncio.get_event_loop()

    try:
        if platform == 'gmail':
            # Test Gmail configuration (OAuth or app password)
            test_func = partial(test_gmail_oauth, config)
        elif platform == 'microsoft':
            # Test Microsoft 365 configuration (OAuth)
            test_func = partial(test_microsoft_oauth, config)
        elif platform == 'selfhosted' or platform == 'other':
            # Test self-hosted SMTP configuration
            test_func = partial(test_smtp_connection, config)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported email platform: {platform}"
            )

        async with asyncio.timeout(EMAIL_TEST_TIMEOUT):
            success, message, details = await loop.run_in_executor(None, test_func)

        return EmailTestResponse(
            success=success,
            message=message,
            details=details
        )

    except TimeoutError:
        return EmailTestResponse(
            success=False,
            message=f"Email connection test timed out after {EMAIL_TEST_TIMEOUT} seconds. The mail server may be unreachable or slow to respond.",
            details={"error": "timeout", "timeout_seconds": EMAIL_TEST_TIMEOUT}
        )

    except Exception as e:
        logger.error(f"Error testing email configuration: {e}")

        return EmailTestResponse(
            success=False,
            message=f"Failed to test email configuration: {str(e)}",
            details={"error": str(e)}
        )


# ============================================
# Session Data Endpoints
# ============================================

@router.post("/session/department", response_model=SessionDataResponse)
async def save_department_info(
    request: Request,
    data: DepartmentInfoRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Save department information to the onboarding session.

    Stores department name, logo (base64), and navigation layout preference.
    This data is safe to store as it contains no secrets.
    """
    # Validate session
    session = await validate_session(request, db)

    # Validate and sanitize logo before storing
    validated_logo = validate_logo_image(data.logo)

    # Update session data with department info
    session.data = session.data or {}
    session.data['department'] = {
        'name': data.name,
        'logo': validated_logo,
        'navigation_layout': data.navigation_layout,
        'saved_at': datetime.utcnow().isoformat()
    }

    await db.commit()

    return SessionDataResponse(
        success=True,
        message="Department information saved successfully",
        step="department"
    )


@router.post("/session/email", response_model=SessionDataResponse)
async def save_email_config(
    request: Request,
    data: EmailConfigRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Save email configuration to the onboarding session.

    SECURITY: Sensitive fields (passwords, API keys) are encrypted before
    storage using AES-256. Only the platform type is stored in plain text.
    """
    from app.core.security import encrypt_data

    # Validate session
    session = await validate_session(request, db)

    # Validate platform
    valid_platforms = ['gmail', 'microsoft', 'selfhosted', 'other']
    if data.platform not in valid_platforms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid platform. Must be one of: {', '.join(valid_platforms)}"
        )

    # Encrypt sensitive config data (contains passwords, API keys, etc.)
    import json
    encrypted_config = encrypt_data(json.dumps(data.config))

    # Update session data - store config encrypted, platform in plain text
    session.data = session.data or {}
    session.data['email'] = {
        'platform': data.platform,
        'config_encrypted': encrypted_config,
        'saved_at': datetime.utcnow().isoformat()
    }

    await db.commit()

    return SessionDataResponse(
        success=True,
        message="Email configuration saved successfully",
        step="email"
    )


@router.post("/session/file-storage", response_model=SessionDataResponse)
async def save_file_storage_config(
    request: Request,
    data: FileStorageConfigRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Save file storage configuration to the onboarding session.

    SECURITY: API keys and secrets are encrypted before storage using AES-256.
    Only the platform type is stored in plain text.
    """
    from app.core.security import encrypt_data

    # Validate session
    session = await validate_session(request, db)

    # Validate platform
    valid_platforms = ['googledrive', 'onedrive', 's3', 'local', 'other']
    if data.platform not in valid_platforms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid platform. Must be one of: {', '.join(valid_platforms)}"
        )

    # Encrypt sensitive config data (contains API keys, AWS credentials, etc.)
    import json
    encrypted_config = encrypt_data(json.dumps(data.config))

    # Update session data - store config encrypted, platform in plain text
    session.data = session.data or {}
    session.data['file_storage'] = {
        'platform': data.platform,
        'config_encrypted': encrypted_config,
        'saved_at': datetime.utcnow().isoformat()
    }

    await db.commit()

    return SessionDataResponse(
        success=True,
        message="File storage configuration saved successfully",
        step="file_storage"
    )


@router.post("/session/auth", response_model=SessionDataResponse)
async def save_auth_config(
    request: Request,
    data: AuthConfigRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Save authentication platform preference to the onboarding session.
    """
    # Validate session
    session = await validate_session(request, db)

    # Validate platform
    valid_platforms = ['google', 'microsoft', 'authentik', 'local']
    if data.platform not in valid_platforms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid platform. Must be one of: {', '.join(valid_platforms)}"
        )

    # Update session data with auth config
    session.data = session.data or {}
    session.data['auth'] = {
        'platform': data.platform,
        'saved_at': datetime.utcnow().isoformat()
    }

    await db.commit()

    return SessionDataResponse(
        success=True,
        message="Authentication platform saved successfully",
        step="auth"
    )


@router.post("/session/it-team", response_model=SessionDataResponse)
async def save_it_team(
    request: Request,
    data: ITTeamRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Save IT team and backup access information to the onboarding session.
    """
    # Validate session
    session = await validate_session(request, db)

    # Update session data with IT team info
    session.data = session.data or {}
    session.data['it_team'] = {
        'members': data.it_team,
        'backup_access': data.backup_access,
        'saved_at': datetime.utcnow().isoformat()
    }

    await db.commit()

    return SessionDataResponse(
        success=True,
        message="IT team information saved successfully",
        step="it_team"
    )


@router.post("/session/modules", response_model=SessionDataResponse)
async def save_session_modules(
    request: Request,
    data: SessionModulesRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Save module configuration to the onboarding session.

    This saves the module selection to the session before final onboarding completion.
    """
    # Validate session
    session = await validate_session(request, db)

    # Validate modules - must match module IDs from frontend moduleRegistry.ts
    available_modules = [
        # Core modules (always enabled)
        "members", "events", "documents", "forms",
        # Operations modules
        "training", "inventory", "scheduling", "apparatus", "facilities",
        # Governance modules
        "elections", "minutes", "reports",
        # Communication modules
        "notifications", "mobile",
        # Advanced modules
        "integrations",
        # Membership
        "prospective_members",
        # Legacy/additional modules (for backwards compatibility)
        "compliance", "meetings", "fundraising", "incidents",
        "equipment", "vehicles", "budget"
    ]
    invalid_modules = [m for m in data.modules if m not in available_modules]
    if invalid_modules:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid modules: {', '.join(invalid_modules)}"
        )

    # Update session data with modules
    session.data = session.data or {}
    session.data['modules'] = {
        'enabled': data.modules,
        'saved_at': datetime.utcnow().isoformat()
    }

    await db.commit()

    return SessionDataResponse(
        success=True,
        message="Module configuration saved successfully",
        step="modules"
    )


@router.post("/session/organization", response_model=OrganizationSetupResponse)
async def save_session_organization(
    request: Request,
    data: OrganizationSetupCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create and save organization during onboarding (Step 1).

    This endpoint collects comprehensive organization information and commits
    it to the database immediately. This includes:
    - Basic info: name, slug, description, organization type
    - Contact info: phone, fax, email, website
    - Mailing address
    - Physical address (if different from mailing)
    - Department identifiers: FDID, State ID, or Department ID
    - Additional info: county, founded year, tax ID, logo

    The organization is committed to the database at this step so that
    subsequent steps can reference it (e.g., role setup, admin user creation).
    """
    # Validate session
    session = await validate_session(request, db)

    service = OnboardingService(db)

    # Verify onboarding is in progress
    if not await service.needs_onboarding():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Onboarding has already been completed"
        )

    # Generate slug if not provided
    slug = data.slug
    if not slug:
        slug = data.name.lower().replace(" ", "-")
        slug = re.sub(r'[^a-z0-9-]', '', slug)

    try:
        # Extract address fields
        mailing = data.mailing_address
        physical = data.physical_address if not data.physical_address_same else None

        org = await service.create_organization(
            name=data.name,
            slug=slug,
            organization_type=data.organization_type.value,
            description=None,  # Description not collected in OrganizationSetupCreate schema
            timezone=data.timezone,
            # Contact info
            phone=data.phone,
            fax=data.fax,
            email=data.email,
            website=data.website,
            # Mailing address
            mailing_address_line1=mailing.line1,
            mailing_address_line2=mailing.line2,
            mailing_city=mailing.city,
            mailing_state=mailing.state,
            mailing_zip=mailing.zip_code,
            mailing_country=mailing.country,
            # Physical address
            physical_address_same=data.physical_address_same,
            physical_address_line1=physical.line1 if physical else None,
            physical_address_line2=physical.line2 if physical else None,
            physical_city=physical.city if physical else None,
            physical_state=physical.state if physical else None,
            physical_zip=physical.zip_code if physical else None,
            physical_country=physical.country if physical else None,
            # Identifiers
            identifier_type=data.identifier_type.value,
            fdid=data.fdid,
            state_id=data.state_id,
            department_id=data.department_id,
            # Additional info
            county=data.county,
            founded_year=data.founded_year,
            logo=validate_logo_image(data.logo),  # Validate and sanitize logo
        )

        # Store organization ID in session for subsequent steps
        session.data = session.data or {}
        session.data['department'] = {
            'name': data.name,
            'organization_id': str(org.id),
            'logo': org.logo,  # Use sanitized logo from org object
            'saved_at': datetime.utcnow().isoformat()
        }
        await db.commit()

        return OrganizationSetupResponse(
            id=org.id,
            name=org.name,
            slug=org.slug,
            organization_type=org.organization_type.value if org.organization_type else org.type,
            timezone=org.timezone,
            active=org.active,
            created_at=org.created_at
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error creating organization during onboarding: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create organization. Please check the server logs for details."
        )


@router.post("/session/roles", response_model=RolesSetupResponse)
async def save_session_roles(
    request: Request,
    data: RolesSetupRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Save role configuration during onboarding.

    Creates or updates roles for the organization based on user selections.
    This endpoint should be called after the organization is created.

    The roles data includes:
    - id: Unique identifier (slug) for the role
    - name: Display name
    - description: Role description
    - priority: Role priority (0-100, higher = more authority)
    - permissions: Dictionary of module_id -> {view: bool, manage: bool}
    - is_custom: Whether this is a user-created custom role
    """
    # Validate session
    session = await validate_session(request, db)

    # Get organization from session data
    organization_id = None
    if session.data and 'department' in session.data:
        organization_id = session.data['department'].get('organization_id')

    if not organization_id:
        # Try to get from onboarding status
        service = OnboardingService(db)
        onboarding_status = await service.get_onboarding_status()
        if onboarding_status and onboarding_status.organization_name:
            from app.models.user import Organization
            result = await db.execute(
                select(Organization).where(Organization.name == onboarding_status.organization_name)
            )
            org = result.scalar_one_or_none()
            if org:
                organization_id = str(org.id)

    if not organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organization must be created before configuring roles"
        )

    # Convert role permissions to backend format
    # Frontend sends: { module_id: { view: bool, manage: bool } }
    # Backend stores: ["module.view", "module.manage", ...]
    from app.models.user import Role
    from sqlalchemy import delete
    from app.core.permissions import DEFAULT_ROLES

    # Delete existing non-system roles for this organization (custom roles from previous attempts)
    await db.execute(
        delete(Role).where(
            Role.organization_id == organization_id,
            Role.is_system == False
        )
    )

    # Get existing system roles
    result = await db.execute(
        select(Role).where(
            Role.organization_id == organization_id,
            Role.is_system == True
        )
    )
    existing_system_roles = {role.slug: role for role in result.scalars().all()}

    created_roles = []
    updated_roles = []

    for role_data in data.roles:
        # Convert permissions dict to list format
        permission_list = []
        for module_id, perms in role_data.permissions.items():
            if perms.view:
                permission_list.append(f"{module_id}.view")
            if perms.manage:
                permission_list.append(f"{module_id}.manage")
                permission_list.append(f"{module_id}.*")  # Also grant full access if manage

        # Check if this is an existing system role
        if role_data.id in existing_system_roles:
            # Update existing system role permissions
            existing_role = existing_system_roles[role_data.id]

            default_perms = DEFAULT_ROLES.get(role_data.id, {}).get("permissions", [])

            # Preserve the wildcard permission for positions that have it in
            # DEFAULT_POSITIONS (e.g. it_manager). The frontend position editor
            # only knows about module-scoped view/manage permissions and cannot
            # represent the backend wildcard "*". Without this guard the
            # it_manager's ["*"] gets overwritten with a granular list
            # that is missing action-specific permissions (users.create,
            # audit.view, etc.), causing 403 errors on System Owner operations.
            if "*" in default_perms:
                permission_list = ["*"]
            else:
                # The frontend module registry doesn't cover every backend
                # permission module (e.g. audit, organization, users,
                # locations, meetings).  Preserve the default permissions
                # for any modules the frontend submission doesn't include,
                # so roles like Chief keep audit.view, users.create, etc.
                submitted_modules = set(role_data.permissions.keys())
                for perm in default_perms:
                    if "." in perm:
                        module_prefix = perm.split(".")[0]
                        if module_prefix not in submitted_modules:
                            permission_list.append(perm)

            existing_role.permissions = permission_list
            existing_role.priority = role_data.priority
            if role_data.description:
                existing_role.description = role_data.description
            updated_roles.append(role_data.name)
        else:
            # Create new role
            new_role = Role(
                organization_id=organization_id,
                name=role_data.name,
                slug=role_data.id,
                description=role_data.description or f"Custom role: {role_data.name}",
                permissions=permission_list,
                is_system=not role_data.is_custom,  # System roles can't be deleted
                priority=role_data.priority
            )
            db.add(new_role)
            created_roles.append(role_data.name)

    # Update session data
    session.data = session.data or {}
    session.data['roles'] = {
        'configured': True,
        'role_count': len(data.roles),
        'roles': [{"id": r.id, "name": r.name, "priority": r.priority} for r in data.roles],
        'saved_at': datetime.utcnow().isoformat()
    }

    await db.commit()

    return RolesSetupResponse(
        success=True,
        message="Roles configured successfully",
        created=created_roles,
        updated=updated_roles,
        total_roles=len(data.roles)
    )


@router.post("/session/positions", response_model=PositionsSetupResponse)
async def save_session_positions(
    request: Request,
    data: PositionsSetupRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Save position configuration during onboarding.

    This is the canonical endpoint used by the frontend PositionSetup page.
    It accepts a ``positions`` key and delegates to the same role-creation
    logic used by ``/session/roles``.
    """
    # Delegate to save_session_roles by converting positions -> roles
    roles_request = RolesSetupRequest(roles=data.positions)
    roles_response = await save_session_roles(request, roles_request, db)

    return PositionsSetupResponse(
        success=roles_response.success,
        message=roles_response.message.replace("Roles", "Positions"),
        created=roles_response.created,
        updated=roles_response.updated,
        total_positions=roles_response.total_roles,
    )


@router.get("/session/data")
async def get_session_data(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Get current session data (non-sensitive fields only).

    Returns the session data without sensitive information like passwords and API keys.
    """
    # Validate session
    session = await validate_session(request, db)

    # Return safe data (excluding sensitive config details)
    safe_data = {}

    if session.data:
        # Department info is safe
        if 'department' in session.data:
            safe_data['department'] = session.data['department']

        # Only return platform, not full config for sensitive sections
        if 'email' in session.data:
            safe_data['email'] = {
                'platform': session.data['email'].get('platform'),
                'configured': True
            }

        if 'file_storage' in session.data:
            safe_data['file_storage'] = {
                'platform': session.data['file_storage'].get('platform'),
                'configured': True
            }

        if 'auth' in session.data:
            safe_data['auth'] = session.data['auth']

        if 'it_team' in session.data:
            safe_data['it_team'] = {
                'members_count': len(session.data['it_team'].get('members', [])),
                'has_backup_access': bool(session.data['it_team'].get('backup_access'))
            }

        if 'modules' in session.data:
            safe_data['modules'] = session.data['modules']

    return {
        "session_id": session.session_id,
        "expires_at": session.expires_at.isoformat(),
        "data": safe_data
    }


@router.post("/reset", dependencies=[Depends(check_rate_limit)])
async def reset_onboarding(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Reset onboarding and clear all database records.

    WARNING: This is a destructive operation that cannot be undone.
    It will delete all users, organizations, roles, and onboarding data.
    Only allowed while onboarding has not been completed.
    """
    # Verify onboarding has NOT been completed - never allow reset after completion
    service = OnboardingService(db)
    onboarding_status = await service.get_onboarding_status()
    if onboarding_status and onboarding_status.is_completed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot reset after onboarding is completed. Use the admin panel to manage settings."
        )

    # Validate session if one exists (CSRF protection)
    try:
        await validate_session(request, db)
    except HTTPException:
        # Allow reset without valid session only if onboarding is still in progress
        # (session may have expired during a failed onboarding attempt)
        if not await service.needs_onboarding():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Session expired and onboarding appears complete. Cannot reset."
            )

    # Import models for deletion
    from app.models.user import Organization, User, Role
    from app.models.onboarding import OnboardingStatus, OnboardingChecklistItem, OnboardingSessionModel

    try:
        # Log the reset BEFORE deletion to ensure we capture it
        from app.core.audit import log_audit_event
        await log_audit_event(
            db=db,
            event_type="onboarding.reset_initiated",
            event_category="onboarding",
            severity="warning",
            ip_address=request.client.host if request.client else None,
            event_data={
                "action": "full_reset",
                "message": "Onboarding reset initiated - clearing all data"
            }
        )

        # Delete in order to respect foreign key constraints
        # 1. Delete onboarding sessions
        await db.execute(
            OnboardingSessionModel.__table__.delete()
        )

        # 2. Delete onboarding checklist items
        await db.execute(
            OnboardingChecklistItem.__table__.delete()
        )

        # 3. Delete onboarding status
        await db.execute(
            OnboardingStatus.__table__.delete()
        )

        # 4. Delete user_positions associations (junction table for user-role/position mapping)
        try:
            from sqlalchemy import text
            await db.execute(text("DELETE FROM user_positions"))
        except Exception:
            pass  # Table might not exist yet

        # 5. Delete users
        await db.execute(
            User.__table__.delete()
        )

        # 6. Delete roles
        await db.execute(
            Role.__table__.delete()
        )

        # 7. Delete organizations
        await db.execute(
            Organization.__table__.delete()
        )

        # Commit all deletions
        await db.commit()

        # Log successful completion of reset
        await log_audit_event(
            db=db,
            event_type="onboarding.reset_completed",
            event_category="onboarding",
            severity="warning",
            ip_address=request.client.host if request.client else None,
            event_data={
                "action": "full_reset",
                "message": "Onboarding reset completed - all data cleared successfully"
            }
        )

        return {
            "success": True,
            "message": "Onboarding has been reset. All data has been cleared.",
            "next_step": "Navigate to /onboarding/start to begin again"
        }

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to reset onboarding: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset onboarding. Please check the server logs for details."
        )
