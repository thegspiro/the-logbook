"""
Security Alert Database Model

Persists security alerts so they survive server restarts.
"""

import enum
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Enum, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class AlertType(str, enum.Enum):
    """Types of security alerts"""

    BRUTE_FORCE = "brute_force"
    SESSION_HIJACK = "session_hijack"
    DATA_EXFILTRATION = "data_exfiltration"
    LOG_TAMPERING = "log_tampering"
    ANOMALY_DETECTED = "anomaly_detected"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    PRIVILEGE_ESCALATION = "privilege_escalation"
    SUSPICIOUS_ACTIVITY = "suspicious_activity"
    EXTERNAL_DATA_TRANSFER = "external_data_transfer"
    RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"


class ThreatLevel(str, enum.Enum):
    """Security threat severity levels"""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SecurityAlertRecord(Base):
    """
    Persistent security alert records

    Stores security alerts in the database so they are not lost
    on server restart. Supports acknowledge/resolve workflows.
    """

    __tablename__ = "security_alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)

    alert_type: Mapped[AlertType] = mapped_column(
        Enum(AlertType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    threat_level: Mapped[ThreatLevel] = mapped_column(
        Enum(ThreatLevel, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)

    source_ip: Mapped[Optional[str]] = mapped_column(String(45))
    user_id: Mapped[Optional[str]] = mapped_column(String(36), index=True)

    # Tenant that the alert belongs to, so an org admin only sees (and can only
    # acknowledge/resolve) their own org's alerts. Nullable: pre-auth / IP-only
    # alerts (e.g. brute force against the login page) have no owning tenant and
    # are platform-level, not shown in any single org's view.
    organization_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    acknowledged: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    acknowledged_by: Mapped[Optional[str]] = mapped_column(String(255))
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    resolved: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    resolved_by: Mapped[Optional[str]] = mapped_column(String(255))
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # What the officer found, written when the alert is resolved. Capped at
    # the API (1,000 characters); set once, never overwritten by a second
    # resolve, so the trail keeps the first account of what happened.
    resolution_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("idx_security_alert_timestamp", "timestamp"),
        Index("idx_security_alert_type_level", "alert_type", "threat_level"),
        Index("idx_security_alert_org_timestamp", "organization_id", "timestamp"),
    )

    def __repr__(self):
        return f"<SecurityAlertRecord(id={self.id}, type={self.alert_type}, level={self.threat_level})>"
