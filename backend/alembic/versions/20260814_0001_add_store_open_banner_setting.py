"""Add storefront open-order banner setting.

Revision ID: 20260814_0001
Revises: 20260813_0011
"""

import sqlalchemy as sa
from alembic import op

revision = "20260814_0001"
down_revision = "20260813_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "store_settings",
        sa.Column(
            "show_open_order_banner",
            sa.Boolean(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade() -> None:
    op.drop_column("store_settings", "show_open_order_banner")
