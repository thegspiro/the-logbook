"""Add shift position eligibility columns

Add eligible_positions JSON to operational_ranks, open_to_all_members
boolean to shift_templates and shifts for position-based signup
eligibility enforcement.

Revision ID: a9f3e7c10003
Revises: a9f3e7c10002
Create Date: 2026-03-17 01:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "a9f3e7c10003"
down_revision = "a9f3e7c10002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Eligible shift positions per rank (e.g. ["officer", "driver", "firefighter"])
    op.add_column(
        "operational_ranks",
        sa.Column("eligible_positions", sa.JSON(), nullable=True),
    )

    # Allow shift templates to be marked as open to all membership types
    op.add_column(
        "shift_templates",
        sa.Column(
            "open_to_all_members",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )

    # Same flag on shifts (copied from template at creation time)
    op.add_column(
        "shifts",
        sa.Column(
            "open_to_all_members",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("shifts", "open_to_all_members")
    op.drop_column("shift_templates", "open_to_all_members")
    op.drop_column("operational_ranks", "eligible_positions")
