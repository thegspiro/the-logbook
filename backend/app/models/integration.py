"""
Integration Database Models

SQLAlchemy models for external integration configurations.
"""

import json
from typing import Any, Dict, Optional

from loguru import logger
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

# Outcomes of an IntegrationSyncLog row. "running" is written before a Retry
# Sync calls the provider, so a second retry inside the cooldown sees it.
INTEGRATION_RUN_RUNNING = "running"
INTEGRATION_RUN_SUCCESS = "success"
INTEGRATION_RUN_FAILURE = "failure"


class Integration(Base):
    """Stores integration configurations per organization"""

    __tablename__ = "integrations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), nullable=False)
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
    # Health, maintained by app.services.integration_health. last_error is
    # sanitized before it is written — no URLs, tokens or email addresses.
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    last_error_at = Column(DateTime(timezone=True), nullable=True)
    consecutive_error_count = Column(
        Integer, nullable=False, default=0, server_default="0"
    )
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

    def clear_secret(self, key: str) -> None:
        """Remove a stored secret so integrations can change auth flows."""
        from app.core.security import encrypt_data

        secrets = self._get_secrets_dict()
        secrets.pop(key, None)
        self.encrypted_config = encrypt_data(json.dumps(secrets)) if secrets else None

    def _get_secrets_dict(self) -> dict[str, Any]:
        """Decrypt and parse the encrypted_config JSON."""
        if not self.encrypted_config:
            return {}
        try:
            from app.core.security import decrypt_data

            decrypted = decrypt_data(self.encrypted_config)
            config: Dict[str, Any] = json.loads(decrypted)
            return config
        except Exception:
            logger.warning(
                "Failed to decrypt encrypted_config for integration {}", self.id
            )
            return {}


class IntegrationSyncLog(Base):
    """One run of an integration: a sync, a connection check, a chat delivery.

    Bounded per integration (``MAX_SYNC_HISTORY`` in
    app.services.integration_health). ``summary`` holds integer counts only and
    ``error_message`` is sanitized, so the history never carries the records
    that moved or a provider's raw response.
    """

    __tablename__ = "integration_sync_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    integration_id = Column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    operation = Column(String(50), nullable=False)
    # "trigger" is a reserved word in MySQL.
    trigger_source = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False)
    started_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at = Column(DateTime(timezone=True), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    summary = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    triggered_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index(
            "ix_integration_sync_logs_integration_started",
            "integration_id",
            "started_at",
        ),
        Index(
            "ix_integration_sync_logs_org_started",
            "organization_id",
            "started_at",
        ),
    )
