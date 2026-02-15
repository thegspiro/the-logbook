"""
Users API Endpoints

Endpoints for user management and listing.
"""

from typing import List
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.schemas.user import (
    UserListResponse,
    UserWithRolesResponse,
    ContactInfoUpdate,
    UserProfileResponse,
    AdminUserCreate,
)
from app.schemas.role import UserRoleAssignment, UserRoleResponse
from app.services.user_service import UserService
from app.services.organization_service import OrganizationService
from app.models.user import User, Role, UserStatus, user_roles
from app.api.dependencies import get_current_user, require_permission
from app.core.config import settings
# NOTE: Authentication is now implemented
# from app.api.dependencies import get_current_active_user, get_user_organization
# from app.models.user import Organization


router = APIRouter()


@router.get("/", response_model=List[UserListResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all members in the organization

    Contact information (email, phone, mobile) will be included only if:
    1. The organization has enabled contact info visibility in settings
    2. The specific fields (email, phone, mobile) are enabled

    A privacy notice should be displayed when contact information is shown,
    stating that it is for department purposes only and should not be used
    for commercial purposes.

    **Authentication required**
    """
    user_service = UserService(db)
    org_service = OrganizationService(db)

    # Get organization settings — if this fails, still return users without
    # contact info rather than returning a 500 that hides the member list.
    include_contact_info = False
    contact_settings = None
    try:
        org_settings = await org_service.get_organization_settings(current_user.organization_id)
        include_contact_info = org_settings.contact_info_visibility.enabled
        contact_settings = {
            "contact_info_visibility": {
                "show_email": org_settings.contact_info_visibility.show_email,
                "show_phone": org_settings.contact_info_visibility.show_phone,
                "show_mobile": org_settings.contact_info_visibility.show_mobile,
            }
        }
    except Exception as e:
        logger.warning(f"Failed to load organization settings, returning users without contact info: {e}")

    # Get users with conditional contact info
    users = await user_service.get_users_for_organization(
        organization_id=current_user.organization_id,
        include_contact_info=include_contact_info,
        contact_settings=contact_settings,
    )

    return users


@router.post("/", response_model=UserWithRolesResponse, status_code=status.HTTP_201_CREATED)
async def create_member(
    user_data: AdminUserCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.create")),
):
    """
    Create a new member (Secretary/Admin only)

    Allows secretaries and admins to create new member accounts with initial roles.
    A temporary password will be generated and sent via email if send_welcome_email is True.

    Requires `users.create` permission.

    **Authentication required**
    """
    from uuid import uuid4
    from app.core.security import hash_password
    import secrets
    import string

    # Check if username already exists
    result = await db.execute(
        select(User)
        .where(User.username == user_data.username)
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )

    # Check if email already exists (including archived members)
    result = await db.execute(
        select(User)
        .where(User.email == user_data.email)
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
    )
    existing_user = result.scalar_one_or_none()
    if existing_user:
        if existing_user.status == UserStatus.ARCHIVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": (
                        f"An archived member with this email already exists: "
                        f"{existing_user.full_name}. Use the reactivation endpoint "
                        f"to restore their account instead of creating a duplicate."
                    ),
                    "existing_user_id": str(existing_user.id),
                    "existing_member_name": existing_user.full_name,
                    "existing_status": existing_user.status.value,
                    "reactivate_url": f"/api/v1/users/{existing_user.id}/reactivate",
                },
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already exists"
        )

    # Generate temporary password
    temp_password = ''.join(secrets.choice(string.ascii_letters + string.digits + "!@#$%^&*") for _ in range(16))

    # Create new user
    new_user = User(
        id=str(uuid4()),
        organization_id=current_user.organization_id,
        username=user_data.username,
        email=user_data.email,
        password_hash=hash_password(temp_password),
        first_name=user_data.first_name,
        middle_name=user_data.middle_name,
        last_name=user_data.last_name,
        badge_number=user_data.badge_number,
        phone=user_data.phone,
        mobile=user_data.mobile,
        date_of_birth=user_data.date_of_birth,
        hire_date=user_data.hire_date,
        # Department info
        rank=user_data.rank,
        station=user_data.station,
        # Address
        address_street=user_data.address_street,
        address_city=user_data.address_city,
        address_state=user_data.address_state,
        address_zip=user_data.address_zip,
        address_country=user_data.address_country,
        # Emergency contacts (stored as JSON)
        emergency_contacts=[ec.model_dump() for ec in user_data.emergency_contacts],
        email_verified=False,
        status=UserStatus.ACTIVE,
    )

    db.add(new_user)
    await db.flush()  # Flush to get the user ID

    # Assign initial roles if provided
    if user_data.role_ids:
        # Verify all role IDs exist and belong to the organization
        result = await db.execute(
            select(Role)
            .where(Role.id.in_(user_data.role_ids))
            .where(Role.organization_id == current_user.organization_id)
        )
        roles = result.scalars().all()

        if len(roles) != len(user_data.role_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more role IDs are invalid"
            )

        new_user.roles = roles

    await db.commit()
    await db.refresh(new_user, ["roles"])

    await log_audit_event(
        db=db,
        event_type="user_created",
        event_category="user_management",
        severity="info",
        event_data={
            "new_user_id": str(new_user.id),
            "username": new_user.username,
            "email": new_user.email,
            "roles_assigned": [str(r.id) for r in new_user.roles],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    # Send welcome email with temporary password via background task
    if user_data.send_welcome_email:
        from loguru import logger
        from app.services.email_service import EmailService
        from app.models.user import Organization as OrgModel

        logger.info(f"Welcome email requested for new user: {user_data.username}")

        # Load organization for email config
        org_result = await db.execute(
            select(OrgModel).where(OrgModel.id == current_user.organization_id)
        )
        organization = org_result.scalar_one_or_none()

        org_name = organization.name if organization else "The Logbook"
        login_url = f"{settings.FRONTEND_URL}/login" if hasattr(settings, 'FRONTEND_URL') and settings.FRONTEND_URL else "/login"

        async def _send_welcome():
            try:
                email_svc = EmailService(organization)
                await email_svc.send_welcome_email(
                    to_email=new_user.email,
                    first_name=new_user.first_name,
                    last_name=new_user.last_name,
                    username=new_user.username,
                    temp_password=temp_password,
                    organization_name=org_name,
                    login_url=login_url,
                    organization_id=str(current_user.organization_id),
                )
            except Exception as e:
                logger.error(f"Failed to send welcome email to {new_user.email}: {e}")

        background_tasks.add_task(_send_welcome)

    return new_user


@router.get("/contact-info-enabled")
async def check_contact_info_enabled(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check if contact information display is enabled for the organization

    This endpoint can be used by the frontend to determine whether to show
    the privacy notice and contact information fields.

    **Authentication required**
    """
    org_service = OrganizationService(db)
    settings = await org_service.get_organization_settings(current_user.organization_id)

    return {
        "enabled": settings.contact_info_visibility.enabled,
        "show_email": settings.contact_info_visibility.show_email,
        "show_phone": settings.contact_info_visibility.show_phone,
        "show_mobile": settings.contact_info_visibility.show_mobile,
    }


@router.get("/with-roles", response_model=List[UserWithRolesResponse])
async def list_users_with_roles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.view", "members.manage")),
):
    """
    List all users with their assigned roles

    This endpoint is for the Members admin page.
    Requires `users.view` or `members.manage` permission.

    **Authentication required**
    """
    result = await db.execute(
        select(User)
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
        .order_by(User.last_name, User.first_name)
    )
    users = result.scalars().all()

    return users


@router.get("/{user_id}/roles", response_model=UserRoleResponse)
async def get_user_roles(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get roles assigned to a specific user

    **Authentication required**
    """
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "roles": user.roles
    }


@router.put("/{user_id}/roles", response_model=UserRoleResponse)
async def assign_user_roles(
    user_id: UUID,
    role_assignment: UserRoleAssignment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.update_roles", "members.assign_roles")),
):
    """
    Assign roles to a user (replaces all existing roles)

    Requires `users.update_roles` or `members.assign_roles` permission.

    **Authentication required**
    """
    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify all role IDs exist and belong to the same organization
    if role_assignment.role_ids:
        result = await db.execute(
            select(Role)
            .where(Role.id.in_(role_assignment.role_ids))
            .where(Role.organization_id == current_user.organization_id)
        )
        roles = result.scalars().all()

        if len(roles) != len(role_assignment.role_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more role IDs are invalid"
            )
    else:
        roles = []

    # Remove all existing role assignments
    await db.execute(
        delete(user_roles).where(user_roles.c.user_id == user_id)
    )

    # Assign new roles
    user.roles = roles
    await db.commit()
    await db.refresh(user)

    await log_audit_event(
        db=db,
        event_type="user_role_assigned",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "role_ids": [str(r) for r in role_assignment.role_ids],
            "action": "roles_replaced",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "roles": user.roles
    }


@router.post("/{user_id}/roles/{role_id}", response_model=UserRoleResponse)
async def add_role_to_user(
    user_id: UUID,
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.update_roles", "members.assign_roles")),
):
    """
    Add a single role to a user (keeps existing roles)

    Requires `users.update_roles` or `members.assign_roles` permission.

    **Authentication required**
    """
    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Get role
    result = await db.execute(
        select(Role)
        .where(Role.id == role_id)
        .where(Role.organization_id == current_user.organization_id)
    )
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )

    # Check if user already has this role
    if role in user.roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already has this role"
        )

    # Add role
    user.roles.append(role)
    await db.commit()
    await db.refresh(user)

    await log_audit_event(
        db=db,
        event_type="user_role_assigned",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "role_id": str(role_id),
            "role_name": role.name,
            "action": "role_added",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "roles": user.roles
    }


@router.delete("/{user_id}/roles/{role_id}", response_model=UserRoleResponse)
async def remove_role_from_user(
    user_id: UUID,
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.update_roles", "members.assign_roles")),
):
    """
    Remove a role from a user

    Requires `users.update_roles` or `members.assign_roles` permission.

    **Authentication required**
    """
    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Find and remove role
    role_to_remove = None
    for role in user.roles:
        if role.id == role_id:
            role_to_remove = role
            break

    if not role_to_remove:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not have this role"
        )

    user.roles.remove(role_to_remove)
    await db.commit()
    await db.refresh(user)

    await log_audit_event(
        db=db,
        event_type="user_role_removed",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "role_id": str(role_id),
            "role_name": role_to_remove.name,
            "action": "role_removed",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "roles": user.roles
    }


@router.get("/{user_id}/with-roles", response_model=UserProfileResponse)
async def get_user_with_roles(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific user with their assigned roles and notification preferences

    This endpoint is for the member profile page.
    Users can view any member's profile, but can only see notification preferences for their own profile.

    **Authentication required**
    """
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    await log_audit_event(
        db=db,
        event_type="user_viewed",
        event_category="user_management",
        severity="info",
        event_data={
            "viewed_user_id": str(user_id),
            "viewed_username": user.username,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return user


@router.patch("/{user_id}/contact-info", response_model=UserProfileResponse)
async def update_contact_info(
    user_id: UUID,
    contact_update: ContactInfoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update user contact information and notification preferences

    Users can only update their own contact information unless they have admin permissions.

    **Authentication required**
    """
    # Check if user is updating their own profile or has admin permissions
    if current_user.id != user_id:
        # Admins with users.update or members.manage can update other users
        user_permissions = []
        for role in current_user.roles:
            user_permissions.extend(role.permissions or [])
        if "users.update" not in user_permissions and "members.manage" not in user_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only update your own contact information"
            )

    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Update fields if provided
    if contact_update.email is not None:
        # Check if email is already in use by another user in the organization
        existing = await db.execute(
            select(User)
            .where(User.email == contact_update.email)
            .where(User.organization_id == current_user.organization_id)
            .where(User.id != user_id)
            .where(User.deleted_at.is_(None))
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is already in use"
            )
        user.email = contact_update.email

    if contact_update.phone is not None:
        user.phone = contact_update.phone

    if contact_update.mobile is not None:
        user.mobile = contact_update.mobile

    if contact_update.notification_preferences is not None:
        user.notification_preferences = contact_update.notification_preferences.model_dump()

    await db.commit()
    await db.refresh(user)

    await log_audit_event(
        db=db,
        event_type="user_updated",
        event_category="user_management",
        severity="info",
        event_data={
            "updated_user_id": str(user_id),
            "fields_updated": list(contact_update.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return user
