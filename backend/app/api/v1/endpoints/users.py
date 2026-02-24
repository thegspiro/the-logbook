"""
Users API Endpoints

Endpoints for user management and listing.
"""

from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, or_
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
    AdminPasswordReset,
    UserUpdate,
    MemberAuditLogEntry,
    DeletionImpactResponse,
)
from app.schemas.role import UserRoleAssignment, UserRoleResponse
from app.services.user_service import UserService
from app.services.organization_service import OrganizationService
from app.models.user import User, Role, UserStatus, user_roles
from app.models.audit import AuditLog
from app.api.dependencies import get_current_user, require_permission, _collect_user_permissions, _has_permission
from app.core.config import settings
# NOTE: Authentication is now implemented
# from app.api.dependencies import get_current_active_user, get_user_organization
# from app.models.user import Organization


router = APIRouter()


@router.get("", response_model=List[UserListResponse])
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


@router.post("", response_model=UserWithRolesResponse, status_code=status.HTTP_201_CREATED)
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
    from app.core.security import hash_password, generate_temporary_password

    # Check if username already exists
    result = await db.execute(
        select(User)
        .where(User.username == user_data.username)
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )

    # Check if membership number already exists in the organization
    if user_data.membership_number:
        result = await db.execute(
            select(User)
            .where(User.membership_number == user_data.membership_number)
            .where(User.organization_id == str(current_user.organization_id))
            .where(User.deleted_at.is_(None))
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A member with this membership number already exists"
            )

    # Check if email already exists (including archived members)
    result = await db.execute(
        select(User)
        .where(User.email == user_data.email)
        .where(User.organization_id == str(current_user.organization_id))
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

    # Use admin-provided password or generate a temporary one
    password_was_generated = False
    if user_data.password:
        from app.core.security import validate_password_strength
        is_valid, error_msg = validate_password_strength(user_data.password)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg,
            )
        initial_password = user_data.password
        password_hash = hash_password(initial_password)
    else:
        initial_password = generate_temporary_password()
        password_hash = hash_password(initial_password)
        password_was_generated = True

    # Create new user
    new_user = User(
        id=str(uuid4()),
        organization_id=current_user.organization_id,
        username=user_data.username,
        email=user_data.email,
        password_hash=password_hash,
        first_name=user_data.first_name,
        middle_name=user_data.middle_name,
        last_name=user_data.last_name,
        membership_number=user_data.membership_number,
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
        must_change_password=True,
    )

    db.add(new_user)
    await db.flush()  # Flush to get the user ID

    # Assign initial roles if provided
    if user_data.role_ids:
        # Verify all role IDs exist and belong to the organization
        result = await db.execute(
            select(Role)
            .where(Role.id.in_([str(rid) for rid in user_data.role_ids]))
            .where(Role.organization_id == str(current_user.organization_id))
        )
        roles = result.scalars().all()

        if len(roles) != len(user_data.role_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more role IDs are invalid"
            )

        for role in roles:
            await db.execute(
                user_roles.insert().values(
                    user_id=new_user.id,
                    position_id=role.id,
                    assigned_by=current_user.id,
                )
            )

    # Capture assigned role IDs before commit expires the relationship
    assigned_role_ids = [str(r.id) for r in roles] if user_data.role_ids else []

    await db.commit()

    # Re-query with eager loading so Pydantic can serialize roles without lazy loading
    result = await db.execute(
        select(User)
        .where(User.id == new_user.id)
        .options(selectinload(User.positions))
    )
    new_user = result.scalar_one_or_none()
    if not new_user:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="User disappeared after creation")

    await log_audit_event(
        db=db,
        event_type="user_created",
        event_category="user_management",
        severity="info",
        event_data={
            "new_user_id": str(new_user.id),
            "username": new_user.username,
            "email": new_user.email,
            "roles_assigned": assigned_role_ids,
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
            select(OrgModel).where(OrgModel.id == str(current_user.organization_id))
        )
        organization = org_result.scalar_one_or_none()

        org_name = organization.name if organization else "The Logbook"
        login_url = f"{settings.FRONTEND_URL}/login" if hasattr(settings, 'FRONTEND_URL') and settings.FRONTEND_URL else "/login"

        # Capture scalar values before they expire after the response returns
        welcome_email = new_user.email
        welcome_first = new_user.first_name
        welcome_last = new_user.last_name
        welcome_username = new_user.username
        welcome_org_id = str(current_user.organization_id)

        async def _send_welcome():
            try:
                email_svc = EmailService(organization)
                await email_svc.send_welcome_email(
                    to_email=welcome_email,
                    first_name=welcome_first,
                    last_name=welcome_last,
                    username=welcome_username,
                    temp_password=initial_password,
                    organization_name=org_name,
                    login_url=login_url,
                    organization_id=welcome_org_id,
                )
            except Exception as e:
                logger.error(f"Failed to send welcome email to {welcome_email}: {e}")

        background_tasks.add_task(_send_welcome)

    # Build response — temporary passwords are communicated only via the
    # welcome email, never in API responses (prevents caching/logging leaks).
    response = UserWithRolesResponse.model_validate(new_user)
    return response


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
        .where(User.organization_id == str(current_user.organization_id))
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
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
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
    current_user: User = Depends(require_permission("users.update_positions", "members.assign_positions", "users.update_roles", "members.assign_roles")),
):
    """
    Assign roles to a user (replaces all existing roles)

    Requires `users.update_roles` or `members.assign_roles` permission.

    **Authentication required**
    """
    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
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
            .where(Role.id.in_([str(rid) for rid in role_assignment.role_ids]))
            .where(Role.organization_id == str(current_user.organization_id))
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
        delete(user_roles).where(user_roles.c.user_id == str(user_id))
    )

    # Assign new roles
    user.roles = roles
    await db.commit()

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found after role assignment")

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
    current_user: User = Depends(require_permission("users.update_positions", "members.assign_positions", "users.update_roles", "members.assign_roles")),
):
    """
    Add a single role to a user (keeps existing roles)

    Requires `users.update_roles` or `members.assign_roles` permission.

    **Authentication required**
    """
    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
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
        .where(Role.id == str(role_id))
        .where(Role.organization_id == str(current_user.organization_id))
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

    # Capture role name before commit expires the ORM object
    added_role_name = role.name

    # Add role
    user.roles.append(role)
    await db.commit()

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found after role addition")

    await log_audit_event(
        db=db,
        event_type="user_role_assigned",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "role_id": str(role_id),
            "role_name": added_role_name,
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
    current_user: User = Depends(require_permission("users.update_positions", "members.assign_positions", "users.update_roles", "members.assign_roles")),
):
    """
    Remove a role from a user

    Requires `users.update_roles` or `members.assign_roles` permission.

    **Authentication required**
    """
    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Find and remove role (cast to str since role.id is String, role_id is UUID)
    role_to_remove = None
    for role in user.roles:
        if str(role.id) == str(role_id):
            role_to_remove = role
            break

    if not role_to_remove:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not have this role"
        )

    role_removed_name = role_to_remove.name
    user.roles.remove(role_to_remove)
    await db.commit()

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found after role removal")

    await log_audit_event(
        db=db,
        event_type="user_role_removed",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "role_id": str(role_id),
            "role_name": role_removed_name,
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
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
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
    if current_user.id != str(user_id):
        # Admins with users.edit or members.manage can update other users
        user_perms = _collect_user_permissions(current_user)
        if not _has_permission("users.edit", user_perms) and not _has_permission("members.manage", user_perms):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only update your own contact information"
            )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
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
            .where(User.organization_id == str(current_user.organization_id))
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

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found after contact update")

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


@router.patch("/{user_id}/profile", response_model=UserProfileResponse)
async def update_user_profile(
    user_id: UUID,
    profile_update: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update user profile information (name, address, emergency contacts, etc.)

    Users can update their own profile. Admins with users.edit or members.manage
    permission can update any user's profile.

    **Authentication required**
    """
    # Check if user is updating their own profile or has admin permissions
    is_self = str(current_user.id) == str(user_id)
    if not is_self:
        # Eagerly load positions so _collect_user_permissions can iterate safely
        perm_result = await db.execute(
            select(User)
            .where(User.id == current_user.id)
            .options(selectinload(User.positions))
        )
        perm_user = perm_result.scalar_one()
        user_permissions = _collect_user_permissions(perm_user)
        if not _has_permission("users.update", user_permissions) and not _has_permission("members.manage", user_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to update this user's profile"
            )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Update only provided fields
    update_data = profile_update.model_dump(exclude_unset=True)

    # Check membership_number uniqueness within the organization
    if "membership_number" in update_data and update_data["membership_number"]:
        existing = await db.execute(
            select(User)
            .where(User.membership_number == update_data["membership_number"])
            .where(User.organization_id == str(current_user.organization_id))
            .where(User.id != str(user_id))
            .where(User.deleted_at.is_(None))
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A member with this membership number already exists"
            )

    # Rank, station, and membership number changes restricted to leadership / secretary / membership coordinator
    restricted_fields = {"rank", "station", "membership_number"}
    has_restricted = restricted_fields & update_data.keys()
    if has_restricted:
        perm_result = await db.execute(
            select(User).where(User.id == current_user.id).options(selectinload(User.positions))
        )
        perm_user = perm_result.scalar_one_or_none()
        if not perm_user or not _has_permission("members.manage", _collect_user_permissions(perm_user)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only leadership, the secretary, or the membership coordinator can update rank, station, or membership number"
            )

    # Handle emergency_contacts separately (needs serialization)
    if "emergency_contacts" in update_data:
        ec_list = update_data.pop("emergency_contacts")
        if ec_list is not None:
            user.emergency_contacts = [ec.model_dump() if hasattr(ec, 'model_dump') else ec for ec in profile_update.emergency_contacts]

    # Allowlist of safe fields to prevent mass-assignment of sensitive columns
    ALLOWED_PROFILE_FIELDS = {
        "first_name", "middle_name", "last_name", "membership_number", "phone", "mobile",
        "personal_email", "date_of_birth", "hire_date", "rank", "station",
        "address_street", "address_city", "address_state", "address_zip", "address_country",
    }
    for field, value in update_data.items():
        if field in ALLOWED_PROFILE_FIELDS and hasattr(user, field):
            setattr(user, field, value)

    await db.commit()

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found after profile update")

    await log_audit_event(
        db=db,
        event_type="user_profile_updated",
        event_category="user_management",
        severity="info",
        event_data={
            "updated_user_id": str(user_id),
            "updated_by": str(current_user.id),
            "is_self_update": is_self,
            "fields_updated": list(profile_update.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: UUID,
    hard: bool = Query(False, description="Permanently delete the member and all associated records"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Delete a member. By default this is a soft-delete (sets deleted_at).
    Pass `hard=true` to permanently delete the member and all associated records.

    Requires `members.manage` permission.

    **Authentication required**
    """
    if str(user_id) == str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )

    # For hard delete, include soft-deleted users too
    query = select(User).where(
        User.id == str(user_id),
        User.organization_id == str(current_user.organization_id),
    )
    if not hard:
        query = query.where(User.deleted_at.is_(None))

    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Capture values before delete/commit
    deleted_username = user.username
    deleted_full_name = user.full_name

    if hard:
        # Remove role assignments first
        await db.execute(
            delete(user_roles).where(user_roles.c.user_id == str(user_id))
        )
        # Hard delete the user record
        await db.delete(user)
        await db.commit()

        await log_audit_event(
            db=db,
            event_type="user_hard_deleted",
            event_category="user_management",
            severity="critical",
            event_data={
                "deleted_user_id": str(user_id),
                "deleted_username": deleted_username,
                "deleted_full_name": deleted_full_name,
                "action": "permanent_deletion",
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    else:
        user.deleted_at = datetime.now(timezone.utc)
        await db.commit()

        await log_audit_event(
            db=db,
            event_type="user_deleted",
            event_category="user_management",
            severity="warning",
            event_data={
                "deleted_user_id": str(user_id),
                "deleted_username": deleted_username,
                "deleted_full_name": deleted_full_name,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )


@router.post("/{user_id}/reset-password", status_code=status.HTTP_200_OK)
async def admin_reset_password(
    user_id: UUID,
    reset_data: AdminPasswordReset,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.create", "members.manage")),
):
    """
    Reset a user's password (IT Lead / Admin only)

    Allows administrators to set a new password for any member.
    By default the user is required to change the password on next login.

    Requires `users.create` or `members.manage` permission.

    **Authentication required**
    """
    from app.core.security import hash_password, validate_password_strength

    if str(user_id) == str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use the change-password endpoint to change your own password",
        )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Validate the new password
    is_valid, error_msg = validate_password_strength(reset_data.new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )

    # Capture username before commit
    target_username = user.username

    user.password_hash = hash_password(reset_data.new_password)
    user.must_change_password = reset_data.force_change
    user.failed_login_attempts = 0
    user.locked_until = None
    # Only update password_changed_at if user is NOT forced to change password,
    # otherwise the HIPAA minimum password age check would block their required change.
    if not reset_data.force_change:
        user.password_changed_at = datetime.now(timezone.utc)

    await db.commit()

    await log_audit_event(
        db=db,
        event_type="admin_password_reset",
        event_category="user_management",
        severity="warning",
        event_data={
            "target_user_id": str(user_id),
            "target_username": target_username,
            "force_change": reset_data.force_change,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {"message": f"Password has been reset for {target_username}"}


@router.get("/{user_id}/deletion-impact", response_model=DeletionImpactResponse)
async def get_deletion_impact(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Get the impact of deleting a member (how many records would be affected).

    Requires `members.manage` permission.

    **Authentication required**
    """
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Count training records
    training_count = 0
    try:
        from app.models.training import TrainingRecord as TrainingRecordModel
        tr_result = await db.execute(
            select(func.count()).select_from(TrainingRecordModel).where(
                TrainingRecordModel.user_id == str(user_id)
            )
        )
        training_count = tr_result.scalar() or 0
    except Exception:
        pass

    # Count inventory assignments
    inventory_count = 0
    try:
        from app.models.inventory import InventoryAssignment
        inv_result = await db.execute(
            select(func.count()).select_from(InventoryAssignment).where(
                InventoryAssignment.user_id == str(user_id),
                InventoryAssignment.returned_at.is_(None),
            )
        )
        inventory_count = inv_result.scalar() or 0
    except Exception:
        pass

    total = training_count + inventory_count

    return DeletionImpactResponse(
        user_id=str(user_id),
        full_name=user.full_name,
        status=user.status.value if hasattr(user.status, 'value') else str(user.status),
        training_records=training_count,
        inventory_items=inventory_count,
        total_records=total,
    )


@router.post("/{user_id}/photo", status_code=status.HTTP_200_OK)
async def upload_photo(
    user_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Upload a profile photo for a member.

    Security measures:
    - MIME type validation (only jpeg, png, webp)
    - File size limit (5MB)
    - Image re-encoding to prevent polyglot attacks
    - EXIF metadata stripping
    - Resize to max 512x512

    Self-upload allowed; admins with `members.manage` can upload for others.

    **Authentication required**
    """
    import io
    import base64

    # Permission check
    is_self = str(current_user.id) == str(user_id)
    if not is_self:
        perm_result = await db.execute(
            select(User).where(User.id == current_user.id).options(selectinload(User.positions))
        )
        perm_user = perm_result.scalar_one()
        user_permissions = _collect_user_permissions(perm_user)
        if not _has_permission("members.manage", user_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only upload your own photo",
            )

    # File size check (5MB)
    MAX_SIZE = 5 * 1024 * 1024
    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size must be under 5MB",
        )

    # MIME type validation using file content (not just extension)
    ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
    try:
        import magic
        detected_mime = magic.from_buffer(contents, mime=True)
    except ImportError:
        # Fallback: check file header bytes
        if contents[:8] == b'\x89PNG\r\n\x1a\n':
            detected_mime = "image/png"
        elif contents[:2] == b'\xff\xd8':
            detected_mime = "image/jpeg"
        elif contents[:4] == b'RIFF' and contents[8:12] == b'WEBP':
            detected_mime = "image/webp"
        else:
            detected_mime = "unknown"

    if detected_mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: JPEG, PNG, WebP. Detected: {detected_mime}",
        )

    # Optimize image: resize, strip EXIF, convert to WebP (smaller files)
    try:
        from app.utils.image_processing import optimize_image, IMAGE_SIZE_LIMITS

        clean_contents = optimize_image(
            contents,
            max_size=IMAGE_SIZE_LIMITS["avatar"],  # 400x400 for profile photos
            quality=85,
            output_format="WEBP",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to process image: {str(e)}",
        )

    # Store as base64 data URI
    photo_data_uri = f"data:image/webp;base64,{base64.b64encode(clean_contents).decode()}"

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.photo_url = photo_data_uri
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="user_photo_updated",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "is_self_update": is_self,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {"message": "Photo uploaded successfully", "photo_url": photo_data_uri}


@router.delete("/{user_id}/photo", status_code=status.HTTP_200_OK)
async def delete_photo(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Remove a member's profile photo.

    Self-removal allowed; admins with `members.manage` can remove for others.

    **Authentication required**
    """
    is_self = str(current_user.id) == str(user_id)
    if not is_self:
        perm_result = await db.execute(
            select(User).where(User.id == current_user.id).options(selectinload(User.positions))
        )
        perm_user = perm_result.scalar_one()
        user_permissions = _collect_user_permissions(perm_user)
        if not _has_permission("members.manage", user_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only remove your own photo",
            )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.photo_url = None
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="user_photo_removed",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "is_self_update": is_self,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {"message": "Photo removed successfully"}


# Human-readable descriptions for audit event types
_AUDIT_EVENT_DESCRIPTIONS = {
    "user_created": "Member account created",
    "user_deleted": "Member account deactivated (soft delete)",
    "user_hard_deleted": "Member account permanently deleted",
    "user_profile_updated": "Member profile updated",
    "user_updated": "Member contact information updated",
    "user_role_assigned": "Member role assignment changed",
    "user_role_removed": "Role removed from member",
    "user_viewed": "Member profile viewed",
    "admin_password_reset": "Password reset by administrator",
    "user_photo_updated": "Profile photo updated",
    "user_photo_removed": "Profile photo removed",
    "member_status_changed": "Member status changed",
    "membership_type_changed": "Membership type changed",
    "member_archived": "Member archived",
    "member_reactivated": "Member reactivated",
    "leave_of_absence_created": "Leave of absence created",
    "leave_of_absence_updated": "Leave of absence updated",
    "leave_of_absence_deleted": "Leave of absence deactivated",
}


@router.get("/{user_id}/audit-history", response_model=List[MemberAuditLogEntry])
async def get_member_audit_history(
    user_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Get audit history for a specific member.

    Returns a chronological log of changes to the member's record including
    who made each change, what was changed, and when.

    Requires `members.manage` permission.

    **Authentication required**
    """
    # Verify the target user exists in the same org
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Relevant event types for member history
    member_event_types = list(_AUDIT_EVENT_DESCRIPTIONS.keys())

    # Query audit logs where this user is the target (in event_data)
    # We search for the user_id appearing in the JSON event_data
    user_id_str = str(user_id)
    query = (
        select(AuditLog)
        .where(AuditLog.event_type.in_(member_event_types))
        .where(AuditLog.event_category == "user_management")
        .where(
            or_(
                # User was the target of the action
                AuditLog.event_data["target_user_id"].as_string() == user_id_str,
                AuditLog.event_data["new_user_id"].as_string() == user_id_str,
                AuditLog.event_data["updated_user_id"].as_string() == user_id_str,
                AuditLog.event_data["deleted_user_id"].as_string() == user_id_str,
                AuditLog.event_data["viewed_user_id"].as_string() == user_id_str,
                # User performed the action on themselves
                AuditLog.user_id == user_id_str,
            )
        )
        .order_by(AuditLog.timestamp.desc())
    )

    if event_type:
        query = query.where(AuditLog.event_type == event_type)

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    logs = result.scalars().all()

    # Convert to response format
    entries = []
    for log in logs:
        description = _AUDIT_EVENT_DESCRIPTIONS.get(log.event_type, log.event_type)

        # Enhance description with details from event_data
        data = log.event_data or {}
        if log.event_type == "user_profile_updated":
            fields = data.get("fields_updated", [])
            if fields:
                description += f": {', '.join(fields)}"
        elif log.event_type == "user_role_assigned":
            action = data.get("action", "")
            role_name = data.get("role_name", "")
            if action == "role_added" and role_name:
                description = f"Role added: {role_name}"
            elif action == "role_removed" and role_name:
                description = f"Role removed: {role_name}"
            elif action == "roles_replaced":
                description = "All roles replaced"
        elif log.event_type == "member_status_changed":
            prev = data.get("previous_status", "")
            new = data.get("new_status", "")
            if prev and new:
                description = f"Status changed: {prev} → {new}"

        entries.append(MemberAuditLogEntry(
            id=log.id,
            timestamp=log.timestamp,
            event_type=log.event_type,
            severity=log.severity.value if hasattr(log.severity, 'value') else str(log.severity),
            description=description,
            changed_by_username=log.username,
            changed_by_user_id=log.user_id,
            event_data=data,
        ))

    return entries
