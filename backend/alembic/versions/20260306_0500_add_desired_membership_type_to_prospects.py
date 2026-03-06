"""add desired_membership_type to prospective_members table

Revision ID: 20260306_0500
Revises: 20260306_0400
Create Date: 2026-03-06 05:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260306_0500"
down_revision = "20260306_0400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prospective_members",
        sa.Column(
            "desired_membership_type",
            sa.String(50),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("prospective_members", "desired_membership_type")
