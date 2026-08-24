"""Add network label printer configuration.

Backs direct ZPL printing: an organization registers each physical label
printer once (host, port, resolution, loaded label stock) instead of the host
being typed at every print.

Revision ID: b3e7f1a92c40
Revises: a17c4e9d2b61
"""

import sqlalchemy as sa
from alembic import op

revision = "b3e7f1a92c40"
down_revision = "a17c4e9d2b61"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "label_printers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="9100"),
        sa.Column("dpi", sa.Integer(), nullable=False, server_default="203"),
        sa.Column(
            "label_format",
            sa.String(50),
            nullable=False,
            server_default="zebra_2x1",
        ),
        sa.Column("custom_width", sa.Float(), nullable=True),
        sa.Column("custom_height", sa.Float(), nullable=True),
        sa.Column("darkness", sa.Integer(), nullable=True),
        sa.Column(
            "is_default", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        # SET NULL requires a nullable column (MySQL 1830) — a printer outlives
        # the member who registered it.
        sa.Column("created_by_id", sa.String(36), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_label_printers_organization_id", "label_printers", ["organization_id"]
    )
    op.create_index(
        "uq_label_printer_org_name",
        "label_printers",
        ["organization_id", "name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_label_printer_org_name", table_name="label_printers")
    op.drop_index("ix_label_printers_organization_id", table_name="label_printers")
    op.drop_table("label_printers")
