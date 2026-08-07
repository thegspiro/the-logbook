"""Record the vendor order against the window

Who the bulk order went to, under what reference, and when. Without it,
"has this been ordered yet?" is answered from memory and the member asking
when their shirt arrives gets a shrug.

Revision ID: 20260802_0007
Revises: 20260802_0006
Create Date: 2026-08-05
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260802_0007"
down_revision = "20260802_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "store_order_windows", sa.Column("vendor_name", sa.String(200), nullable=True)
    )
    op.add_column(
        "store_order_windows",
        sa.Column("vendor_reference", sa.String(120), nullable=True),
    )
    op.add_column(
        "store_order_windows",
        sa.Column("vendor_ordered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "store_order_windows",
        sa.Column(
            "vendor_ordered_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("store_order_windows", "vendor_ordered_by")
    op.drop_column("store_order_windows", "vendor_ordered_at")
    op.drop_column("store_order_windows", "vendor_reference")
    op.drop_column("store_order_windows", "vendor_name")
