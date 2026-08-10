"""Add email_templates.footer_key.

Which named footer a template closes with. NULL means the department's
default footer, so every existing row keeps working without a data migration
and picks up the seeded library on its next render.

Revision ID: 20260810_0004
Revises: 20260810_0003
Create Date: 2026-08-10
"""

import sqlalchemy as sa
from alembic import op

revision = "20260810_0004"
down_revision = "20260810_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "email_templates",
        sa.Column("footer_key", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("email_templates", "footer_key")
