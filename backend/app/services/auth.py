"""
Authentication Service

Handles user authentication, session management, and MFA.
HIPAA compliant with comprehensive audit logging.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from fastapi import HTTPException, status
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
import pyotp
import qrcode
import io
import base64

from app.models.user import User, Session, UserStatus
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_secure_token,
    generate_verification_code,
)
from app.core.config import settings
from app.core.audit import log_audit_event


class AuthenticationError(HTTPException):
    """Custom authentication exception"""

    def __init__(self, detail: str):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class AuthService:
    """
    Authentication service with comprehensive security features
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def register_user(
        self,
        organization_id: str,
        username: str,
        email: str,
        password: str,
        first_name: str,
        last_name: str,
        **kwargs
    ) -> User:
        """
        Register a new user with secure password hashing

        Args:
            organization_id: Organization UUID
            username: Unique username
            email: User email address
            password: Plain text password (will be hashed)
            first_name: User's first name
            last_name: User's last name
            **kwargs: Additional user fields

        Returns:
            Created user object

        Raises:
            ValueError: If username/email already exists
        """
        # Check if username exists in organization
        existing_user = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.username == username
            )
        )
        if existing_user.scalar_one_or_none():
            raise ValueError("Username already exists")

        # Check if email exists in organization
        existing_email = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.email == email
            )
        )
        if existing_email.scalar_one_or_none():
            raise ValueError("Email already exists")

        # Hash password
        password_hash = hash_password(password)

        # Create user
        user = User(
            organization_id=organization_id,
            username=username,
            email=email,
            password_hash=password_hash,
            first_name=first_name,
            last_name=last_name,
            status=UserStatus.ACTIVE,
            password_changed_at=datetime.utcnow(),
            **kwargs
        )

        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)

        # Log audit event
        await log_audit_event(
            db=self.db,
            event_type="user.registered",
            event_category="authentication",
            severity="info",
            user_id=str(user.id),
            username=user.username,
            event_data={
                "organization_id": organization_id,
                "email": email,
            }
        )

        return user

    async def authenticate_user(
        self,
        organization_id: str,
        username: str,
        password: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        mfa_code: Optional[str] = None
    ) -> Tuple[User, str, str]:
        """
        Authenticate user and create session

        Args:
            organization_id: Organization UUID
            username: Username or email
            password: Plain text password
            ip_address: Client IP address
            user_agent: Client user agent
            mfa_code: Optional MFA code if MFA is enabled

        Returns:
            Tuple of (User object, access token, refresh token)

        Raises:
            AuthenticationError: If authentication fails
        """
        # Find user by username or email
        result = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                (User.username == username) | (User.email == username)
            )
        )
        user = result.scalar_one_or_none()

        if not user:
            # Log failed attempt (without user_id since user not found)
            await log_audit_event(
                db=self.db,
                event_type="auth.failed",
                event_category="authentication",
                severity="warning",
                username=username,
                ip_address=ip_address,
                event_data={"reason": "user_not_found"}
            )
            raise AuthenticationError("Invalid credentials")

        # Check if account is locked
        if user.is_locked:
            await log_audit_event(
                db=self.db,
                event_type="auth.account_locked",
                event_category="authentication",
                severity="warning",
                user_id=str(user.id),
                username=user.username,
                ip_address=ip_address,
                event_data={"locked_until": str(user.locked_until)}
            )
            raise AuthenticationError("Account is locked. Please try again later.")

        # Check if account is active
        if not user.is_active:
            await log_audit_event(
                db=self.db,
                event_type="auth.inactive_account",
                event_category="authentication",
                severity="warning",
                user_id=str(user.id),
                username=user.username,
                ip_address=ip_address,
                event_data={"status": user.status.value}
            )
            raise AuthenticationError("Account is not active")

        # Verify password
        if not verify_password(password, user.password_hash):
            # Increment failed login attempts
            user.failed_login_attempts += 1

            # Lock account after 5 failed attempts
            if user.failed_login_attempts >= 5:
                user.locked_until = datetime.utcnow() + timedelta(minutes=30)
                await log_audit_event(
                    db=self.db,
                    event_type="auth.account_locked_auto",
                    event_category="security",
                    severity="critical",
                    user_id=str(user.id),
                    username=user.username,
                    ip_address=ip_address,
                    event_data={"failed_attempts": user.failed_login_attempts}
                )

            await self.db.commit()

            await log_audit_event(
                db=self.db,
                event_type="auth.invalid_password",
                event_category="authentication",
                severity="warning",
                user_id=str(user.id),
                username=user.username,
                ip_address=ip_address,
                event_data={"failed_attempts": user.failed_login_attempts}
            )
            raise AuthenticationError("Invalid credentials")

        # Check MFA if enabled
        if user.mfa_enabled:
            if not mfa_code:
                raise AuthenticationError("MFA code required")

            if not self.verify_mfa_code(user, mfa_code):
                await log_audit_event(
                    db=self.db,
                    event_type="auth.invalid_mfa",
                    event_category="authentication",
                    severity="warning",
                    user_id=str(user.id),
                    username=user.username,
                    ip_address=ip_address,
                    event_data={}
                )
                raise AuthenticationError("Invalid MFA code")

        # Reset failed login attempts
        user.failed_login_attempts = 0
        user.last_login_at = datetime.utcnow()
        await self.db.commit()

        # Create tokens
        access_token = create_access_token(
            data={"sub": str(user.id), "org": organization_id, "username": user.username}
        )
        refresh_token = create_refresh_token(
            data={"sub": str(user.id), "org": organization_id}
        )

        # Create session
        session = Session(
            user_id=str(user.id),
            token=access_token,
            refresh_token=refresh_token,
            ip_address=ip_address,
            user_agent=user_agent,
            expires_at=datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        )
        self.db.add(session)
        await self.db.commit()

        # Log successful authentication
        await log_audit_event(
            db=self.db,
            event_type="auth.success",
            event_category="authentication",
            severity="info",
            user_id=str(user.id),
            username=user.username,
            session_id=str(session.id),
            ip_address=ip_address,
            user_agent=user_agent,
            event_data={"mfa_used": user.mfa_enabled}
        )

        return user, access_token, refresh_token

    async def logout(self, token: str) -> bool:
        """
        Logout user by invalidating session

        Args:
            token: Access token

        Returns:
            True if successful
        """
        # Find and delete session
        result = await self.db.execute(
            select(Session).where(Session.token == token)
        )
        session = result.scalar_one_or_none()

        if session:
            user_id = session.user_id
            await self.db.delete(session)
            await self.db.commit()

            # Log logout
            await log_audit_event(
                db=self.db,
                event_type="auth.logout",
                event_category="authentication",
                severity="info",
                user_id=user_id,
                session_id=str(session.id),
                event_data={}
            )

        return True

    async def refresh_access_token(self, refresh_token: str) -> Tuple[str, str]:
        """
        Refresh access token using refresh token

        Args:
            refresh_token: Valid refresh token

        Returns:
            Tuple of (new access token, new refresh token)

        Raises:
            AuthenticationError: If refresh token is invalid
        """
        try:
            payload = decode_token(refresh_token)

            if payload.get("type") != "refresh":
                raise AuthenticationError("Invalid token type")

            user_id = payload.get("sub")
            org_id = payload.get("org")

            # Verify user still exists and is active
            result = await self.db.execute(
                select(User).where(User.id == user_id)
            )
            user = result.scalar_one_or_none()

            if not user or not user.is_active:
                raise AuthenticationError("User not found or inactive")

            # Create new tokens
            new_access_token = create_access_token(
                data={"sub": user_id, "org": org_id, "username": user.username}
            )
            new_refresh_token = create_refresh_token(
                data={"sub": user_id, "org": org_id}
            )

            # Update session
            await self.db.execute(
                update(Session)
                .where(Session.refresh_token == refresh_token)
                .values(
                    token=new_access_token,
                    refresh_token=new_refresh_token,
                    expires_at=datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
                )
            )
            await self.db.commit()

            return new_access_token, new_refresh_token

        except Exception as e:
            raise AuthenticationError("Invalid refresh token")

    async def enable_mfa(self, user: User) -> Tuple[str, str]:
        """
        Enable MFA for user and return secret + QR code

        Args:
            user: User object

        Returns:
            Tuple of (secret, QR code base64 image)
        """
        # Generate MFA secret
        secret = pyotp.random_base32()

        # Create QR code
        totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
            name=user.email,
            issuer_name=settings.APP_NAME
        )

        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(totp_uri)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        qr_code_base64 = base64.b64encode(buffer.getvalue()).decode()

        # Save secret to user (not enabled yet - needs verification)
        user.mfa_secret = secret
        await self.db.commit()

        return secret, qr_code_base64

    def verify_mfa_code(self, user: User, code: str) -> bool:
        """
        Verify MFA code

        Args:
            user: User object
            code: 6-digit MFA code

        Returns:
            True if code is valid
        """
        if not user.mfa_secret:
            return False

        totp = pyotp.TOTP(user.mfa_secret)
        return totp.verify(code, valid_window=1)

    async def confirm_mfa_enable(self, user: User, code: str) -> bool:
        """
        Confirm MFA enable with verification code

        Args:
            user: User object
            code: 6-digit MFA code

        Returns:
            True if MFA enabled successfully

        Raises:
            ValueError: If code is invalid
        """
        if not self.verify_mfa_code(user, code):
            raise ValueError("Invalid MFA code")

        user.mfa_enabled = True
        await self.db.commit()

        # Log MFA enabled
        await log_audit_event(
            db=self.db,
            event_type="security.mfa_enabled",
            event_category="security",
            severity="info",
            user_id=str(user.id),
            username=user.username,
            event_data={}
        )

        return True

    async def disable_mfa(self, user: User) -> bool:
        """
        Disable MFA for user

        Args:
            user: User object

        Returns:
            True if successful
        """
        user.mfa_enabled = False
        user.mfa_secret = None
        user.mfa_backup_codes = None
        await self.db.commit()

        # Log MFA disabled
        await log_audit_event(
            db=self.db,
            event_type="security.mfa_disabled",
            event_category="security",
            severity="warning",
            user_id=str(user.id),
            username=user.username,
            event_data={}
        )

        return True

    async def change_password(
        self,
        user: User,
        current_password: str,
        new_password: str
    ) -> bool:
        """
        Change user password

        Args:
            user: User object
            current_password: Current password for verification
            new_password: New password

        Returns:
            True if successful

        Raises:
            ValueError: If current password is wrong or new password is invalid
        """
        # Verify current password
        if not verify_password(current_password, user.password_hash):
            raise ValueError("Current password is incorrect")

        # Check if new password is different
        if verify_password(new_password, user.password_hash):
            raise ValueError("New password must be different from current password")

        # Hash new password (validation happens in hash_password)
        new_hash = hash_password(new_password)

        # Update password
        user.password_hash = new_hash
        user.password_changed_at = datetime.utcnow()
        await self.db.commit()

        # Log password change
        await log_audit_event(
            db=self.db,
            event_type="security.password_changed",
            event_category="security",
            severity="info",
            user_id=str(user.id),
            username=user.username,
            event_data={}
        )

        return True
