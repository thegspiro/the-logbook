"""
Onboarding API Endpoints

Handles first-time system setup and configuration.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field, validator
import re

from app.core.database import get_db
from app.services.onboarding import OnboardingService
from app.models.onboarding import OnboardingStatus, OnboardingChecklistItem


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
