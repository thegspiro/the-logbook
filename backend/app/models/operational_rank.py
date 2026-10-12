"""
Operational Rank Model

Per-organization configurable operational ranks (e.g. Chief, Captain,
Firefighter).  Department leadership can add, rename, reorder, and
deactivate ranks through the admin settings UI.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class OperationalRank(Base):
    """
    Configurable operational rank for a department.

    Each organization maintains its own rank list.  The ``rank_code``
    is the machine-friendly slug stored on ``User.rank``; the
    ``display_name`` is shown in the UI.
    """

    __tablename__ = "operational_ranks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    rank_code: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )

    # Shift positions this rank is eligible to sign up for.
    # e.g. ["officer", "driver", "firefighter", "ems"]
    eligible_positions: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True, default=list
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "rank_code", name="uq_ranks_org_code"),
    )

    def __repr__(self):
        return f"<OperationalRank(rank_code={self.rank_code}, display_name={self.display_name})>"
