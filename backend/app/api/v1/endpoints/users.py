"""
Users API Endpoints

Endpoints for user management and listing.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.core.database import get_db
from app.schemas.user import (
    UserListResponse,
    UserWithRolesResponse,
    ContactInfoUpdate,
    UserProfileResponse,
)
from app.schemas.role import UserRoleAssignment, UserRoleResponse
from app.services.user_service import UserService
from app.services.organization_service import OrganizationService
from app.models.user import User, Role, user_roles
from app.api.dependencies import get_current_user
# NOTE: Authentication is now implemented
# from app.api.dependencies import get_current_active_user, get_user_organization
# from app.models.user import Organization


router = APIRouter()


@router.get("/", response_model=List[UserListResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    # Uncomment when authentication is implemented:
    # current_user: User = Depends(get_current_active_user),
    # organization: Organization = Depends(get_user_organization),
):
    """
    List all members in the organization

    Contact information (email, phone, mobile) will be included only if:
    1. The organization has enabled contact info visibility in settings
    2. The specific fields (email, phone, mobile) are enabled

    A privacy notice should be displayed when contact information is shown,
    stating that it is for department purposes only and should not be used
    for commercial purposes.

    **Authentication required** (currently not implemented)
    """
    # TODO: Remove this once authentication is implemented
    # For now, we'll use a hardcoded organization ID for testing
    # In production, this would come from the authenticated user
    from uuid import UUID
    test_org_id = UUID("00000000-0000-0000-0000-000000000001")

    user_service = UserService(db)
    org_service = OrganizationService(db)

    # Get organization settings
    settings = await org_service.get_organization_settings(test_org_id)

    # Check if contact info visibility is enabled
    include_contact_info = settings.contact_info_visibility.enabled

    # Get users with conditional contact info
    users = await user_service.get_users_for_organization(
        organization_id=test_org_id,
        include_contact_info=include_contact_info,
        contact_settings={
            "contact_info_visibility": {
                "show_email": settings.contact_info_visibility.show_email,
                "show_phone": settings.contact_info_visibility.show_phone,
                "show_mobile": settings.contact_info_visibility.show_mobile,
            }
        }
    )

    return users


@router.get("/contact-info-enabled")
async def check_contact_info_enabled(
    db: AsyncSession = Depends(get_db),
    # Uncomment when authentication is implemented:
    # organization: Organization = Depends(get_user_organization),
):
    """
    Check if contact information display is enabled for the organization

    This endpoint can be used by the frontend to determine whether to show
    the privacy notice and contact information fields.

    **Authentication required** (currently not implemented)
    """
    # TODO: Remove this once authentication is implemented
    from uuid import UUID
    test_org_id = UUID("00000000-0000-0000-0000-000000000001")

    org_service = OrganizationService(db)
    settings = await org_service.get_organization_settings(test_org_id)

    return {
        "enabled": settings.contact_info_visibility.enabled,
        "show_email": settings.contact_info_visibility.show_email,
        "show_phone": settings.contact_info_visibility.show_phone,
        "show_mobile": settings.contact_info_visibility.show_mobile,
    }


@router.get("/with-roles", response_model=List[UserWithRolesResponse])
async def list_users_with_roles(
    db: AsyncSession = Depends(get_db),
    # Uncomment when authentication is implemented:
    # current_user: User = Depends(require_permission("members.manage")),
    # organization: Organization = Depends(get_user_organization),
):
    """
    List all users with their assigned roles

    This endpoint is for the Members admin page.
    Requires `members.manage` permission.

    **Authentication required** (currently not implemented)
    """
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    result = await db.execute(
        select(User)
        .where(User.organization_id == test_org_id)
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
    # Uncomment when authentication is implemented:
    # organization: Organization = Depends(get_user_organization),
):
    """
    Get roles assigned to a specific user

    **Authentication required** (currently not implemented)
    """
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == test_org_id)
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
    # Uncomment when authentication is implemented:
    # current_user: User = Depends(require_permission("members.assign_roles")),
    # organization: Organization = Depends(get_user_organization),
):
    """
    Assign roles to a user (replaces all existing roles)

    Requires `members.assign_roles` permission.

    **Authentication required** (currently not implemented)
    """
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == test_org_id)
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
            .where(Role.organization_id == test_org_id)
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
    # Uncomment when authentication is implemented:
    # current_user: User = Depends(require_permission("members.assign_roles")),
    # organization: Organization = Depends(get_user_organization),
):
    """
    Add a single role to a user (keeps existing roles)

    Requires `members.assign_roles` permission.

    **Authentication required** (currently not implemented)
    """
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == test_org_id)
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
        .where(Role.organization_id == test_org_id)
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
    # Uncomment when authentication is implemented:
    # current_user: User = Depends(require_permission("members.assign_roles")),
    # organization: Organization = Depends(get_user_organization),
):
    """
    Remove a role from a user

    Requires `members.assign_roles` permission.

    **Authentication required** (currently not implemented)
    """
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .where(User.organization_id == test_org_id)
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
    # For now, only allow users to update their own profile
    if current_user.id != user_id:
        # TODO: Add permission check for admins
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

    return user
