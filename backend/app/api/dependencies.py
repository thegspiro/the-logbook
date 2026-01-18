"""
API Dependencies

FastAPI dependencies for authentication, authorization, and database access.
"""

from typing import Optional, List
from fastapi import Depends, HTTPException, status, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.core.database import get_db
from app.models.user import User, Organization, Role
from app.services.auth_service import AuthService


class PermissionChecker:
    """
    Dependency class for checking user permissions

    Usage:
        @app.get("/admin")
        async def admin_route(
            current_user: User = Depends(require_permission("admin.access"))
        ):
            ...
    """

    def __init__(self, required_permissions: List[str]):
        self.required_permissions = required_permissions

    async def __call__(
        self,
        current_user: User = Depends(lambda: get_current_user()),
    ) -> User:
        """Check if user has required permissions"""
        # Get user's permissions from all their roles
        user_permissions = []
        for role in current_user.roles:
            user_permissions.extend(role.permissions or [])

        # Check if user has any of the required permissions
        for perm in self.required_permissions:
            if perm in user_permissions:
                return current_user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )


def require_permission(*permissions: str):
    """
    Create a permission checker dependency

    Usage:
        @app.get("/settings")
        async def update_settings(
            user: User = Depends(require_permission("settings.edit"))
        ):
            ...
    """
    return PermissionChecker(list(permissions))


async def get_current_user(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Get the current authenticated user from the request

    Extracts JWT token from Authorization header, validates it,
    and returns the authenticated user.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not authorization:
        raise credentials_exception

    # Extract token from "Bearer <token>" format
    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise credentials_exception
    except ValueError:
        raise credentials_exception

    # Validate token and get user
    auth_service = AuthService(db)
    user = await auth_service.get_user_from_token(token)

    if not user:
        raise credentials_exception

    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Get current active user (not deleted, not suspended)"""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    return current_user


async def get_user_organization(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Organization:
    """Get the organization for the current user"""
    result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    organization = result.scalar_one_or_none()

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )

    return organization


# Convenience function for checking secretary role
def require_secretary():
    """Require user to have secretary permissions"""
    return require_permission(
        "settings.manage_contact_visibility",
        "organization.edit_settings"
    )
