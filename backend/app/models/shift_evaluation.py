"""
Shift evaluation templates

A department's own evaluation forms — the paper "EMT Shift Evaluation" a
preceptor fills out, rebuilt as data so training officers can change the
wording, the scale and the rules without a release.

A template is chosen two ways. A training program names one, so a member
enrolled in that program is evaluated on it ("a driver candidate gets the
driver evaluation"). The department may also name one in its training settings
as the general form, used for members in no program who sat in one of the
template's ``evaluated_seats``.

The JSON columns hold one canonical shape each, settled by the Pydantic
schemas in ``app/schemas/shift_evaluation.py`` on every write (Pitfall #20).
An evaluation records a copy of the template it was filled out on, so editing
a template never rewrites a submitted evaluation.
"""

from datetime import datetime
from typing import Any, Optional

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

#: Who fills out an evaluation on this template. Only the shift officer for
#: now; stored as a value rather than implied so another rule can be added
#: without a migration.
EVALUATOR_RULES: tuple[str, ...] = ("shift_officer",)
DEFAULT_EVALUATOR_RULE = EVALUATOR_RULES[0]

#: The figures a template may ask for under "Shift Statistics".
STATISTIC_KEYS: tuple[str, ...] = ("calls", "transports", "refusals")

#: How the department uses its general form. NULL on the settings row reads as
#: "off", so an installation that never chose one evaluates nobody new.
GENERAL_EVALUATION_MODES: tuple[str, ...] = ("off", "optional", "required")
DEFAULT_GENERAL_EVALUATION_MODE = GENERAL_EVALUATION_MODES[0]


class ShiftEvaluationTemplate(Base):
    """One evaluation form a department has defined."""

    __tablename__ = "shift_evaluation_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False
    )
    # Bumped on every saved edit. An evaluation stores the version it was
    # filled out on beside its copy of the template.
    version: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )

    # [{"value": 1, "label": "Unsatisfactory"}, ...] ascending by value.
    scale: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    allow_not_applicable: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False
    )
    not_applicable_label: Mapped[str] = mapped_column(
        String(100),
        default="Not Observed",
        server_default="Not Observed",
        nullable=False,
    )
    # A rating at or below this value needs a comment. NULL: never required by
    # rating (an item may still require one always).
    comment_required_at_or_below: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )

    # [{"key", "label", "type": "text"|"choice", "options": [...], "required"}]
    header_fields: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    # Subset of STATISTIC_KEYS, in display order.
    statistics: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    # [{"key", "title", "column_heading", "items": [{"key", "label",
    #   "description", "comment_always_required"}]}]
    sections: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    # Free-text block at the end of the form ("Preceptor Comments"). NULL
    # leaves it off.
    closing_comments_label: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    closing_comments_hint: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )

    evaluator_rule: Mapped[str] = mapped_column(
        String(30),
        default=DEFAULT_EVALUATOR_RULE,
        server_default=DEFAULT_EVALUATOR_RULE,
        nullable=False,
    )
    # Seat tokens (canonical_position form). Read only when this template is
    # the department's general form; a program's template evaluates the
    # program's enrolled members whatever seat they sat in.
    evaluated_seats: Mapped[list[str]] = mapped_column(JSON, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index(
            "idx_shift_evaluation_template_org_active", "organization_id", "is_active"
        ),
        UniqueConstraint(
            "organization_id", "name", name="uq_shift_evaluation_template_org_name"
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<ShiftEvaluationTemplate(name={self.name!r}, org={self.organization_id})>"
        )
