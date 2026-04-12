"""
Integration Database Models

SQLAlchemy models for external integration configurations.
"""

import json
from typing import Any, Optional

from loguru import logger
from sqlalchemy import JSON, Boolean, Column, DateTime, Index, String, Text
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class Integration(Base):
    """Stores integration configurations per organization"""

    __tablename__ = "integrations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), nullable=False, index=True)
    integration_type = Column(
        String(50), nullable=False
    )  # google-calendar, slack, etc.
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=False)  # Calendar, Messaging, Data, EMS...
    status = Column(
        String(20), nullable=False, default="available"
    )  # available, connected, error, coming_soon
    config = Column(JSON, default=dict)  # Non-sensitive config
    encrypted_config = Column(Text, nullable=True)  # AES-256 encrypted secrets
    enabled = Column(Boolean, default=False)
    contains_phi = Column(Boolean, default=False)  # Stricter audit when True
    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index(
            "ix_integrations_org_type",
            "organization_id",
            "integration_type",
            unique=True,
        ),
    )

    # ==========================================
    # Secret management helpers
    # ==========================================

    def set_secret(self, key: str, value: str) -> None:
        """Store a secret value in encrypted_config."""
        from app.core.security import encrypt_data

        secrets = self._get_secrets_dict()
        secrets[key] = value
        self.encrypted_config = encrypt_data(json.dumps(secrets))

    def get_secret(self, key: str) -> Optional[str]:
        """Retrieve a secret value from encrypted_config."""
        secrets = self._get_secrets_dict()
        return secrets.get(key)

    def _get_secrets_dict(self) -> dict[str, Any]:
        """Decrypt and parse the encrypted_config JSON."""
        if not self.encrypted_config:
            return {}
        try:
            from app.core.security import decrypt_data

            decrypted = decrypt_data(self.encrypted_config)
            return json.loads(decrypted)
        except Exception:
            logger.warning(
                "Failed to decrypt encrypted_config for integration %s", self.id
            )
            return {}
