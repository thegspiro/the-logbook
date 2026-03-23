"""Add previous_membership_number to users table

Stores the original membership number when a member is soft-deleted,
so it can be restored on reactivation. This allows the unique index
on (organization_id, membership_number) to work correctly: soft-deleted
rows get membership_number set to NULL, freeing the value for reuse,
while previous_membership_number preserves it for returning members.

Revision ID: a9f3e7c10004
Revises: a9f3e7c10003
Create Date: 2026-03-23 01:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "a9f3e7c10004"
down_revision = "a9f3e7c10003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("previous_membership_number", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "previous_membership_number")
