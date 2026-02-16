"""Add membership_number column to users table

Revision ID: 20260216_0300
Revises: 20260216_0200
Create Date: 2026-02-16

Adds an organization-assigned membership number (e.g. "001", "M-042") to the
users table. Unique per organization so that no two active members share the
same membership number.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "20260216_0300"
down_revision = "20260216_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("membership_number", sa.String(50), nullable=True))
    op.create_index(
        "idx_user_org_membership_number",
        "users",
        ["organization_id", "membership_number"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("idx_user_org_membership_number", table_name="users")
    op.drop_column("users", "membership_number")
