"""Consolidate badge_number into membership_number

Removes the redundant badge_number column. Any existing badge_number values
are copied into membership_number where membership_number is currently NULL,
so no data is lost.  The unique index on badge_number is dropped.

Revision ID: 20260221_0200
Revises: 20260221_0100
Create Date: 2026-02-21
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "20260221_0200"
down_revision = "20260221_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Copy badge_number into membership_number where membership_number is NULL
    op.execute(
        "UPDATE users SET membership_number = badge_number "
        "WHERE membership_number IS NULL AND badge_number IS NOT NULL"
    )

    # Drop the badge_number unique index
    op.drop_index("idx_user_org_badge_number", table_name="users")

    # Drop the badge_number column
    op.drop_column("users", "badge_number")


def downgrade() -> None:
    # Re-add badge_number column
    op.add_column("users", sa.Column("badge_number", sa.String(50), nullable=True))

    # Re-create the unique index
    op.create_index(
        "idx_user_org_badge_number",
        "users",
        ["organization_id", "badge_number"],
        unique=True,
    )
