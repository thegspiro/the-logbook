"""Add must_change_password column to users table

Revision ID: 20260220_0100
Revises: 20260219_0300
Create Date: 2026-02-20

Adds a boolean flag that forces users to change their password on next
login.  Set by admins when creating accounts with temporary passwords
or when resetting a user's password.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260220_0100"
down_revision = "20260219_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
