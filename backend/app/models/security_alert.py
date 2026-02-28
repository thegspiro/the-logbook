"""
Security Alert Database Model

Persists security alerts so they survive server restarts.
"""

import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    Index,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.core.database import Base


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

    id = Column(String(36), primary_key=True)

    alert_type = Column(
        Enum(AlertType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )
    threat_level = Column(
        Enum(ThreatLevel, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )

    timestamp = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    description = Column(Text, nullable=False)

    source_ip = Column(String(45))
    user_id = Column(String(36), index=True)

    details = Column(JSON, nullable=False, default=dict)

    acknowledged = Column(Boolean, nullable=False, default=False)
    acknowledged_by = Column(String(255))
    acknowledged_at = Column(DateTime(timezone=True))

    resolved = Column(Boolean, nullable=False, default=False)
    resolved_by = Column(String(255))
    resolved_at = Column(DateTime(timezone=True))

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("idx_security_alert_timestamp", "timestamp"),
        Index("idx_security_alert_type_level", "alert_type", "threat_level"),
    )

    def __repr__(self):
        return f"<SecurityAlertRecord(id={self.id}, type={self.alert_type}, level={self.threat_level})>"
