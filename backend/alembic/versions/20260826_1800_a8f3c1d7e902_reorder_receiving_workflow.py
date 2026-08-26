"""reorder receiving workflow and receipt history

Revision ID: a8f3c1d7e902
Revises: 472a1e34aa84
"""

import sqlalchemy as sa
from alembic import op

revision = "a8f3c1d7e902"
down_revision = "472a1e34aa84"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "ALTER TYPE reorderstatus ADD VALUE IF NOT EXISTS 'partially_received' BEFORE 'received'"
        )
    elif bind.dialect.name == "mysql":
        op.execute(
            "ALTER TABLE reorder_requests MODIFY status ENUM('pending','approved','ordered','partially_received','received','cancelled') NOT NULL DEFAULT 'pending'"
        )
    else:
        # SQLite stores this enum as text; MySQL deployments use VARCHAR for portable enums.
        pass
    op.add_column(
        "organizations",
        sa.Column(
            "reorder_vendor_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "organizations",
        sa.Column(
            "reorder_po_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "reorder_requests",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.execute(
        "UPDATE reorder_requests SET quantity_received = 0 WHERE quantity_received IS NULL"
    )
    with op.batch_alter_table("reorder_requests") as batch:
        batch.alter_column(
            "quantity_received",
            nullable=False,
            server_default="0",
            existing_type=sa.Integer(),
        )
    op.add_column("inventory_lots", sa.Column("storage_location", sa.String(255)))
    op.add_column("inventory_lots", sa.Column("unit_cost", sa.Numeric(10, 2)))
    op.create_table(
        "reorder_receipts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reorder_request_id",
            sa.String(36),
            sa.ForeignKey("reorder_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "inventory_lot_id",
            sa.String(36),
            sa.ForeignKey("inventory_lots.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_cost", sa.Numeric(10, 2)),
        sa.Column("storage_location", sa.String(255)),
        sa.Column(
            "received_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "reorder_request_id", "idempotency_key", name="uq_reorder_receipt_key"
        ),
    )
    op.create_index(
        "ix_reorder_receipts_request", "reorder_receipts", ["reorder_request_id"]
    )


def downgrade():
    op.drop_table("reorder_receipts")
    op.drop_column("inventory_lots", "unit_cost")
    op.drop_column("inventory_lots", "storage_location")
    op.drop_column("reorder_requests", "version")
    op.drop_column("organizations", "reorder_po_required")
    op.drop_column("organizations", "reorder_vendor_required")
