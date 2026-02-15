"""
API Dependencies

FastAPI dependencies for authentication, authorization, and database access.
"""

from typing import Optional, List
from fastapi import Depends, HTTPException, status, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.core.database import get_db
from app.models.user import User, Organization, Role
from app.services.auth_service import AuthService


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


class PermissionChecker:
    """
    Dependency class for checking user permissions using OR logic.

    Grants access if the user has **any one** of the listed permissions.
    For AND logic (require ALL), use ``AllPermissionChecker`` instead.

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
        current_user: User = Depends(get_current_user),
    ) -> User:
        """Check if user has any of the required permissions (OR logic)"""
        user_permissions = set()
        for role in current_user.roles:
            user_permissions.update(role.permissions or [])

        # Wildcard "*" grants all permissions (IT Administrator)
        if "*" in user_permissions:
            return current_user

        for perm in self.required_permissions:
            if perm in user_permissions:
                return current_user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )


class AllPermissionChecker:
    """
    Dependency class for checking user permissions using AND logic.

    Grants access only if the user has **all** of the listed permissions.

    Usage:
        @app.delete("/users/{id}")
        async def delete_user(
            current_user: User = Depends(require_all_permissions("users.delete", "audit.write"))
        ):
            ...
    """

    def __init__(self, required_permissions: List[str]):
        self.required_permissions = required_permissions

    async def __call__(
        self,
        current_user: User = Depends(get_current_user),
    ) -> User:
        """Check if user has all of the required permissions (AND logic)"""
        user_permissions = set()
        for role in current_user.roles:
            user_permissions.update(role.permissions or [])

        # Wildcard "*" grants all permissions (IT Administrator)
        if "*" in user_permissions:
            return current_user

        missing = [p for p in self.required_permissions if p not in user_permissions]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )

        return current_user


def require_permission(*permissions: str):
    """
    Create a permission checker dependency (OR logic — any one permission suffices).

    Usage:
        @app.get("/settings")
        async def update_settings(
            user: User = Depends(require_permission("settings.edit"))
        ):
            ...
    """
    return PermissionChecker(list(permissions))


def require_all_permissions(*permissions: str):
    """
    Create a permission checker dependency (AND logic — all permissions required).

    Usage:
        @app.delete("/critical-data")
        async def delete_data(
            user: User = Depends(require_all_permissions("data.delete", "admin.access"))
        ):
            ...
    """
    return AllPermissionChecker(list(permissions))


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
