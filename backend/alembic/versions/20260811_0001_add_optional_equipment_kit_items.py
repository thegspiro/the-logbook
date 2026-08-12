"""add optional equipment kit items

Revision ID: 20260811_0001
Revises: 20260810_0008
Create Date: 2026-08-11 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "20260811_0001"
down_revision = "20260810_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "equipment_kit_items",
        sa.Column(
            "optional", sa.Boolean(), nullable=False, server_default=sa.text("0")
        ),
    )


def downgrade() -> None:
    op.drop_column("equipment_kit_items", "optional")
