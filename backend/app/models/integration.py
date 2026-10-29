"""
Integration Database Models

SQLAlchemy models for external integration configurations.
"""

import json
from datetime import datetime
from typing import Any, Dict, Optional

from loguru import logger
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

# Outcomes of an IntegrationSyncLog row. "running" is written before a Retry
# Sync calls the provider, so a second retry inside the cooldown sees it.
INTEGRATION_RUN_RUNNING = "running"
INTEGRATION_RUN_SUCCESS = "success"
INTEGRATION_RUN_FAILURE = "failure"

# CalendarSyncMapping.status. A "failed" row with next_attempt_at set is
# waiting for its next retry; with next_attempt_at empty, retries are spent
# and the row is left alone until the event changes.
CALENDAR_SYNC_SYNCED = "synced"
CALENDAR_SYNC_PENDING_DELETE = "pending_delete"
CALENDAR_SYNC_FAILED = "failed"


class Integration(Base):
    """Stores integration configurations per organization"""

    __tablename__ = "integrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(String(36), nullable=False)
    integration_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # google-calendar, slack, etc.
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # Calendar, Messaging, Data, EMS...
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="available"
    )  # available, connected, error, coming_soon
    config: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, default=dict
    )  # Non-sensitive config
    encrypted_config: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # AES-256 encrypted secrets
    enabled: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    contains_phi: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False
    )  # Stricter audit when True
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Health, maintained by app.services.integration_health. last_error is
    # sanitized before it is written — no URLs, tokens or email addresses.
    last_success_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_error_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    consecutive_error_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
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


class WeatherAlert(Base):
    """An NWS alert the department's weather integration has seen.

    One row per NWS alert id per department: the unique key is what makes a
    second poll of the same alert a no-op, so members are told about each alert
    once however often the zone is polled. ``ended_at`` is set when the alert
    stops appearing in the zone's active list before it expires (NWS cancelled
    or replaced it). Only Severe and Extreme alerts are stored (owner decision
    2026-10-29). The text is NWS's public bulletin, not member data.
    """

    __tablename__ = "weather_alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    nws_id: Mapped[str] = mapped_column(String(255), nullable=False)
    event: Mapped[str] = mapped_column(String(255), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False)
    urgency: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    headline: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    instruction: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    area_desc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    onset: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # When the alert was first seen: the row is created then.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "nws_id", name="uq_weather_alerts_org_nws_id"
        ),
        Index("ix_weather_alerts_org_ended", "organization_id", "ended_at"),
    )


class IntegrationSyncLog(Base):
    """One run of an integration: a sync, a connection check, a chat delivery.

    Bounded per integration (``MAX_SYNC_HISTORY`` in
    app.services.integration_health). ``summary`` holds integer counts only and
    ``error_message`` is sanitized, so the history never carries the records
    that moved or a provider's raw response.
    """

    __tablename__ = "integration_sync_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    operation: Mapped[str] = mapped_column(String(50), nullable=False)
    # "trigger" is a reserved word in MySQL.
    trigger_source: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    summary: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    triggered_by: Mapped[Optional[str]] = mapped_column(
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


class CalendarSyncMapping(Base):
    """One department event as published to an external calendar.

    Written only by app.services.calendar_sync_service. ``content_hash`` is
    the digest of the payload the reconciler last meant the calendar to hold
    (empty once the event is due for deletion); with ``status`` "synced" the
    calendar is known to hold exactly that. ``last_error`` is sanitized.
    """

    __tablename__ = "calendar_sync_mappings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    # No foreign key: when an event is deleted the row has to outlive it, so
    # the next pass can still delete the copy in the external calendar.
    event_id: Mapped[str] = mapped_column(String(36), nullable=False)
    external_event_id: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    external_calendar_id: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True
    )
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=CALENDAR_SYNC_SYNCED
    )
    attempt_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_calendar_sync_mappings_organization_id", "organization_id"),
        UniqueConstraint(
            "integration_id",
            "event_id",
            name="uq_calendar_sync_mappings_integration_event",
        ),
        Index(
            "ix_calendar_sync_mappings_status_next_attempt",
            "status",
            "next_attempt_at",
        ),
    )
