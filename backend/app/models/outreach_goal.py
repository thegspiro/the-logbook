"""A department's yearly outreach goals (owner decisions, 2026-11-24).

A goal targets one figure for one calendar year in the department's timezone:
either a CRR count from the catalogue ("Alarms installed", 200) or one of
Outreach Impact's headline figures (events held, people reached, member
hours). Progress is never stored; it is computed from the same rows the
screens count (OutreachGoalService).
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

#: The Outreach Impact figures a goal can target; each is the report's own
#: total of the same name.
OUTREACH_METRICS = ("events_held", "people_reached", "member_hours")


class OutreachGoal(Base):
    __tablename__ = "outreach_goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    # A CRR count. CASCADE: a count goes only with the department's own
    # activity type, and a goal for a count that no longer exists means
    # nothing. A built-in count is retired, never deleted, so its goals stay.
    measure_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("crr_activity_measures.id", ondelete="CASCADE"),
        nullable=True,
    )
    # Or one of OUTREACH_METRICS.
    outreach_metric: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    target: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        # Exactly one of the two: a goal targets one figure.
        CheckConstraint(
            "(measure_id IS NULL) <> (outreach_metric IS NULL)",
            name="ck_outreach_goals_one_target",
        ),
        CheckConstraint("target > 0", name="ck_outreach_goals_target"),
        # A NULL never collides in a unique key, so each constraint binds only
        # the goals of its own kind: one goal per count, and one per figure,
        # in a year.
        UniqueConstraint(
            "organization_id", "year", "measure_id", name="uq_outreach_goals_measure"
        ),
        UniqueConstraint(
            "organization_id",
            "year",
            "outreach_metric",
            name="uq_outreach_goals_metric",
        ),
        Index("ix_outreach_goals_measure", "measure_id"),
    )
