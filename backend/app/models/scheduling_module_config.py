"""
Scheduling Module Configuration model

Organization-level shift/scheduling defaults (position names, apparatus-type
crew defaults, equipment-check rules). Previously these lived only in each
admin's browser localStorage, so every admin had a private copy; this table
makes them department-wide, mirroring TrainingModuleConfig's architecture
(one row per organization, get-or-create on first read).

All setting columns are nullable: NULL means "unset — use the built-in
default". A missing row means the organization has never saved settings at
all, which the API reports so the frontend can run its one-time localStorage
migration.
"""

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class SchedulingModuleConfig(Base):
    """Per-organization scheduling module defaults (one row per org)."""

    __tablename__ = "scheduling_module_configs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # -- Department defaults for new shifts --
    default_duration_hours = Column(Float, nullable=True)
    default_min_staffing = Column(Integer, nullable=True)
    require_assignment_confirmation = Column(Boolean, nullable=True)
    overtime_threshold_hours_per_week = Column(Float, nullable=True)

    # -- Position names --
    # ["officer", "driver", ...] — which built-in positions are offered
    enabled_positions = Column(JSON, nullable=True)
    # [{"value": "rescue_tech", "label": "Rescue Technician"}, ...]
    custom_positions = Column(JSON, nullable=True)

    # -- Crew defaults per apparatus / event-resource type --
    # Nested keys are stored camelCase (e.g. "minStaffing") — the wire and
    # frontend shape — so the JSON round-trips without a mapping layer.
    # {"engine": {"positions": [...], "minStaffing": 4}, ...}
    apparatus_type_defaults = Column(JSON, nullable=True)
    # {"first_aid_station": {"positions": [...], "label": "First Aid Station"}}
    resource_type_defaults = Column(JSON, nullable=True)

    # -- Equipment-check rules --
    # {"enabled": bool, "requireSignature": bool,
    #  "defaultExpirationWarningDays": int, "blockShiftStartOnFail": bool}
    equipment_check_settings = Column(JSON, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self):
        return f"<SchedulingModuleConfig(org_id={self.organization_id})>"
