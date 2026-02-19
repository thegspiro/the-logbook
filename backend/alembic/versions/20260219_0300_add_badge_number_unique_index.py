"""Add unique index on organization_id + badge_number

Revision ID: 20260219_0300
Revises: 20260219_0200
Create Date: 2026-02-19
"""

from alembic import op

revision = "20260219_0300"
down_revision = "20260219_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_user_org_badge_number",
        "users",
        ["organization_id", "badge_number"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("idx_user_org_badge_number", table_name="users")
