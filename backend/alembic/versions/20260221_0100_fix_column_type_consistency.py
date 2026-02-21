"""Fix column type consistency

Convert training_waivers.waiver_type and member_leaves_of_absence.leave_type
from VARCHAR(30) to proper ENUM types to match their SQLAlchemy model
definitions.

Revision ID: 20260221_0100
Revises: 20260220_0300
Create Date: 2026-02-21
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260221_0100"
down_revision = "20260220_0300"
branch_labels = None
depends_on = None

# Enum values shared by both columns
LEAVE_ENUM_VALUES = (
    "leave_of_absence",
    "medical",
    "military",
    "personal",
    "administrative",
    "other",
)


def upgrade() -> None:
    # training_waivers.waiver_type: VARCHAR(30) → ENUM
    op.alter_column(
        "training_waivers",
        "waiver_type",
        existing_type=sa.String(30),
        type_=sa.Enum(*LEAVE_ENUM_VALUES, name="trainingwaivertype"),
        existing_nullable=False,
        existing_server_default="leave_of_absence",
    )

    # member_leaves_of_absence.leave_type: VARCHAR(30) → ENUM
    op.alter_column(
        "member_leaves_of_absence",
        "leave_type",
        existing_type=sa.String(30),
        type_=sa.Enum(*LEAVE_ENUM_VALUES, name="leavetype"),
        existing_nullable=False,
        existing_server_default="leave_of_absence",
    )


def downgrade() -> None:
    # Revert to VARCHAR(30)
    op.alter_column(
        "member_leaves_of_absence",
        "leave_type",
        existing_type=sa.Enum(*LEAVE_ENUM_VALUES, name="leavetype"),
        type_=sa.String(30),
        existing_nullable=False,
        existing_server_default="leave_of_absence",
    )

    op.alter_column(
        "training_waivers",
        "waiver_type",
        existing_type=sa.Enum(*LEAVE_ENUM_VALUES, name="trainingwaivertype"),
        type_=sa.String(30),
        existing_nullable=False,
        existing_server_default="leave_of_absence",
    )
