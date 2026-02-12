"""
Authentication Service

Business logic for authentication operations.
"""

from typing import Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from datetime import datetime, timedelta
from uuid import UUID, uuid4
import secrets
import hashlib

from app.models.user import User, Session as UserSession, Organization, UserStatus
from app.core.security import (
    verify_password,
    hash_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    validate_password_strength,
)
from app.core.config import settings
from loguru import logger

RESET_TOKEN_EXPIRY_MINUTES = 30


class AuthService:
    """Service for authentication operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def authenticate_user(
        self,
        username: str,
        password: str
    ) -> Tuple[Optional[User], Optional[str]]:
        """
        Authenticate a user by username and password

        Args:
            username: Username or email
            password: Plain text password

        Returns:
            Tuple of (User, None) on success, or (None, error_message) on failure
        """
        # Try to find user by username or email
        result = await self.db.execute(
            select(User)
            .where(
                (User.username == username) | (User.email == username)
            )
            .where(User.deleted_at.is_(None))
            .options(selectinload(User.roles))
        )
        user = result.scalar_one_or_none()

        if not user:
            logger.warning("Authentication failed for login attempt")
            return None, "Incorrect username or password"

        if not user.password_hash:
            logger.warning("Authentication failed for login attempt")
            return None, "Incorrect username or password"

        # Check if account is locked
        if user.locked_until and user.locked_until > datetime.utcnow():
            remaining = int((user.locked_until - datetime.utcnow()).total_seconds() / 60) + 1
            logger.warning(f"Authentication failed: account locked - {username}")
            return None, f"Account is temporarily locked. Try again in {remaining} minutes."

        # Verify password
        if not verify_password(password, user.password_hash):
            # Increment failed login attempts
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1

            # Lock account after 5 failed attempts
            if user.failed_login_attempts >= 5:
                user.locked_until = datetime.utcnow() + timedelta(minutes=30)
                logger.warning(f"Account locked due to failed attempts - {username}")

            # Commit (not flush) so the counter persists even when the
            # caller raises HTTPException, which triggers a rollback in
            # the get_db() dependency cleanup.
            await self.db.commit()
            logger.warning("Authentication failed: invalid credentials")

            remaining_attempts = 5 - user.failed_login_attempts
            if remaining_attempts <= 0:
                return None, "Account is temporarily locked due to too many failed attempts. Try again in 30 minutes."
            elif remaining_attempts <= 2:
                return None, f"Incorrect username or password. {remaining_attempts} attempt{'s' if remaining_attempts > 1 else ''} remaining before account is locked."
            else:
                return None, "Incorrect username or password"

        # Reset failed login attempts on successful login
        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = datetime.utcnow()
        await self.db.flush()

        return user, None

    async def create_user_tokens(
        self,
        user: User,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> Tuple[str, str]:
        """
        Create access and refresh tokens for a user

        Args:
            user: User object
            ip_address: Client IP address
            user_agent: Client user agent

        Returns:
            Tuple of (access_token, refresh_token)
        """
        # Create token payload
        token_data = {
            "sub": str(user.id),
            "username": user.username,
            "org_id": str(user.organization_id),
        }

        # Create tokens
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        # Store session — use str() for id/user_id to match String(36) columns
        session = UserSession(
            id=str(uuid4()),
            user_id=str(user.id),
            token=access_token,
            refresh_token=refresh_token,
            ip_address=ip_address,
            user_agent=user_agent,
            expires_at=datetime.utcnow() + timedelta(
                minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
            ),
        )

        self.db.add(session)
        await self.db.commit()

        logger.info(f"Created session for user: {user.username}")

        return access_token, refresh_token

    async def refresh_access_token(
        self, refresh_token: str
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Refresh an access token using a refresh token.

        Implements refresh token rotation (SEC-11): each use issues a new
        refresh token and invalidates the old one.  If a previously-used
        refresh token is replayed, the entire session is revoked to limit
        the damage of token theft.

        Args:
            refresh_token: Refresh token string

        Returns:
            Tuple of (new_access_token, new_refresh_token) or (None, None)
        """
        try:
            # Decode refresh token
            payload = decode_token(refresh_token)

            if payload.get("type") != "refresh":
                return None, None

            # Keep user_id as string to match the String(36) DB columns
            user_id = payload.get("sub")

            # Look up the session by refresh token
            result = await self.db.execute(
                select(UserSession).where(UserSession.refresh_token == refresh_token)
            )
            session = result.scalar_one_or_none()

            if not session:
                # The refresh token is not in the DB.  This could mean it was
                # already rotated (i.e. stolen token replay).  Revoke all
                # sessions for this user as a precaution.
                logger.warning(
                    f"Refresh token replay detected for user {user_id}. "
                    "Revoking all sessions."
                )
                await self._revoke_all_user_sessions(str(user_id))
                return None, None

            # Get user
            user_result = await self.db.execute(
                select(User)
                .where(User.id == str(user_id))
                .where(User.deleted_at.is_(None))
            )
            user = user_result.scalar_one_or_none()

            if not user or not user.is_active:
                return None, None

            # Create new token pair
            token_data = {
                "sub": str(user.id),
                "username": user.username,
                "org_id": str(user.organization_id),
            }

            new_access_token = create_access_token(token_data)
            new_refresh_token = create_refresh_token(token_data)

            # Rotate: update the session with the new tokens
            session.token = new_access_token
            session.refresh_token = new_refresh_token
            session.expires_at = datetime.utcnow() + timedelta(
                minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
            )
            await self.db.commit()

            return new_access_token, new_refresh_token

        except Exception as e:
            logger.error(f"Token refresh failed: {e}")
            return None, None

    async def _revoke_all_user_sessions(self, user_id: str) -> int:
        """
        Revoke all active sessions for a user.

        Used when refresh token replay is detected (potential theft)
        or when a user's password is changed/account is deactivated.

        Args:
            user_id: User ID as string (matches String(36) DB column)

        Returns:
            Number of sessions revoked
        """
        result = await self.db.execute(
            select(UserSession).where(UserSession.user_id == str(user_id))
        )
        sessions = result.scalars().all()
        count = len(sessions)
        for session in sessions:
            await self.db.delete(session)
        if count:
            await self.db.flush()
            logger.info(f"Revoked {count} session(s) for user {user_id}")
        return count

    async def register_user(
        self,
        username: str,
        email: str,
        password: str,
        first_name: str,
        last_name: str,
        organization_id: UUID,
        badge_number: Optional[str] = None
    ) -> Tuple[Optional[User], Optional[str]]:
        """
        Register a new user

        Args:
            username: Username
            email: Email address
            password: Plain text password
            first_name: First name
            last_name: Last name
            organization_id: Organization ID
            badge_number: Optional badge number

        Returns:
            Tuple of (User object if successful, error message if failed)
        """
        # Validate password strength
        is_valid, error_msg = validate_password_strength(password)
        if not is_valid:
            return None, error_msg

        # Check if username or email already exists.
        # Use a generic error message to prevent user enumeration (SEC-13).
        _generic_conflict = (
            "Registration could not be completed with the provided credentials. "
            "Please try different credentials or contact your administrator."
        )

        result = await self.db.execute(
            select(User).where(
                User.username == username,
                User.organization_id == organization_id,
                User.deleted_at.is_(None)
            )
        )
        if result.scalar_one_or_none():
            return None, _generic_conflict

        result = await self.db.execute(
            select(User).where(
                User.email == email,
                User.organization_id == organization_id,
                User.deleted_at.is_(None)
            )
        )
        if result.scalar_one_or_none():
            return None, _generic_conflict

        # Create user — use str() for id to match String(36) column
        user = User(
            id=str(uuid4()),
            organization_id=str(organization_id),
            username=username,
            email=email,
            password_hash=hash_password(password),
            first_name=first_name,
            last_name=last_name,
            badge_number=badge_number,
            status=UserStatus.ACTIVE,
            email_verified=False,
        )

        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)

        logger.info(f"User registered: {username}")

        return user, None

    async def logout_user(self, token: str) -> bool:
        """
        Logout a user by invalidating their session

        Args:
            token: Access token

        Returns:
            True if successful, False otherwise
        """
        try:
            result = await self.db.execute(
                select(UserSession).where(UserSession.token == token)
            )
            session = result.scalar_one_or_none()

            if session:
                await self.db.delete(session)
                await self.db.flush()
                logger.info(f"User logged out: session {session.id}")
                return True

            return False

        except Exception as e:
            logger.error(f"Logout failed: {e}")
            return False

    async def change_password(
        self,
        user: User,
        current_password: str,
        new_password: str
    ) -> Tuple[bool, Optional[str]]:
        """
        Change user password

        Args:
            user: User object
            current_password: Current password
            new_password: New password

        Returns:
            Tuple of (success, error_message)
        """
        # Verify current password
        if not user.password_hash or not verify_password(current_password, user.password_hash):
            return False, "Current password is incorrect"

        # Validate new password
        is_valid, error_msg = validate_password_strength(new_password)
        if not is_valid:
            return False, error_msg

        # Update password
        user.password_hash = hash_password(new_password)
        user.password_changed_at = datetime.utcnow()

        await self.db.flush()

        logger.info(f"Password changed for user: {user.username}")

        return True, None

    async def get_user_from_token(self, token: str) -> Optional[User]:
        """
        Get user from access token with server-side session validation.

        Verifies that:
        1. The JWT is valid and not expired
        2. A matching session exists in the database (not logged out)
        3. The session has not expired
        4. The user is active and not deleted

        Args:
            token: Access token

        Returns:
            User object if token is valid and session exists, None otherwise
        """
        try:
            payload = decode_token(token)

            if payload.get("type") != "access":
                return None

            user_id = payload.get("sub")

            # SEC-03: Verify the token has an active session in the database.
            # This ensures logged-out or revoked tokens are rejected immediately.
            # Query by token alone (unique index) to avoid type-mismatch issues
            # between Python UUID objects and MySQL VARCHAR columns.
            session_result = await self.db.execute(
                select(UserSession).where(
                    UserSession.token == token,
                )
            )
            session = session_result.scalar_one_or_none()

            if not session:
                logger.debug("Token rejected: no matching session found")
                return None

            # Verify the session belongs to the claimed user
            if str(session.user_id) != str(user_id):
                logger.debug("Token rejected: session user_id mismatch")
                return None

            if session.expires_at and session.expires_at < datetime.utcnow():
                logger.debug("Token rejected: session expired")
                return None

            result = await self.db.execute(
                select(User)
                .where(User.id == str(user_id))
                .where(User.deleted_at.is_(None))
                .options(selectinload(User.roles))
            )
            user = result.scalar_one_or_none()

            return user if user and user.is_active else None

        except Exception as e:
            logger.error(f"Token validation failed: {e}")
            return None

    async def create_password_reset_token(
        self,
        email: str,
        organization_id: str,
        ip_address: Optional[str] = None,
    ) -> Tuple[Optional[User], Optional[str]]:
        """
        Generate a password reset token for a user identified by email.

        The raw token is returned for inclusion in the reset email.
        A SHA-256 hash of the token is stored in the database for verification.

        Enforces a cooldown: if a valid (non-expired) token already exists,
        a new one will not be generated.

        Returns:
            Tuple of (user, raw_token) if user found and token created,
            (None, None) otherwise.
        """
        result = await self.db.execute(
            select(User)
            .where(
                User.email == email,
                User.organization_id == organization_id,
                User.deleted_at.is_(None),
            )
        )
        user = result.scalar_one_or_none()

        if not user:
            return None, None

        if not user.password_hash:
            # User has no local password (OAuth-only) — shouldn't happen
            # with the auth_provider gate, but just in case
            return None, None

        # Cooldown: reject if an active (non-expired) token already exists
        if (
            user.password_reset_token
            and user.password_reset_expires_at
            and user.password_reset_expires_at > datetime.utcnow()
        ):
            logger.warning(
                f"Password reset requested while active token exists "
                f"(ip={ip_address})"
            )
            return None, None

        # Generate secure token and store its hash
        raw_token = secrets.token_urlsafe(48)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        user.password_reset_token = token_hash
        user.password_reset_expires_at = datetime.utcnow() + timedelta(
            minutes=RESET_TOKEN_EXPIRY_MINUTES
        )

        await self.db.flush()
        logger.info(
            f"Password reset token created (ip={ip_address})"
        )

        return user, raw_token

    async def reset_password_with_token(
        self,
        raw_token: str,
        new_password: str,
    ) -> Tuple[bool, Optional[str]]:
        """
        Reset a user's password using a valid reset token.

        Returns:
            Tuple of (success, error_message)
        """
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        result = await self.db.execute(
            select(User)
            .where(
                User.password_reset_token == token_hash,
                User.deleted_at.is_(None),
            )
        )
        user = result.scalar_one_or_none()

        if not user:
            return False, "Invalid or expired reset token"

        if (
            not user.password_reset_expires_at
            or user.password_reset_expires_at < datetime.utcnow()
        ):
            # Clear expired token
            user.password_reset_token = None
            user.password_reset_expires_at = None
            await self.db.flush()
            return False, "Reset token has expired. Please request a new one."

        # Validate new password strength
        is_valid, error_msg = validate_password_strength(new_password)
        if not is_valid:
            return False, error_msg

        # Set new password and clear token
        user.password_hash = hash_password(new_password)
        user.password_changed_at = datetime.utcnow()
        user.password_reset_token = None
        user.password_reset_expires_at = None
        user.failed_login_attempts = 0
        user.locked_until = None

        await self.db.flush()
        logger.info("Password successfully reset via token")

        return True, None
