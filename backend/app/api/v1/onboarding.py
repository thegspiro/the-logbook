"""
Onboarding API Endpoints

Handles first-time system setup and configuration.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, EmailStr, Field, validator
import re
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import asyncio
from functools import partial

from app.core.database import get_db
from app.services.onboarding import OnboardingService
from app.models.onboarding import OnboardingStatus, OnboardingChecklistItem
from app.api.v1.test_email_helper import test_smtp_connection, test_gmail_oauth, test_microsoft_oauth


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
    description: Optional[str] = Field(None, max_length=1000)
    timezone: str = Field(default="America/New_York")

    @validator('slug')
    def validate_slug(cls, v):
        if not re.match(r'^[a-z0-9-_]+$', v):
            raise ValueError('Slug must contain only lowercase letters, numbers, hyphens, and underscores')
        return v

    @validator('organization_type')
    def validate_org_type(cls, v):
        valid_types = ['fire_department', 'ems', 'hospital', 'clinic', 'emergency_services']
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


class AdminUserCreate(BaseModel):
    """Request model for creating admin user"""
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


@router.post("/start")
async def start_onboarding(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Start the onboarding process

    Initializes onboarding tracking and returns initial status.
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

    status = await service.start_onboarding(
        ip_address=ip_address,
        user_agent=user_agent
    )

    return {
        "message": "Onboarding started successfully",
        "current_step": status.current_step,
        "steps": service.STEPS
    }


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

    # Also mark step as completed if passed
    if result["passed"]:
        status = await service.get_onboarding_status()
        if status and not status.is_completed:
            status.security_keys_verified = True
            await service._mark_step_completed(status, 2, "security_check")

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
    org_data: OrganizationCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create the first organization

    This creates the organization and default roles.
    Can only be called during onboarding.
    """
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
            description=org_data.description,
            settings_dict={"timezone": org_data.timezone}
        )

        return OrganizationResponse(
            id=str(org.id),
            name=org.name,
            slug=org.slug,
            type=org.type,
            description=org.description,
            active=org.active
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/admin-user", response_model=UserResponse)
async def create_admin_user(
    user_data: AdminUserCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create the first administrator user

    Creates admin user with Super Admin role.
    Requires organization to be created first.
    """
    service = OnboardingService(db)

    # Verify onboarding is in progress
    if not await service.needs_onboarding():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Onboarding has already been completed"
        )

    # Get organization from onboarding status
    status = await service.get_onboarding_status()
    if not status or not status.organization_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organization must be created first"
        )

    # Find organization
    from sqlalchemy import select
    from app.models.user import Organization
    result = await db.execute(
        select(Organization).where(Organization.name == status.organization_name)
    )
    org = result.scalar_one_or_none()

    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )

    try:
        user = await service.create_admin_user(
            organization_id=str(org.id),
            username=user_data.username,
            email=user_data.email,
            password=user_data.password,
            first_name=user_data.first_name,
            last_name=user_data.last_name,
            badge_number=user_data.badge_number
        )

        return UserResponse(
            id=str(user.id),
            username=user.username,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            badge_number=user.badge_number,
            status=user.status.value
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/modules")
async def configure_modules(
    modules: ModulesConfig,
    db: AsyncSession = Depends(get_db)
):
    """
    Configure enabled modules

    Select which modules to enable for the organization.
    """
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
    config: NotificationsConfig,
    db: AsyncSession = Depends(get_db)
):
    """
    Configure notification settings (optional)

    Sets up email and SMS notifications.
    This step is optional and can be skipped.
    """
    service = OnboardingService(db)

    status = await service.get_onboarding_status()
    if status:
        status.email_configured = config.email_enabled
        await service._mark_step_completed(status, 6, "notifications")

    return {
        "message": "Notifications configured successfully",
        "email_enabled": config.email_enabled,
        "sms_enabled": config.sms_enabled
    }


@router.post("/complete")
async def complete_onboarding(
    request_data: CompleteOnboardingRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Complete the onboarding process

    Marks onboarding as finished and creates post-onboarding checklist.
    """
    service = OnboardingService(db)

    try:
        status = await service.complete_onboarding(notes=request_data.notes)

        return {
            "message": "Onboarding completed successfully!",
            "organization": status.organization_name,
            "admin_user": status.admin_username,
            "completed_at": status.completed_at.isoformat() if status.completed_at else None,
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
    loop = asyncio.get_event_loop()

    try:
        if platform == 'gmail':
            # Test Gmail configuration (OAuth or app password)
            test_func = partial(test_gmail_oauth, config)
            success, message, details = await loop.run_in_executor(None, test_func)

        elif platform == 'microsoft':
            # Test Microsoft 365 configuration (OAuth)
            test_func = partial(test_microsoft_oauth, config)
            success, message, details = await loop.run_in_executor(None, test_func)

        elif platform == 'selfhosted' or platform == 'other':
            # Test self-hosted SMTP configuration
            test_func = partial(test_smtp_connection, config)
            success, message, details = await loop.run_in_executor(None, test_func)

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported email platform: {platform}"
            )

        return EmailTestResponse(
            success=success,
            message=message,
            details=details
        )

    except Exception as e:
        # Log the error
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Error testing email configuration: {e}")

        return EmailTestResponse(
            success=False,
            message=f"Failed to test email configuration: {str(e)}",
            details={"error": str(e)}
        )


# ============================================
# Session-based Endpoints
# These endpoints store onboarding data server-side
# ============================================

import secrets
from datetime import timedelta
from app.models.onboarding import OnboardingSessionModel


class SessionStartResponse(BaseModel):
    """Response for starting an onboarding session"""
    session_id: str
    expires_at: str


class DepartmentInfoRequest(BaseModel):
    """Request model for department information"""
    name: str = Field(..., min_length=2, max_length=255)
    logo: Optional[str] = Field(None, description="Base64 encoded logo image")
    navigation_layout: str = Field(default="left", pattern="^(top|left)$")


class EmailConfigRequest(BaseModel):
    """Request model for email configuration"""
    platform: str
    config: Dict[str, Any]


class FileStorageConfigRequest(BaseModel):
    """Request model for file storage configuration"""
    platform: str
    config: Dict[str, Any]


class AuthPlatformRequest(BaseModel):
    """Request model for auth platform"""
    platform: str


class ITTeamMember(BaseModel):
    """IT Team member model"""
    name: str
    email: EmailStr
    phone: str
    role: str


class BackupAccess(BaseModel):
    """Backup access information"""
    email: EmailStr
    phone: str
    secondary_admin_email: Optional[EmailStr] = None


class ITTeamRequest(BaseModel):
    """Request model for IT team information"""
    it_team: List[ITTeamMember]
    backup_access: BackupAccess


class ModuleConfigRequest(BaseModel):
    """Request model for module configuration"""
    modules: List[str]


async def get_or_create_session(
    request: Request,
    db: AsyncSession
) -> OnboardingSessionModel:
    """Get existing session from cookie or create a new one"""
    from sqlalchemy import select, delete
    from datetime import datetime

    session_id = request.cookies.get("onboarding_session_id")
    session = None

    if session_id:
        # Try to find existing session
        result = await db.execute(
            select(OnboardingSessionModel).where(
                OnboardingSessionModel.session_id == session_id,
                OnboardingSessionModel.expires_at > datetime.utcnow()
            )
        )
        session = result.scalar_one_or_none()

    if not session:
        # Create new session
        session_id = secrets.token_urlsafe(48)
        ip_address = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "")

        session = OnboardingSessionModel(
            session_id=session_id,
            data={},
            ip_address=ip_address,
            user_agent=user_agent,
            expires_at=datetime.utcnow() + timedelta(hours=2)
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)

    return session


@router.post("/session/start", response_model=SessionStartResponse)
async def start_session(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Start a new onboarding session

    Creates a server-side session to store onboarding data securely.
    Returns session_id which should be stored as a cookie.
    """
    from fastapi.responses import JSONResponse
    from datetime import datetime

    session = await get_or_create_session(request, db)

    # Set session cookie
    response.set_cookie(
        key="onboarding_session_id",
        value=session.session_id,
        httponly=True,
        secure=False,  # Set to True in production with HTTPS
        samesite="lax",
        max_age=7200  # 2 hours
    )

    return SessionStartResponse(
        session_id=session.session_id,
        expires_at=session.expires_at.isoformat()
    )


@router.post("/session/department")
async def save_department_info(
    request: Request,
    data: DepartmentInfoRequest,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Save department information and create organization

    This creates the organization in the database and stores
    additional info in the session.
    """
    session = await get_or_create_session(request, db)

    # Set session cookie
    response.set_cookie(
        key="onboarding_session_id",
        value=session.session_id,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=7200
    )

    # Create slug from name
    slug = re.sub(r'[^a-z0-9]+', '-', data.name.lower()).strip('-')

    # Create organization using OnboardingService
    service = OnboardingService(db)

    try:
        org = await service.create_organization(
            name=data.name,
            slug=slug,
            organization_type="fire_department",
            description=None,
            settings_dict={
                "navigation_layout": data.navigation_layout,
                "logo": data.logo[:100] + "..." if data.logo and len(data.logo) > 100 else data.logo  # Store truncated logo ref
            }
        )

        # Update session data
        session.data = {
            **session.data,
            "department": {
                "name": data.name,
                "organization_id": str(org.id),
                "navigation_layout": data.navigation_layout,
                "has_logo": bool(data.logo)
            }
        }

        # Also update OnboardingStatus for compatibility with admin-user endpoint
        from app.models.onboarding import OnboardingStatus
        from sqlalchemy import select
        result = await db.execute(select(OnboardingStatus).limit(1))
        onboarding_status = result.scalar_one_or_none()

        if not onboarding_status:
            # Create new OnboardingStatus
            from app.models.user import generate_uuid
            onboarding_status = OnboardingStatus(
                id=generate_uuid(),
                organization_name=data.name,
                organization_type="fire_department",
                current_step=2,
                setup_ip_address=request.client.host if request.client else None,
                setup_user_agent=request.headers.get("user-agent")
            )
            db.add(onboarding_status)
        else:
            # Update existing
            onboarding_status.organization_name = data.name
            onboarding_status.organization_type = "fire_department"
            onboarding_status.current_step = 2

        await db.commit()

        return {
            "message": "Department information saved",
            "organization_id": str(org.id),
            "name": data.name
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/session/email")
async def save_email_config(
    request: Request,
    data: EmailConfigRequest,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Save email configuration to session

    Stores email platform and configuration server-side.
    Sensitive values should be encrypted in production.
    """
    session = await get_or_create_session(request, db)

    response.set_cookie(
        key="onboarding_session_id",
        value=session.session_id,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=7200
    )

    # Update session with email config (exclude sensitive data from logging)
    session.data = {
        **session.data,
        "email": {
            "platform": data.platform,
            "configured": True
        }
    }

    # Update onboarding status
    service = OnboardingService(db)
    onboarding_status = await service.get_onboarding_status()
    if onboarding_status:
        onboarding_status.email_configured = True

    await db.commit()

    return {
        "message": "Email configuration saved",
        "platform": data.platform
    }


@router.post("/session/file-storage")
async def save_file_storage_config(
    request: Request,
    data: FileStorageConfigRequest,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Save file storage configuration to session
    """
    session = await get_or_create_session(request, db)

    response.set_cookie(
        key="onboarding_session_id",
        value=session.session_id,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=7200
    )

    session.data = {
        **session.data,
        "file_storage": {
            "platform": data.platform,
            "configured": True
        }
    }
    await db.commit()

    return {
        "message": "File storage configuration saved",
        "platform": data.platform
    }


@router.post("/session/auth")
async def save_auth_platform(
    request: Request,
    data: AuthPlatformRequest,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Save authentication platform choice
    """
    session = await get_or_create_session(request, db)

    response.set_cookie(
        key="onboarding_session_id",
        value=session.session_id,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=7200
    )

    session.data = {
        **session.data,
        "auth": {
            "platform": data.platform
        }
    }
    await db.commit()

    return {
        "message": "Authentication platform saved",
        "platform": data.platform
    }


@router.post("/session/it-team")
async def save_it_team(
    request: Request,
    data: ITTeamRequest,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Save IT team information
    """
    session = await get_or_create_session(request, db)

    response.set_cookie(
        key="onboarding_session_id",
        value=session.session_id,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=7200
    )

    session.data = {
        **session.data,
        "it_team": {
            "members": [member.dict() for member in data.it_team],
            "backup_access": data.backup_access.dict()
        }
    }
    await db.commit()

    return {
        "message": "IT team information saved",
        "team_size": len(data.it_team)
    }


@router.post("/session/modules")
async def save_module_config(
    request: Request,
    data: ModuleConfigRequest,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Save module configuration
    """
    session = await get_or_create_session(request, db)

    response.set_cookie(
        key="onboarding_session_id",
        value=session.session_id,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=7200
    )

    # Update session
    session.data = {
        **session.data,
        "modules": data.modules
    }

    # Also update onboarding status
    service = OnboardingService(db)
    await service.configure_modules(data.modules)

    await db.commit()

    return {
        "message": "Module configuration saved",
        "modules": data.modules
    }


@router.get("/session/data")
async def get_session_data(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Get current session data (for debugging/resuming)
    """
    from sqlalchemy import select
    from datetime import datetime

    session_id = request.cookies.get("onboarding_session_id")

    if not session_id:
        return {"has_session": False, "data": {}}

    result = await db.execute(
        select(OnboardingSessionModel).where(
            OnboardingSessionModel.session_id == session_id,
            OnboardingSessionModel.expires_at > datetime.utcnow()
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        return {"has_session": False, "data": {}}

    return {
        "has_session": True,
        "data": session.data,
        "expires_at": session.expires_at.isoformat()
    }
