"""
Authentication Service

Business logic for authentication operations.
"""

from typing import Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
import secrets
import hashlib

from app.models.user import User, Session as UserSession, PasswordHistory, Organization, UserStatus
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


async def _check_password_history(db: AsyncSession, user_id: str, new_password: str) -> bool:
    """
    Check if the new password was used in the last N passwords.

    Returns True if the password is in the history (i.e., reuse detected).
    """
    history_count = settings.HIPAA_PASSWORD_HISTORY_COUNT
    if history_count <= 0:
        return False

    result = await db.execute(
        select(PasswordHistory)
        .where(PasswordHistory.user_id == str(user_id))
        .order_by(PasswordHistory.created_at.desc())
        .limit(history_count)
    )
    history_entries = result.scalars().all()

    for entry in history_entries:
        matched, _ = verify_password(new_password, entry.password_hash)
        if matched:
            return True
    return False


async def _save_password_to_history(db: AsyncSession, user_id: str, password_hash: str):
    """Save the current password hash to the history table."""
    entry = PasswordHistory(
        id=str(uuid4()),
        user_id=user_id,
        password_hash=password_hash,
    )
    db.add(entry)
    await db.flush()


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
        # Try to find user by username or email, scoped to the single org
        # to prevent cross-organization auth if multiple orgs ever exist.
        org_result = await self.db.execute(select(Organization).limit(1))
        org = org_result.scalar_one_or_none()

        query = (
            select(User)
            .where(
                (User.username == username) | (User.email == username)
            )
            .where(User.deleted_at.is_(None))
            .options(selectinload(User.roles))
        )
        if org:
            query = query.where(User.organization_id == str(org.id))

        result = await self.db.execute(query)
        user = result.scalar_one_or_none()

        if not user:
            logger.warning("Authentication failed for login attempt")
            return None, "Incorrect username or password"

        if not user.password_hash:
            logger.warning("Authentication failed for login attempt")
            return None, "Incorrect username or password"

        # Check if account is locked
        locked_until = user.locked_until.replace(tzinfo=timezone.utc) if user.locked_until and user.locked_until.tzinfo is None else user.locked_until
        if locked_until and locked_until > datetime.now(timezone.utc):
            remaining = int((locked_until - datetime.now(timezone.utc)).total_seconds() / 60) + 1
            logger.warning(f"Authentication failed: account locked - {username}")
            return None, f"Account is temporarily locked. Try again in {remaining} minutes."

        # Verify password
        password_valid, rehashed = verify_password(password, user.password_hash)
        if not password_valid:
            # Increment failed login attempts
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1

            # Lock account after 5 failed attempts
            if user.failed_login_attempts >= 5:
                user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=30)
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

        # Transparently upgrade hash if argon2 parameters have changed
        if rehashed:
            user.password_hash = rehashed

        # Reset failed login attempts on successful login
        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = datetime.now(timezone.utc)
        await self.db.flush()

        # Check password age - warn but don't block (frontend handles redirect)
        max_age_days = settings.HIPAA_MAXIMUM_PASSWORD_AGE_DAYS
        if max_age_days > 0 and user.password_changed_at:
            age = (datetime.now(timezone.utc) - user.password_changed_at).days
            if age >= max_age_days:
                logger.warning(
                    f"User {user.username} password expired ({age} days old, "
                    f"max {max_age_days}). Password change required."
                )

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
            expires_at=datetime.now(timezone.utc) + timedelta(
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
            session.expires_at = datetime.now(timezone.utc) + timedelta(
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
        membership_number: Optional[str] = None
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
            membership_number: Optional membership number

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
            membership_number=membership_number,
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

        Enforces HIPAA password controls:
        - Password strength validation
        - Password history (prevents reuse of last N passwords)
        - Minimum password age (prevents rapid cycling)

        Args:
            user: User object
            current_password: Current password
            new_password: New password

        Returns:
            Tuple of (success, error_message)
        """
        # Verify current password
        current_valid, _ = verify_password(current_password, user.password_hash) if user.password_hash else (False, None)
        if not current_valid:
            return False, "Current password is incorrect. Please verify your existing password and try again."

        # Enforce minimum password age (prevent rapid cycling through history)
        # Skip this check when user is forced to change password (e.g., first login
        # after admin creation or admin password reset)
        min_age_days = settings.HIPAA_MINIMUM_PASSWORD_AGE_DAYS
        if min_age_days > 0 and user.password_changed_at:
            age = (datetime.now(timezone.utc) - user.password_changed_at).days
            if age < min_age_days:
                return False, (
                    f"Password was changed recently. You must wait at least "
                    f"{min_age_days} day(s) before changing your password again."
                )

        # Validate new password strength
        is_valid, error_msg = validate_password_strength(new_password)
        if not is_valid:
            return False, error_msg

        # Check password history (HIPAA §164.312(d))
        if await _check_password_history(self.db, str(user.id), new_password):
            return False, (
                f"This password was used recently. You cannot reuse any of your "
                f"last {settings.HIPAA_PASSWORD_HISTORY_COUNT} passwords."
            )

        # Also check against current password
        same_as_current, _ = verify_password(new_password, user.password_hash)
        if same_as_current:
            return False, "New password must be different from your current password."

        # Save current password to history before changing
        await _save_password_to_history(self.db, str(user.id), user.password_hash)

        # Update password
        user.password_hash = hash_password(new_password)
        user.password_changed_at = datetime.now(timezone.utc)
        user.must_change_password = False
        user.failed_login_attempts = 0
        user.locked_until = None

        # Revoke all existing sessions — forces re-login with new password
        # and invalidates any stolen tokens
        revoked = await self._revoke_all_user_sessions(str(user.id))

        await self.db.commit()

        logger.info(f"Password changed for user: {user.username}, revoked {revoked} sessions")

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

            session_expires = session.expires_at.replace(tzinfo=timezone.utc) if session.expires_at and session.expires_at.tzinfo is None else session.expires_at
            if session_expires and session_expires < datetime.now(timezone.utc):
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
        reset_expires = user.password_reset_expires_at.replace(tzinfo=timezone.utc) if user.password_reset_expires_at and user.password_reset_expires_at.tzinfo is None else user.password_reset_expires_at
        if (
            user.password_reset_token
            and reset_expires
            and reset_expires > datetime.now(timezone.utc)
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
        user.password_reset_expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=RESET_TOKEN_EXPIRY_MINUTES
        )

        await self.db.flush()
        logger.info(
            f"Password reset token created (ip={ip_address})"
        )

        return user, raw_token

    async def validate_reset_token(
        self,
        raw_token: str,
    ) -> Tuple[bool, Optional[str]]:
        """
        Validate a password reset token without consuming it.

        Returns:
            Tuple of (is_valid, user_email_or_none)
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
            return False, None

        reset_exp = user.password_reset_expires_at
        if reset_exp and reset_exp.tzinfo is None:
            reset_exp = reset_exp.replace(tzinfo=timezone.utc)
        if (
            not reset_exp
            or reset_exp < datetime.now(timezone.utc)
        ):
            return False, None

        return True, user.email

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
            return False, "This password reset link is invalid or has already been used. Please request a new reset link from the login page."

        reset_exp = user.password_reset_expires_at
        if reset_exp and reset_exp.tzinfo is None:
            reset_exp = reset_exp.replace(tzinfo=timezone.utc)
        if (
            not reset_exp
            or reset_exp < datetime.now(timezone.utc)
        ):
            # Clear expired token
            user.password_reset_token = None
            user.password_reset_expires_at = None
            await self.db.flush()
            return False, "This password reset link has expired. Reset links are valid for 30 minutes. Please request a new one from the login page."

        # Validate new password strength
        is_valid, error_msg = validate_password_strength(new_password)
        if not is_valid:
            return False, error_msg

        # Check password history
        if await _check_password_history(self.db, str(user.id), new_password):
            return False, (
                f"This password was used recently. You cannot reuse any of your "
                f"last {settings.HIPAA_PASSWORD_HISTORY_COUNT} passwords."
            )

        # Save current password to history before changing
        if user.password_hash:
            await _save_password_to_history(self.db, str(user.id), user.password_hash)

        # Set new password and clear token
        user.password_hash = hash_password(new_password)
        user.password_changed_at = datetime.now(timezone.utc)
        user.must_change_password = False
        user.password_reset_token = None
        user.password_reset_expires_at = None
        user.failed_login_attempts = 0
        user.locked_until = None

        await self.db.flush()
        logger.info("Password successfully reset via token")

        return True, None
