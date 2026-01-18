"""
Roles API Endpoints

Endpoints for role management and permissions.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
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
)
from app.models.user import Role, User
from app.core.permissions import (
    get_permission_details,
    get_permissions_by_category,
    get_admin_role_slugs,
)
# NOTE: Authentication is not yet implemented
# from app.api.dependencies import get_current_active_user, get_user_organization
# from app.models.user import User as CurrentUser, Organization


router = APIRouter()


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


@router.get("/", response_model=List[RoleResponse])
async def list_roles(
    db: AsyncSession = Depends(get_db),
    # Uncomment when authentication is implemented:
    # current_user: CurrentUser = Depends(get_current_active_user),
    # organization: Organization = Depends(get_user_organization),
):
    """
    Get all roles for the organization

    Returns all roles including system roles and custom roles.
    """
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    result = await db.execute(
        select(Role)
        .where(Role.organization_id == test_org_id)
        .order_by(Role.priority.desc(), Role.name)
    )
    roles = result.scalars().all()

    return roles


@router.post("/", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_role(
    role_data: RoleCreate,
    db: AsyncSession = Depends(get_db),
    # Uncomment when authentication is implemented:
    # current_user: CurrentUser = Depends(require_permission("roles.create")),
    # organization: Organization = Depends(get_user_organization),
):
    """
    Create a new custom role

    Requires `roles.create` permission.
    System roles cannot be created through this endpoint.
    """
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType, uuid4
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    # Check if slug already exists
    result = await db.execute(
        select(Role).where(
            Role.organization_id == test_org_id,
            Role.slug == role_data.slug
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role with slug '{role_data.slug}' already exists"
        )

    # Create role
    role = Role(
        id=uuid4(),
        organization_id=test_org_id,
        name=role_data.name,
        slug=role_data.slug,
        description=role_data.description,
        permissions=role_data.permissions,
        is_system=False,  # Custom roles are never system roles
        priority=role_data.priority,
    )

    db.add(role)
    await db.commit()
    await db.refresh(role)

    return role


@router.get("/{role_id}", response_model=RoleResponse)
async def get_role(
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    # Uncomment when authentication is implemented:
    # organization: Organization = Depends(get_user_organization),
):
    """Get a specific role by ID"""
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    result = await db.execute(
        select(Role).where(
            Role.id == role_id,
            Role.organization_id == test_org_id
        )
    )
    role = result.scalar_one_or_none()

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
    # Uncomment when authentication is implemented:
    # current_user: CurrentUser = Depends(require_permission("roles.edit")),
    # organization: Organization = Depends(get_user_organization),
):
    """
    Update a role

    Requires `roles.edit` permission.
    System roles can have their permissions updated, but name/slug cannot be changed.
    """
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    result = await db.execute(
        select(Role).where(
            Role.id == role_id,
            Role.organization_id == test_org_id
        )
    )
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )

    # System roles: only allow permission updates
    if role.is_system:
        if role_update.name is not None or role_update.priority is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="System roles can only have their permissions modified"
            )

    # Update fields
    update_data = role_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(role, field, value)

    await db.commit()
    await db.refresh(role)

    return role


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    # Uncomment when authentication is implemented:
    # current_user: CurrentUser = Depends(require_permission("roles.delete")),
    # organization: Organization = Depends(get_user_organization),
):
    """
    Delete a role

    Requires `roles.delete` permission.
    System roles cannot be deleted.
    """
    # TODO: Use authenticated organization ID
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    result = await db.execute(
        select(Role).where(
            Role.id == role_id,
            Role.organization_id == test_org_id
        )
    )
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )

    if role.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="System roles cannot be deleted"
        )

    await db.delete(role)
    await db.commit()


@router.get("/admin-access/check")
async def check_admin_access(
    # Uncomment when authentication is implemented:
    # current_user: CurrentUser = Depends(get_current_active_user),
):
    """
    Check if the current user has access to the Members admin page

    Returns True if the user has one of the admin roles.
    """
    # TODO: Check current user's roles against admin_role_slugs
    # For now, return the list of admin roles
    return {
        "has_access": False,  # TODO: Implement actual check
        "admin_roles": get_admin_role_slugs(),
        "message": "Authentication not yet implemented"
    }
