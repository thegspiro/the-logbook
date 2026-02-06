"""
Authentication API Endpoints

Endpoints for user authentication, registration, and session management.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status, Request
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
    PasswordResetRequest,
    PasswordReset,
)
from app.services.auth_service import AuthService, RESET_TOKEN_EXPIRY_HOURS
from app.api.dependencies import get_current_user, get_current_active_user
from app.models.user import User, Organization
from app.core.config import settings
from app.core.security_middleware import check_rate_limit


router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(check_rate_limit)])
async def register(
    user_data: UserRegister,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Register a new user account

    Creates a new user with the provided information and returns
    authentication tokens.

    Rate limited to 5 requests per minute per IP address to prevent abuse.

    The organization is looked up from the database (single-org system).
    """
    auth_service = AuthService(db)

    # Look up the organization from the database
    # This is a single-org system — onboarding creates exactly one organization
    from sqlalchemy import select
    org_result = await db.execute(
        select(Organization)
        .where(Organization.deleted_at.is_(None))
        .order_by(Organization.created_at.asc())
        .limit(1)
    )
    organization = org_result.scalar_one_or_none()

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No organization found. Please complete onboarding first."
        )

    # Register user
    user, error = await auth_service.register_user(
        username=user_data.username,
        email=user_data.email,
        password=user_data.password,
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        organization_id=organization.id,
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


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(check_rate_limit)])
async def login(
    credentials: UserLogin,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticate a user and return tokens

    Accepts username/email and password, returns access and refresh tokens.

    Rate limited to 5 requests per minute per IP address to prevent brute force attacks.
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


@router.post("/refresh", response_model=dict, dependencies=[Depends(check_rate_limit)])
async def refresh_token(
    token_data: TokenRefresh,
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh an access token using a refresh token

    Returns a new access token if the refresh token is valid.

    Rate limited to 5 requests per minute per IP address to prevent token refresh abuse.
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


@router.post("/forgot-password", dependencies=[Depends(check_rate_limit)])
async def forgot_password(
    reset_request: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Request a password reset email.

    Only works when local authentication is enabled for the organization.
    If the org uses Google, Microsoft, or another OAuth provider, the user
    is directed to reset via that provider instead.

    Rate limited to prevent abuse. Always returns 200 to avoid email enumeration.
    """
    from sqlalchemy import select
    from app.schemas.organization import AuthSettings

    # Look up the organization (single-org system)
    org_result = await db.execute(
        select(Organization)
        .where(Organization.deleted_at.is_(None))
        .order_by(Organization.created_at.asc())
        .limit(1)
    )
    organization = org_result.scalar_one_or_none()

    if not organization:
        # No org — return generic success to avoid leaking info
        return {"message": "If an account with that email exists, a reset link has been sent."}

    # Check auth provider
    org_settings = organization.settings or {}
    auth_config = AuthSettings(**org_settings.get("auth", {}))

    if not auth_config.is_local_auth():
        provider_names = {
            "google": "Google",
            "microsoft": "Microsoft",
            "authentik": "your SSO provider",
        }
        provider_label = provider_names.get(auth_config.provider, auth_config.provider)
        return {
            "message": f"This organization uses {provider_label} for authentication. "
                       f"Please reset your password through {provider_label}.",
            "auth_provider": auth_config.provider,
        }

    # Generate reset token
    auth_service = AuthService(db)
    user, raw_token = await auth_service.create_password_reset_token(
        email=reset_request.email,
        organization_id=str(organization.id),
    )

    # Send email in background (even if user not found, we don't reveal that)
    if user and raw_token:
        from app.services.email_service import EmailService

        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={raw_token}"
        org_name = organization.name

        async def _send_reset():
            try:
                email_svc = EmailService(organization)
                await email_svc.send_password_reset_email(
                    to_email=user.email,
                    first_name=user.first_name or user.username,
                    reset_url=reset_url,
                    organization_name=org_name,
                    expiry_hours=RESET_TOKEN_EXPIRY_HOURS,
                    db=db,
                    organization_id=str(organization.id),
                )
            except Exception as e:
                from loguru import logger
                logger.error(f"Failed to send password reset email: {e}")

        background_tasks.add_task(_send_reset)

    # Always return the same message to prevent email enumeration
    return {"message": "If an account with that email exists, a reset link has been sent."}


@router.post("/reset-password", dependencies=[Depends(check_rate_limit)])
async def reset_password(
    reset_data: PasswordReset,
    db: AsyncSession = Depends(get_db),
):
    """
    Reset password using a valid reset token.

    The token was sent via email from the forgot-password endpoint.
    Requires a new password that meets strength requirements (12+ chars).
    """
    auth_service = AuthService(db)

    success, error = await auth_service.reset_password_with_token(
        raw_token=reset_data.token,
        new_password=reset_data.new_password,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "Password reset failed"
        )

    return {"message": "Password has been reset successfully. You can now log in with your new password."}
