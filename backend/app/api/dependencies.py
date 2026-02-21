"""
API Dependencies

FastAPI dependencies for authentication, authorization, and database access.

Permission aggregation combines **position permissions** (from the
``user_positions`` junction table) with **rank default permissions**
(from the ``OPERATIONAL_RANKS`` config keyed by ``User.rank``).
"""

from typing import Optional, List
from fastapi import Depends, HTTPException, status, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.core.database import get_db
from app.models.user import User, Organization, Position
from app.services.auth_service import AuthService
from app.core.permissions import get_rank_default_permissions


def _collect_user_permissions(user: User) -> set:
    """
    Aggregate all permissions for *user* by combining:
    1. Permissions from every assigned **position**.
    2. Default permissions from the user's operational **rank**.
    """
    perms: set = set()

    # Positions (the relationship is named `positions` but the
    # backward-compatible alias keeps `roles` working too)
    for position in user.positions:
        perms.update(position.permissions or [])

    # Operational rank defaults
    if user.rank:
        perms.update(get_rank_default_permissions(user.rank))

    return perms


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


def _has_permission(required: str, user_permissions: set) -> bool:
    """
    Check if a single required permission is satisfied by the user's permissions.

    Supports three levels of matching:
    1. Global wildcard: ``"*"`` in user_permissions grants everything.
    2. Module wildcard: ``"settings.*"`` in user_permissions matches any
       ``"settings.<action>"`` requirement (e.g. ``"settings.manage_contact_visibility"``).
    3. Exact match: ``"settings.edit"`` matches ``"settings.edit"``.
    """
    if "*" in user_permissions:
        return True

    if required in user_permissions:
        return True

    # Module-level wildcard: "settings.*" covers "settings.manage_contact_visibility"
    if "." in required:
        module = required.split(".")[0]
        if f"{module}.*" in user_permissions:
            return True

    return False


class PermissionChecker:
    """
    Dependency class for checking user permissions using OR logic.

    Grants access if the user has **any one** of the listed permissions.
    For AND logic (require ALL), use ``AllPermissionChecker`` instead.
    """

    def __init__(self, required_permissions: List[str]):
        self.required_permissions = required_permissions

    async def __call__(
        self,
        current_user: User = Depends(get_current_user),
    ) -> User:
        """Check if user has any of the required permissions (OR logic)"""
        user_permissions = _collect_user_permissions(current_user)

        for perm in self.required_permissions:
            if _has_permission(perm, user_permissions):
                return current_user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )


class AllPermissionChecker:
    """
    Dependency class for checking user permissions using AND logic.

    Grants access only if the user has **all** of the listed permissions.
    """

    def __init__(self, required_permissions: List[str]):
        self.required_permissions = required_permissions

    async def __call__(
        self,
        current_user: User = Depends(get_current_user),
    ) -> User:
        """Check if user has all of the required permissions (AND logic)"""
        user_permissions = _collect_user_permissions(current_user)

        missing = [p for p in self.required_permissions if not _has_permission(p, user_permissions)]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )

        return current_user


def require_permission(*permissions: str):
    """
    Create a permission checker dependency (OR logic — any one permission suffices).
    """
    return PermissionChecker(list(permissions))


def require_all_permissions(*permissions: str):
    """
    Create a permission checker dependency (AND logic — all permissions required).
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


# Convenience function for checking secretary position
def require_secretary():
    """Require user to have secretary permissions"""
    return require_permission(
        "settings.manage",
        "settings.manage_contact_visibility",
        "organization.update_settings"
    )
