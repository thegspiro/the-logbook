"""Add retry-safe equipment-check bulk delete ledger.

Revision ID: d4e8f1a2b3c4
Revises: 5128feb36dd2
"""

import sqlalchemy as sa
from alembic import op

revision = "d4e8f1a2b3c4"
down_revision = "5128feb36dd2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "equipment_check_bulk_delete_requests",
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
        "uq_equipment_check_bulk_delete_request",
        "equipment_check_bulk_delete_requests",
        ["organization_id", "compartment_id", "idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_equipment_check_bulk_delete_request",
        table_name="equipment_check_bulk_delete_requests",
    )
    op.drop_table("equipment_check_bulk_delete_requests")
