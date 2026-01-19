"""
Secure Onboarding Session Management

Stores onboarding data server-side to prevent client-side exposure
of sensitive information like passwords, API keys, and secrets.

SECURITY: This prevents passwords and secrets from being stored in
browser sessionStorage where they can be accessed by XSS attacks or
browser extensions.
"""

from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import secrets
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.models.onboarding import OnboardingSessionModel
from app.core.security import encrypt_data, decrypt_data


class OnboardingSessionManager:
    """
    Manage secure server-side onboarding sessions

    All sensitive data (passwords, API keys, secrets) is stored
    encrypted in the database, not in browser sessionStorage.
    """

    SESSION_TIMEOUT = timedelta(hours=2)  # Sessions expire after 2 hours

    @staticmethod
    def generate_session_id() -> str:
        """Generate a secure session ID"""
        return secrets.token_urlsafe(32)

    async def create_session(
        self,
        db: AsyncSession,
        ip_address: str,
        user_agent: Optional[str] = None
    ) -> str:
        """
        Create a new onboarding session

        Returns:
            session_id: Unique session identifier
        """
        session_id = self.generate_session_id()
        expires_at = datetime.utcnow() + self.SESSION_TIMEOUT

        session = OnboardingSessionModel(
            session_id=session_id,
            data={},
            ip_address=ip_address,
            user_agent=user_agent,
            expires_at=expires_at,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )

        db.add(session)
        await db.commit()

        return session_id

    async def get_session(
        self,
        db: AsyncSession,
        session_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get onboarding session data

        Returns:
            Session data dict or None if not found/expired
        """
        result = await db.execute(
            select(OnboardingSessionModel).where(
                OnboardingSessionModel.session_id == session_id
            )
        )
        session = result.scalar_one_or_none()

        if not session:
            return None

        # Check if expired
        if session.expires_at < datetime.utcnow():
            # Delete expired session
            await db.delete(session)
            await db.commit()
            return None

        return session.data

    async def update_session(
        self,
        db: AsyncSession,
        session_id: str,
        data: Dict[str, Any],
        merge: bool = True
    ) -> bool:
        """
        Update onboarding session data

        Args:
            session_id: Session identifier
            data: Data to store
            merge: If True, merge with existing data. If False, replace.

        Returns:
            True if successful, False if session not found
        """
        result = await db.execute(
            select(OnboardingSessionModel).where(
                OnboardingSessionModel.session_id == session_id
            )
        )
        session = result.scalar_one_or_none()

        if not session:
            return False

        # Check if expired
        if session.expires_at < datetime.utcnow():
            await db.delete(session)
            await db.commit()
            return False

        # Update data
        if merge:
            session.data = {**session.data, **data}
        else:
            session.data = data

        session.updated_at = datetime.utcnow()

        await db.commit()
        return True

    async def delete_session(
        self,
        db: AsyncSession,
        session_id: str
    ) -> bool:
        """
        Delete onboarding session

        Returns:
            True if deleted, False if not found
        """
        result = await db.execute(
            select(OnboardingSessionModel).where(
                OnboardingSessionModel.session_id == session_id
            )
        )
        session = result.scalar_one_or_none()

        if not session:
            return False

        await db.delete(session)
        await db.commit()
        return True

    async def cleanup_expired_sessions(
        self,
        db: AsyncSession
    ) -> int:
        """
        Clean up expired sessions

        Returns:
            Number of sessions deleted
        """
        result = await db.execute(
            delete(OnboardingSessionModel).where(
                OnboardingSessionModel.expires_at < datetime.utcnow()
            )
        )
        await db.commit()
        return result.rowcount

    async def store_sensitive_data(
        self,
        db: AsyncSession,
        session_id: str,
        key: str,
        value: str
    ) -> bool:
        """
        Store sensitive data (password, API key, etc.) encrypted

        SECURITY: Sensitive data is encrypted before storage

        Args:
            session_id: Session identifier
            key: Data key (e.g., 'admin_password')
            value: Sensitive value to encrypt and store

        Returns:
            True if successful
        """
        # Encrypt the sensitive value
        encrypted_value = encrypt_data(value)

        # Store in session with _encrypted suffix
        return await self.update_session(
            db,
            session_id,
            {f"{key}_encrypted": encrypted_value}
        )

    async def get_sensitive_data(
        self,
        db: AsyncSession,
        session_id: str,
        key: str
    ) -> Optional[str]:
        """
        Retrieve and decrypt sensitive data

        Args:
            session_id: Session identifier
            key: Data key (e.g., 'admin_password')

        Returns:
            Decrypted value or None if not found
        """
        session_data = await self.get_session(db, session_id)

        if not session_data:
            return None

        encrypted_value = session_data.get(f"{key}_encrypted")

        if not encrypted_value:
            return None

        # Decrypt and return
        return decrypt_data(encrypted_value)

    async def clear_sensitive_data(
        self,
        db: AsyncSession,
        session_id: str,
        key: str
    ) -> bool:
        """
        Remove sensitive data from session

        SECURITY: Should be called immediately after using sensitive data
        (e.g., after creating admin user with password)

        Args:
            session_id: Session identifier
            key: Data key to remove

        Returns:
            True if successful
        """
        session_data = await self.get_session(db, session_id)

        if not session_data:
            return False

        # Remove the encrypted key
        if f"{key}_encrypted" in session_data:
            del session_data[f"{key}_encrypted"]

            # Update session without the sensitive data
            return await self.update_session(
                db,
                session_id,
                session_data,
                merge=False
            )

        return True


# ============================================
# Database Model
# ============================================

"""
Add this model to app/models/onboarding.py:

from sqlalchemy import Column, String, JSON, DateTime, Text
from sqlalchemy.ext.mutable import MutableDict
from app.core.database import Base
from app.core.utils import generate_uuid

class OnboardingSessionModel(Base):
    '''
    Server-side onboarding session storage

    SECURITY: Stores sensitive onboarding data encrypted server-side
    instead of in browser sessionStorage
    '''
    __tablename__ = "onboarding_sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(64), unique=True, nullable=False, index=True)
    data = Column(MutableDict.as_mutable(JSON), default={}, nullable=False)
    ip_address = Column(String(45), nullable=False)
    user_agent = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    def __repr__(self):
        return f"<OnboardingSession(id={self.id}, session_id={self.session_id[:8]}...)>"
"""
