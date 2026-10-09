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

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class SchedulingModuleConfig(Base):
    """Per-organization scheduling module defaults (one row per org)."""

    __tablename__ = "scheduling_module_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # -- Department defaults for new shifts --
    default_duration_hours: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )
    default_min_staffing: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    require_assignment_confirmation: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True
    )
    overtime_threshold_hours_per_week: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )

    # -- Position names --
    # ["officer", "driver", ...] — which built-in positions are offered
    enabled_positions: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    # [{"value": "rescue_tech", "label": "Rescue Technician"}, ...]
    custom_positions: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )

    # -- Crew defaults per apparatus / event-resource type --
    # Nested keys are stored camelCase (e.g. "minStaffing") — the wire and
    # frontend shape — so the JSON round-trips without a mapping layer.
    # {"engine": {"positions": [...], "minStaffing": 4}, ...}
    apparatus_type_defaults: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    # {"first_aid_station": {"positions": [...], "label": "First Aid Station"}}
    resource_type_defaults: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self):
        return f"<SchedulingModuleConfig(org_id={self.organization_id})>"
