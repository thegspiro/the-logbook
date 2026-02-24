"""
Authentication API Endpoints

Endpoints for user authentication, registration, and session management.
"""

from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    HTTPException,
    Request,
    status,
)
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_current_active_user, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import get_rank_default_permissions
from app.core.security_middleware import check_rate_limit
from app.models.user import Organization, User
from app.schemas.auth import (
    CurrentUser,
    PasswordChange,
    PasswordReset,
    PasswordResetRequest,
    TokenRefresh,
    TokenResponse,
    UserLogin,
    UserRegister,
)
from app.services.auth_service import RESET_TOKEN_EXPIRY_MINUTES, AuthService

router = APIRouter()


def _set_auth_cookies(
    response: JSONResponse,
    access_token: str,
    refresh_token: str,
) -> None:
    """Set httpOnly, Secure, SameSite auth cookies on *response*."""
    import secrets as _secrets

    is_production = settings.ENVIRONMENT == "production"
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=is_production,
        samesite="strict",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=is_production,
        samesite="strict",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/v1/auth",  # Only sent to auth endpoints
    )
    # Double-submit CSRF token (readable by JS, validated server-side)
    response.set_cookie(
        key="csrf_token",
        value=_secrets.token_urlsafe(32),
        httponly=False,  # Must be readable by JavaScript
        secure=is_production,
        samesite="strict",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


def _clear_auth_cookies(response: JSONResponse) -> None:
    """Remove auth cookies from *response*."""
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/api/v1/auth")
    response.delete_cookie(key="csrf_token", path="/")


@router.get("/branding")
async def get_login_branding(
    db: AsyncSession = Depends(get_db),
):
    """
    Get organization branding for the login page.

    Returns the organization name and logo so the login page can display
    them without requiring authentication. Returns empty values if no
    organization exists yet (pre-onboarding).
    """
    from sqlalchemy import select

    try:
        result = await db.execute(
            select(Organization.name, Organization.logo)
            .where(Organization.active == True)  # noqa: E712
            .order_by(Organization.created_at.asc())
            .limit(1)
        )
        row = result.first()

        if not row:
            return {"name": None, "logo": None}

        return {"name": row.name, "logo": row.logo}
    except Exception:
        # Pre-onboarding or DB not ready — return empty branding gracefully
        return {"name": None, "logo": None}


@router.get("/oauth-config")
async def get_oauth_config(
    db: AsyncSession = Depends(get_db),
):
    """
    Get OAuth provider configuration for the login page.

    Returns which OAuth providers are enabled so the login page
    can conditionally show Google/Microsoft sign-in buttons.
    """
    try:
        result = await db.execute(
            select(Organization.settings)
            .where(Organization.active == True)  # noqa: E712
            .order_by(Organization.created_at.asc())
            .limit(1)
        )
        row = result.first()

        if not row or not row.settings:
            return {"googleEnabled": False, "microsoftEnabled": False}

        auth_settings = (
            row.settings.get("auth", {}) if isinstance(row.settings, dict) else {}
        )
        provider = auth_settings.get("provider", "local")

        return {
            "googleEnabled": provider == "google",
            "microsoftEnabled": provider == "microsoft",
        }
    except Exception:
        return {"googleEnabled": False, "microsoftEnabled": False}


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_rate_limit)],
)
async def register(
    user_data: UserRegister,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Register a new user account

    Creates a new user with the provided information and returns
    authentication tokens.

    Registration is disabled by default (REGISTRATION_ENABLED=false).
    When enabled, new accounts require admin approval if
    REGISTRATION_REQUIRES_APPROVAL is true.

    Rate limited to 5 requests per minute per IP address to prevent abuse.

    The organization is looked up from the database (single-org system).
    """
    # SEC-05: Block registration unless explicitly enabled in settings
    if not settings.REGISTRATION_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Self-registration is disabled. Please contact your administrator to create an account.",
        )

    auth_service = AuthService(db)

    # Look up the organization from the database
    # This is a single-org system — onboarding creates exactly one organization
    from sqlalchemy import select

    org_result = await db.execute(
        select(Organization)
        .where(Organization.active == True)  # noqa: E712
        .order_by(Organization.created_at.asc())
        .limit(1)
    )
    organization = org_result.scalar_one_or_none()

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No organization found. Please complete onboarding first.",
        )

    # Register user
    user, error = await auth_service.register_user(
        username=user_data.username,
        email=user_data.email,
        password=user_data.password,
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        organization_id=organization.id,
        membership_number=user_data.membership_number,
    )

    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    # Create tokens
    access_token, refresh_token = await auth_service.create_user_tokens(
        user=user,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    body = TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    ).model_dump()

    response = JSONResponse(content=body)
    _set_auth_cookies(response, access_token, refresh_token)
    return response


@router.post(
    "/login", response_model=TokenResponse, dependencies=[Depends(check_rate_limit)]
)
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
    user, auth_error = await auth_service.authenticate_user(
        username=credentials.username,
        password=credentials.password,
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=auth_error or "Incorrect username or password",
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

    body = TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    ).model_dump()

    response = JSONResponse(content=body)
    _set_auth_cookies(response, access_token, refresh_token)
    return response


@router.post("/refresh", response_model=dict, dependencies=[Depends(check_rate_limit)])
async def refresh_token(
    token_data: Optional[TokenRefresh] = None,
    refresh_token_cookie: Optional[str] = Cookie(None, alias="refresh_token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh an access token using a refresh token.

    Accepts refresh token from httpOnly cookie (preferred) or request body.

    Implements token rotation: a new refresh token is issued on every use
    and the old one is invalidated.  Clients MUST store and use the new
    refresh_token from the response for subsequent refreshes.

    Rate limited to 5 requests per minute per IP address.
    """
    # Prefer cookie, fall back to body
    rt = refresh_token_cookie or (token_data.refresh_token if token_data else None)
    if not rt:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token provided.",
        )

    auth_service = AuthService(db)

    new_access_token, new_refresh_token = await auth_service.refresh_access_token(rt)

    if not new_access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    body = {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }

    response = JSONResponse(content=body)
    _set_auth_cookies(response, new_access_token, new_refresh_token)
    return response


@router.post("/logout")
async def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    access_token_cookie: Optional[str] = Cookie(None, alias="access_token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Logout the current user

    Invalidates the current session/token and clears auth cookies.
    """
    # Resolve token: prefer cookie, fall back to Authorization header
    token: Optional[str] = access_token_cookie
    if not token:
        authorization = request.headers.get("authorization", "")
        try:
            _, token = authorization.split()
        except ValueError:
            token = None

    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to process logout. Please clear your browser data and log in again.",
        )

    auth_service = AuthService(db)
    success = await auth_service.logout_user(token)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to end your session. Please close your browser and log in again.",
        )

    response = JSONResponse(content={"message": "Successfully logged out"})
    _clear_auth_cookies(response)
    return response


@router.get("/me", response_model=CurrentUser)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get current user information

    Returns the authenticated user's profile and permissions.
    """
    from datetime import datetime, timezone

    # Re-fetch with eager loading so we can iterate positions safely in async
    user_result = await db.execute(
        select(User)
        .where(User.id == current_user.id)
        .options(selectinload(User.positions))
    )
    current_user = user_result.scalar_one()

    # Get all positions and permissions
    position_names = [pos.name for pos in current_user.positions]

    # Collect all unique permissions from all positions
    all_permissions = set()
    for pos in current_user.positions:
        all_permissions.update(pos.permissions or [])

    # Also include rank default permissions
    if current_user.rank:
        all_permissions.update(get_rank_default_permissions(current_user.rank))

    # Check HIPAA password age
    password_expired = False
    max_age_days = settings.HIPAA_MAXIMUM_PASSWORD_AGE_DAYS
    if max_age_days > 0 and current_user.password_changed_at:
        age = (datetime.now(timezone.utc) - current_user.password_changed_at).days
        password_expired = age >= max_age_days

    # Get organization timezone
    from app.models.user import Organization

    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = org_result.scalar_one_or_none()
    timezone = org.timezone if org else "America/New_York"

    return CurrentUser(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        full_name=current_user.full_name,
        organization_id=current_user.organization_id,
        timezone=timezone,
        roles=position_names,
        positions=position_names,
        rank=current_user.rank,
        membership_type=current_user.membership_type,
        permissions=list(all_permissions),
        is_active=current_user.is_active,
        email_verified=current_user.email_verified,
        mfa_enabled=current_user.mfa_enabled,
        password_expired=password_expired,
        must_change_password=bool(current_user.must_change_password),
    )


@router.get("/session-settings")
async def get_session_settings(
    current_user: User = Depends(get_current_user),
):
    """
    Return HIPAA session timeout and password policy settings.

    The frontend uses this to configure its inactivity timer and
    to warn users about expiring passwords.

    **Authentication required** — prevents unauthenticated enumeration
    of security configuration.
    """
    return {
        "session_timeout_minutes": settings.HIPAA_SESSION_TIMEOUT_MINUTES,
        "password_max_age_days": settings.HIPAA_MAXIMUM_PASSWORD_AGE_DAYS,
    }


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
            detail=error or "Password change failed",
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
    request: Request,
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
    from loguru import logger
    from sqlalchemy import select

    from app.core.audit import log_audit_event
    from app.schemas.organization import AuthSettings

    ip_address = request.client.host if request.client else None

    # Look up the organization (single-org system)
    org_result = await db.execute(
        select(Organization)
        .where(Organization.active == True)  # noqa: E712
        .order_by(Organization.created_at.asc())
        .limit(1)
    )
    organization = org_result.scalar_one_or_none()

    if not organization:
        # No org — return generic success to avoid leaking info
        return {
            "message": "If an account with that email exists, a reset link has been sent."
        }

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
        ip_address=ip_address,
    )

    # Audit log: record every reset request regardless of outcome
    await log_audit_event(
        db=db,
        event_type="auth.password_reset_requested",
        event_category="auth",
        severity="INFO",
        event_data={
            "email": reset_request.email,
            "token_issued": bool(user and raw_token),
            "organization_id": str(organization.id),
        },
        ip_address=ip_address,
        user_agent=request.headers.get("user-agent"),
    )

    # Send emails in background (even if user not found, we don't reveal that)
    if user and raw_token:
        from app.services.email_service import EmailService

        # Use URL fragment (#) instead of query param so the token is
        # never sent to the server in Referer headers or logged in access logs.
        reset_url = f"{settings.FRONTEND_URL}/reset-password#token={raw_token}"
        org_name = organization.name
        expiry_minutes = RESET_TOKEN_EXPIRY_MINUTES

        async def _send_reset():
            try:
                email_svc = EmailService(organization)
                await email_svc.send_password_reset_email(
                    to_email=user.email,
                    first_name=user.first_name or user.username,
                    reset_url=reset_url,
                    organization_name=org_name,
                    expiry_minutes=expiry_minutes,
                    db=db,
                    organization_id=str(organization.id),
                )
            except Exception as e:
                logger.error(f"Failed to send password reset email: {e}")

        background_tasks.add_task(_send_reset)

        # Notify IT team in background
        async def _notify_it_team():
            try:
                it_team = org_settings.get("it_team", {})
                it_members = it_team.get("members", [])
                it_emails = [m["email"] for m in it_members if m.get("email")]
                if not it_emails:
                    return

                email_svc = EmailService(organization)
                await email_svc.send_it_password_reset_notification(
                    to_emails=it_emails,
                    user_email=user.email,
                    user_name=f"{user.first_name or ''} {user.last_name or ''}".strip()
                    or user.username,
                    organization_name=org_name,
                    ip_address=ip_address,
                )
            except Exception as e:
                logger.error(f"Failed to send IT team notification: {e}")

        background_tasks.add_task(_notify_it_team)

    # Always return the same message to prevent email enumeration
    return {
        "message": "If an account with that email exists, a reset link has been sent."
    }


@router.post("/reset-password", dependencies=[Depends(check_rate_limit)])
async def reset_password(
    reset_data: PasswordReset,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Reset password using a valid reset token.

    The token was sent via email from the forgot-password endpoint.
    Requires a new password that meets strength requirements (12+ chars).
    """
    from app.core.audit import log_audit_event

    ip_address = request.client.host if request.client else None
    auth_service = AuthService(db)

    success, error = await auth_service.reset_password_with_token(
        raw_token=reset_data.token,
        new_password=reset_data.new_password,
    )

    # Audit log the outcome
    await log_audit_event(
        db=db,
        event_type=(
            "auth.password_reset_completed" if success else "auth.password_reset_failed"
        ),
        event_category="auth",
        severity="INFO" if success else "WARNING",
        event_data={
            "success": success,
            "error": error,
        },
        ip_address=ip_address,
        user_agent=request.headers.get("user-agent"),
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "Password reset failed",
        )

    return {
        "message": "Password has been reset successfully. You can now log in with your new password."
    }


@router.post("/validate-reset-token", dependencies=[Depends(check_rate_limit)])
async def validate_reset_token(
    token_data: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Validate a password reset token (POST to avoid token in URL/logs).

    Returns whether the token is valid and the associated email.
    """
    token = token_data.get("token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid password reset link. Please request a new reset link from the login page.",
        )

    auth_service = AuthService(db)
    is_valid, email = await auth_service.validate_reset_token(token)

    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid or has expired. Please request a new one from the login page.",
        )

    # Return only validity status; omit email to prevent user enumeration.
    return {"valid": True}
