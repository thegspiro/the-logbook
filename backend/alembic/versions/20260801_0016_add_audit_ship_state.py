"""Add audit_ship_state table for off-host audit-log shipping

Single-row high-water mark tracking the last audit row delivered to the
external collector configured via AUDIT_SHIP_WEBHOOK_URL. The watermark
only advances on acknowledged deliveries, so failures are retried.

Revision ID: 20260801_0016
Revises: 20260801_0015
Create Date: 2026-08-01 00:11:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260801_0016"
down_revision = "20260801_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_ship_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "last_shipped_id", sa.BigInteger(), nullable=False, server_default="0"
        ),
        sa.Column("last_shipped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


def downgrade() -> None:
    op.drop_table("audit_ship_state")
