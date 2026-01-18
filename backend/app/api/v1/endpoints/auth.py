"""
Authentication API Endpoints

Endpoints for user authentication, registration, and session management.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.database import get_db
from app.schemas.auth import (
    UserLogin,
    UserRegister,
    TokenResponse,
    TokenRefresh,
    CurrentUser,
    PasswordChange,
)
from app.services.auth_service import AuthService
from app.api.dependencies import get_current_user, get_current_active_user
from app.models.user import User
from app.core.config import settings


router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserRegister,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Register a new user account

    Creates a new user with the provided information and returns
    authentication tokens.

    **Note**: Currently uses hardcoded organization ID. When multi-org
    support is added, organization_id should come from registration context.
    """
    auth_service = AuthService(db)

    # TODO: Get organization_id from registration context
    # For now, use the test organization
    from uuid import UUID as UUIDType
    test_org_id = UUIDType("00000000-0000-0000-0000-000000000001")

    # Register user
    user, error = await auth_service.register_user(
        username=user_data.username,
        email=user_data.email,
        password=user_data.password,
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        organization_id=test_org_id,
        badge_number=user_data.badge_number,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    # Create tokens
    access_token, refresh_token = await auth_service.create_user_tokens(
        user=user,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    credentials: UserLogin,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticate a user and return tokens

    Accepts username/email and password, returns access and refresh tokens.
    """
    auth_service = AuthService(db)

    # Authenticate user
    user = await auth_service.authenticate_user(
        username=credentials.username,
        password=credentials.password,
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if user is active
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive. Please contact an administrator.",
        )

    # Create tokens
    access_token, refresh_token = await auth_service.create_user_tokens(
        user=user,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/refresh", response_model=dict)
async def refresh_token(
    token_data: TokenRefresh,
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh an access token using a refresh token

    Returns a new access token if the refresh token is valid.
    """
    auth_service = AuthService(db)

    new_access_token = await auth_service.refresh_access_token(
        token_data.refresh_token
    )

    if not new_access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "access_token": new_access_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@router.post("/logout")
async def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Logout the current user

    Invalidates the current session/token.
    """
    # Extract token from header
    authorization = request.headers.get("authorization", "")
    try:
        _, token = authorization.split()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid authorization header"
        )

    auth_service = AuthService(db)
    success = await auth_service.logout_user(token)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Logout failed"
        )

    return {"message": "Successfully logged out"}


@router.get("/me", response_model=CurrentUser)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
):
    """
    Get current user information

    Returns the authenticated user's profile and permissions.
    """
    # Get all roles and permissions
    role_names = [role.name for role in current_user.roles]

    # Collect all unique permissions from all roles
    all_permissions = set()
    for role in current_user.roles:
        all_permissions.update(role.permissions or [])

    return CurrentUser(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        full_name=current_user.full_name,
        organization_id=current_user.organization_id,
        roles=role_names,
        permissions=list(all_permissions),
        is_active=current_user.is_active,
        email_verified=current_user.email_verified,
        mfa_enabled=current_user.mfa_enabled,
    )


@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Change the current user's password

    Requires the current password for verification.
    """
    auth_service = AuthService(db)

    success, error = await auth_service.change_password(
        user=current_user,
        current_password=password_data.current_password,
        new_password=password_data.new_password,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "Password change failed"
        )

    return {"message": "Password changed successfully"}


@router.get("/check")
async def check_authentication(
    current_user: User = Depends(get_current_user),
):
    """
    Simple endpoint to check if the user is authenticated

    Returns basic user info if authenticated, 401 if not.
    """
    return {
        "authenticated": True,
        "user_id": str(current_user.id),
        "username": current_user.username,
    }
