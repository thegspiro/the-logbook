"""
Operational Rank Model

Per-organization configurable operational ranks (e.g. Fire Chief, Captain,
Firefighter).  Department leadership can add, rename, reorder, and
deactivate ranks through the admin settings UI.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
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

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    rank_code = Column(String(100), nullable=False)
    display_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "rank_code", name="uq_ranks_org_code"),
        Index("ix_operational_ranks_org", "organization_id"),
    )

    def __repr__(self):
        return f"<OperationalRank(rank_code={self.rank_code}, display_name={self.display_name})>"
