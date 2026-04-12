"""Add is_persistent column to department_messages

Allows admins to mark messages as persistent so they remain visible
until explicitly cleared by another admin, ignoring normal read/dismiss
behavior for regular members.

Revision ID: 20260321_0301
Revises: 20260321_0200
Create Date: 2026-03-21 03:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260321_0301"
down_revision = "20260321_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "department_messages",
        sa.Column(
            "is_persistent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("department_messages", "is_persistent")
