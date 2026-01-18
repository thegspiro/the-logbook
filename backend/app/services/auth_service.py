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

from app.models.user import User, Session as UserSession, Organization
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
    validate_password_strength,
)
from app.core.config import settings
from loguru import logger


class AuthService:
    """Service for authentication operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def authenticate_user(
        self,
        username: str,
        password: str
    ) -> Optional[User]:
        """
        Authenticate a user by username and password

        Args:
            username: Username or email
            password: Plain text password

        Returns:
            User object if authentication successful, None otherwise
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
            logger.warning(f"Authentication failed: user not found - {username}")
            return None

        if not user.password_hash:
            logger.warning(f"Authentication failed: no password set - {username}")
            return None

        # Check if account is locked
        if user.locked_until and user.locked_until > datetime.utcnow():
            logger.warning(f"Authentication failed: account locked - {username}")
            return None

        # Verify password
        if not verify_password(password, user.password_hash):
            # Increment failed login attempts
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1

            # Lock account after 5 failed attempts
            if user.failed_login_attempts >= 5:
                user.locked_until = datetime.utcnow() + timedelta(minutes=30)
                logger.warning(f"Account locked due to failed attempts - {username}")

            await self.db.commit()
            logger.warning(f"Authentication failed: invalid password - {username}")
            return None

        # Reset failed login attempts on successful login
        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = datetime.utcnow()
        await self.db.commit()

        return user

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

        # Store session
        session = UserSession(
            id=uuid4(),
            user_id=user.id,
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

    async def refresh_access_token(self, refresh_token: str) -> Optional[str]:
        """
        Refresh an access token using a refresh token

        Args:
            refresh_token: Refresh token string

        Returns:
            New access token if successful, None otherwise
        """
        try:
            # Decode refresh token
            payload = decode_token(refresh_token)

            if payload.get("type") != "refresh":
                return None

            user_id = UUID(payload.get("sub"))

            # Get user
            result = await self.db.execute(
                select(User)
                .where(User.id == user_id)
                .where(User.deleted_at.is_(None))
            )
            user = result.scalar_one_or_none()

            if not user or not user.is_active:
                return None

            # Create new access token
            token_data = {
                "sub": str(user.id),
                "username": user.username,
                "org_id": str(user.organization_id),
            }

            new_access_token = create_access_token(token_data)

            # Update session
            result = await self.db.execute(
                select(UserSession).where(UserSession.refresh_token == refresh_token)
            )
            session = result.scalar_one_or_none()

            if session:
                session.token = new_access_token
                session.expires_at = datetime.utcnow() + timedelta(
                    minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
                )
                await self.db.commit()

            return new_access_token

        except Exception as e:
            logger.error(f"Token refresh failed: {e}")
            return None

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

        # Check if username exists
        result = await self.db.execute(
            select(User).where(
                User.username == username,
                User.organization_id == organization_id,
                User.deleted_at.is_(None)
            )
        )
        if result.scalar_one_or_none():
            return None, "Username already exists"

        # Check if email exists
        result = await self.db.execute(
            select(User).where(
                User.email == email,
                User.organization_id == organization_id,
                User.deleted_at.is_(None)
            )
        )
        if result.scalar_one_or_none():
            return None, "Email already exists"

        # Create user
        user = User(
            id=uuid4(),
            organization_id=organization_id,
            username=username,
            email=email,
            password_hash=get_password_hash(password),
            first_name=first_name,
            last_name=last_name,
            badge_number=badge_number,
            status="active",
            email_verified=False,
        )

        self.db.add(user)
        await self.db.commit()
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
                await self.db.commit()
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
        user.password_hash = get_password_hash(new_password)
        user.password_changed_at = datetime.utcnow()

        await self.db.commit()

        logger.info(f"Password changed for user: {user.username}")

        return True, None

    async def get_user_from_token(self, token: str) -> Optional[User]:
        """
        Get user from access token

        Args:
            token: Access token

        Returns:
            User object if token is valid, None otherwise
        """
        try:
            payload = decode_token(token)

            if payload.get("type") != "access":
                return None

            user_id = UUID(payload.get("sub"))

            result = await self.db.execute(
                select(User)
                .where(User.id == user_id)
                .where(User.deleted_at.is_(None))
                .options(selectinload(User.roles))
            )
            user = result.scalar_one_or_none()

            return user if user and user.is_active else None

        except Exception as e:
            logger.error(f"Token validation failed: {e}")
            return None
