"""Add meeting_id foreign key to elections table

Revision ID: 20260227_0100
Revises: 20260226_0200
Create Date: 2026-02-27

Allows linking an election to a formal meeting record so that
attendance and context are shared between the two.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "20260227_0100"
down_revision = "20260226_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "elections",
        sa.Column("meeting_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_elections_meeting_id",
        "elections",
        "meetings",
        ["meeting_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_elections_meeting_id", "elections", ["meeting_id"])


def downgrade() -> None:
    op.drop_index("ix_elections_meeting_id", table_name="elections")
    op.drop_constraint("fk_elections_meeting_id", "elections", type_="foreignkey")
    op.drop_column("elections", "meeting_id")
