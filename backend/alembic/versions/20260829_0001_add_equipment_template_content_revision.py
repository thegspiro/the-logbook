"""Add equipment-check template content revision.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
"""

import sqlalchemy as sa
from alembic import op

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "equipment_check_templates",
        sa.Column("content_revision", sa.Integer(), server_default="1", nullable=False),
    )


def downgrade():
    op.drop_column("equipment_check_templates", "content_revision")
