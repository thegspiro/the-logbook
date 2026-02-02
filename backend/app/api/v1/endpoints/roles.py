"""
Roles API Endpoints

Post-Onboarding Role Management endpoints for:
- Role CRUD operations (add/edit/delete roles)
- Permission management
- User-role assignments
- Role cloning
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.core.database import get_db
from app.schemas.role import (
    RoleResponse,
    RoleCreate,
    RoleUpdate,
    PermissionDetail,
    PermissionCategory,
    UserRoleAssignment,
    UserRoleResponse,
    RoleCloneRequest,
    RoleWithUserCount,
    RoleUserItem,
    RoleUsersResponse,
    UserPermissionsResponse,
)
from app.models.user import Role, User
from app.core.permissions import (
    get_permission_details,
    get_permissions_by_category,
    get_admin_role_slugs,
)
from app.api.dependencies import get_current_user, require_permission
from app.services.role_service import role_service


router = APIRouter()


# ============================================
# Permission Endpoints
# ============================================

@router.get("/permissions", response_model=List[PermissionDetail])
async def list_permissions():
    """
    Get list of all available permissions

    Returns permission details grouped by category for display in the UI.
    """
    return get_permission_details()


@router.get("/permissions/by-category", response_model=List[PermissionCategory])
async def list_permissions_by_category():
    """
    Get permissions organized by category

    Useful for building permission selection UI with category grouping.
    """
    categorized = get_permissions_by_category()

    result = []
    for category, permissions in categorized.items():
        result.append({
            "category": category,
            "permissions": [
                {
                    "name": p.name,
                    "description": p.description,
                    "category": p.category.value
                }
                for p in permissions
            ]
        })

    return result


# ============================================
# Role CRUD Endpoints
# ============================================

@router.get("/", response_model=List[RoleWithUserCount])
async def list_roles(
    include_user_count: bool = Query(True, description="Include count of users per role"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("roles.view")),
):
    """
    Get all roles for the organization

    Returns all roles including system roles and custom roles with user counts.

    Requires `roles.view` permission.
    **Authentication required**
    """
    roles = await role_service.list_roles(
        db=db,
        organization_id=str(current_user.organization_id),
        include_user_count=include_user_count,
    )

    return roles


@router.post("/", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_role(
    role_data: RoleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("roles.create")),
):
    """
    Create a new custom role

    Requires `roles.create` permission.
    System roles cannot be created through this endpoint.

    **Authentication required**
    """
    try:
        role = await role_service.create_role(
            db=db,
            organization_id=str(current_user.organization_id),
            name=role_data.name,
            slug=role_data.slug,
            permissions=role_data.permissions,
            created_by=str(current_user.id),
            description=role_data.description,
            priority=role_data.priority,
            is_system=False,
        )
        return role
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/{role_id}", response_model=RoleResponse)
async def get_role(
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("roles.view")),
):
    """
    Get a specific role by ID

    Requires `roles.view` permission.
    **Authentication required**
    """
    role = await role_service.get_role(
        db=db,
        role_id=str(role_id),
        organization_id=str(current_user.organization_id),
    )

    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )

    return role


@router.patch("/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: UUID,
    role_update: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("roles.edit", "roles.update")),
):
    """
    Update a role

    Requires `roles.edit` or `roles.update` permission.
    System roles can have their permissions updated, but name/slug cannot be changed.

    **Authentication required**
    """
    try:
        role = await role_service.update_role(
            db=db,
            role_id=str(role_id),
            organization_id=str(current_user.organization_id),
            updated_by=str(current_user.id),
            name=role_update.name,
            description=role_update.description,
            permissions=role_update.permissions,
            priority=role_update.priority,
        )
        return role
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("roles.delete")),
):
    """
    Delete a role

    Requires `roles.delete` permission.
    System roles cannot be deleted.

    **Authentication required**
    """
    try:
        await role_service.delete_role(
            db=db,
            role_id=str(role_id),
            organization_id=str(current_user.organization_id),
            deleted_by=str(current_user.id),
        )
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(e)
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/{role_id}/clone", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def clone_role(
    role_id: UUID,
    clone_request: RoleCloneRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("roles.create")),
):
    """
    Clone an existing role with new name and slug

    Creates a copy of the role with all its permissions.
    The cloned role is always a custom role (not a system role).

    Requires `roles.create` permission.
    **Authentication required**
    """
    try:
        role = await role_service.clone_role(
            db=db,
            source_role_id=str(role_id),
            organization_id=str(current_user.organization_id),
            new_name=clone_request.name,
            new_slug=clone_request.slug,
            created_by=str(current_user.id),
            new_description=clone_request.description,
        )
        return role
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(e)
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/{role_id}/users", response_model=RoleUsersResponse)
async def get_role_users(
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("roles.view", "users.view")),
):
    """
    Get all users assigned to a specific role

    Requires `roles.view` or `users.view` permission.
    **Authentication required**
    """
    role = await role_service.get_role(
        db=db,
        role_id=str(role_id),
        organization_id=str(current_user.organization_id),
    )

    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )

    users = await role_service.get_users_with_role(
        db=db,
        role_id=str(role_id),
        organization_id=str(current_user.organization_id),
    )

    return RoleUsersResponse(
        role_id=role.id,
        role_name=role.name,
        users=[
            RoleUserItem(
                id=user.id,
                username=user.username,
                email=user.email,
                first_name=user.first_name,
                last_name=user.last_name,
                full_name=f"{user.first_name or ''} {user.last_name or ''}".strip() or None,
                is_active=user.is_active,
            )
            for user in users
        ],
        total_count=len(users),
    )


# ============================================
# User-Role Assignment Endpoints
# ============================================

@router.get("/user/{user_id}/roles", response_model=List[RoleResponse])
async def get_user_roles(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.view", "roles.view")),
):
    """
    Get all roles assigned to a specific user

    Requires `users.view` or `roles.view` permission.
    **Authentication required**
    """
    # Verify user exists in same organization
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == current_user.organization_id
        )
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    roles = await role_service.get_user_roles(db=db, user_id=str(user_id))
    return roles


@router.put("/user/{user_id}/roles", response_model=List[RoleResponse])
async def set_user_roles(
    user_id: UUID,
    assignment: UserRoleAssignment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.edit", "roles.assign")),
):
    """
    Set all roles for a user (replaces existing roles)

    This endpoint replaces all current role assignments for the user
    with the provided list of role IDs.

    Requires `users.edit` or `roles.assign` permission.
    **Authentication required**
    """
    # Verify user exists in same organization
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == current_user.organization_id
        )
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify all roles exist in the organization
    for role_id in assignment.role_ids:
        role = await role_service.get_role(
            db=db,
            role_id=str(role_id),
            organization_id=str(current_user.organization_id),
        )
        if not role:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Role {role_id} not found"
            )

    roles = await role_service.set_user_roles(
        db=db,
        user_id=str(user_id),
        role_ids=[str(r) for r in assignment.role_ids],
        set_by=str(current_user.id),
    )

    return roles


@router.post("/user/{user_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def assign_role_to_user(
    user_id: UUID,
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.edit", "roles.assign")),
):
    """
    Assign a single role to a user

    Requires `users.edit` or `roles.assign` permission.
    **Authentication required**
    """
    # Verify user exists in same organization
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == current_user.organization_id
        )
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Verify role exists in the organization
    role = await role_service.get_role(
        db=db,
        role_id=str(role_id),
        organization_id=str(current_user.organization_id),
    )

    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )

    await role_service.assign_role_to_user(
        db=db,
        user_id=str(user_id),
        role_id=str(role_id),
        assigned_by=str(current_user.id),
    )


@router.delete("/user/{user_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_role_from_user(
    user_id: UUID,
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.edit", "roles.assign")),
):
    """
    Remove a role from a user

    Requires `users.edit` or `roles.assign` permission.
    **Authentication required**
    """
    # Verify user exists in same organization
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == current_user.organization_id
        )
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    removed = await role_service.remove_role_from_user(
        db=db,
        user_id=str(user_id),
        role_id=str(role_id),
        removed_by=str(current_user.id),
    )

    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User does not have this role"
        )


@router.get("/user/{user_id}/permissions", response_model=UserPermissionsResponse)
async def get_user_permissions(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.view", "roles.view")),
):
    """
    Get all permissions for a specific user based on their roles

    Requires `users.view` or `roles.view` permission.
    **Authentication required**
    """
    # Verify user exists in same organization
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == current_user.organization_id
        )
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    permissions = await role_service.get_user_permissions(db=db, user_id=str(user_id))
    roles = await role_service.get_user_roles(db=db, user_id=str(user_id))

    return UserPermissionsResponse(
        user_id=user_id,
        permissions=sorted(list(permissions)),
        roles=[role.name for role in roles],
    )


# ============================================
# Current User Endpoints
# ============================================

@router.get("/my/roles", response_model=List[RoleResponse])
async def get_my_roles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all roles assigned to the current user

    No special permissions required - users can always view their own roles.
    **Authentication required**
    """
    roles = await role_service.get_user_roles(db=db, user_id=str(current_user.id))
    return roles


@router.get("/my/permissions", response_model=UserPermissionsResponse)
async def get_my_permissions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all permissions for the current user based on their roles

    No special permissions required - users can always view their own permissions.
    **Authentication required**
    """
    permissions = await role_service.get_user_permissions(db=db, user_id=str(current_user.id))
    roles = await role_service.get_user_roles(db=db, user_id=str(current_user.id))

    return UserPermissionsResponse(
        user_id=current_user.id,
        permissions=sorted(list(permissions)),
        roles=[role.name for role in roles],
    )


# ============================================
# Admin Access Check
# ============================================

@router.get("/admin-access/check")
async def check_admin_access(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check if the current user has access to the Members admin page

    Returns True if the user has one of the admin roles or admin-related permissions.
    **Authentication required**
    """
    # Get user's permissions
    permissions = await role_service.get_user_permissions(db=db, user_id=str(current_user.id))
    roles = await role_service.get_user_roles(db=db, user_id=str(current_user.id))

    # Check for admin access - either through admin roles or specific permissions
    admin_role_slugs = get_admin_role_slugs()
    user_role_slugs = {role.slug for role in roles}

    has_admin_role = bool(user_role_slugs.intersection(admin_role_slugs))

    # Admin permissions that grant access to member management
    admin_permissions = {
        "users.view", "users.create", "users.edit", "users.delete",
        "roles.view", "roles.create", "roles.edit", "roles.delete",
        "admin.access", "members.manage",
    }

    has_admin_permission = bool(permissions.intersection(admin_permissions))

    return {
        "has_access": has_admin_role or has_admin_permission,
        "admin_roles": admin_role_slugs,
        "user_roles": [role.slug for role in roles],
        "admin_permissions": sorted(list(permissions.intersection(admin_permissions))),
    }
