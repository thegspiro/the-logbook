"""Add equipment-check bulk request idempotency ledger.

Revision ID: 8a4f2d1c9b30
Revises: 4c8d7e2a91b3
"""

import sqlalchemy as sa
from alembic import op

revision = "8a4f2d1c9b30"
down_revision = "4c8d7e2a91b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "equipment_check_bulk_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("compartment_id", sa.String(36), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("item_ids", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["compartment_id"], ["check_template_compartments.id"], ondelete="CASCADE"
        ),
    )
    op.create_index(
        "uq_equipment_check_bulk_request",
        "equipment_check_bulk_requests",
        ["organization_id", "compartment_id", "idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_equipment_check_bulk_request", table_name="equipment_check_bulk_requests"
    )
    op.drop_table("equipment_check_bulk_requests")
