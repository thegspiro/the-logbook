"""
Admin hub metric preferences.

Every administration page shows the same frame: a header, four headline
metrics, a "Needs attention" queue and a tab bar. Three of the four metric
slots are choosable per module; the fourth is always the count that feeds the
queue, so it is not stored here at all.

Two scopes share one table. The department-wide row (``user_id`` NULL) is the
default every admin sees, and ``applies_to_everyone`` on that row decides
whether an individual admin may keep their own selection. Absence of any row
means the module's built-in default four — never "no metrics" (CLAUDE.md
Pitfall #19: a missing config must mean current behaviour).
"""

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

#: ``scope_key`` for the department-wide row. A user id can never collide with
#: it: ids are 36-character UUIDs and this is not one.
DEPARTMENT_SCOPE = "__department__"


class AdminHubMetricPreference(Base):
    """Which three metrics a module's admin page shows, per scope."""

    __tablename__ = "admin_hub_metric_preferences"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module_key = Column(String(50), nullable=False)

    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        comment="NULL on the department-wide row; set on a personal override.",
    )
    # Duplicates user_id on purpose. MySQL treats NULLs as distinct inside a
    # unique index, so a NULL user_id cannot carry the one-row-per-scope rule
    # this table needs — two department-wide rows would both be legal and the
    # reader would pick whichever the optimizer returned first.
    scope_key = Column(
        String(36),
        nullable=False,
        default=DEPARTMENT_SCOPE,
        server_default=DEPARTMENT_SCOPE,
        comment="user_id, or DEPARTMENT_SCOPE for the department-wide row.",
    )

    #: The three open slots, in display order. Slot 4 is always the attention
    #: count and is never stored.
    metric_keys = Column(JSON, nullable=False)

    #: Meaningful only on the department-wide row. True (the default) means
    #: every admin sees the department's selection and personal rows are
    #: ignored; False lets each admin keep their own.
    applies_to_everyone = Column(
        Boolean, nullable=False, default=True, server_default="1"
    )

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "module_key",
            "scope_key",
            name="uq_admin_hub_metric_pref_scope",
        ),
        Index("idx_admin_hub_metric_pref_org_module", "organization_id", "module_key"),
    )

    def __repr__(self) -> str:
        return (
            f"<AdminHubMetricPreference(module={self.module_key}, "
            f"scope={self.scope_key})>"
        )
