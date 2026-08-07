"""Add storefront item personalization and uploaded product photos

Personalization (an embroidered name, an engraved callsign) is per-line free
text with an optional per-unit upcharge. Uploaded photos live in their own
table so listing the catalog never drags image bytes through the ORM.

Revision ID: 20260802_0003
Revises: 20260802_0002
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

# revision identifiers
revision = "20260802_0003"
down_revision = "20260802_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "store_products",
        sa.Column(
            "personalization_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "store_products",
        sa.Column(
            "personalization_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "store_products",
        sa.Column("personalization_label", sa.String(120), nullable=True),
    )
    op.add_column(
        "store_products",
        sa.Column(
            "personalization_max_length",
            sa.Integer(),
            nullable=False,
            server_default="30",
        ),
    )
    op.add_column(
        "store_products",
        sa.Column(
            "personalization_price",
            sa.Numeric(10, 2),
            nullable=False,
            server_default="0",
        ),
    )

    op.add_column(
        "store_order_items",
        sa.Column("personalization_text", sa.String(200), nullable=True),
    )

    op.create_table(
        "store_product_images",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "product_id",
            sa.String(36),
            sa.ForeignKey("store_products.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column(
            "content_type",
            sa.String(100),
            nullable=False,
            server_default="image/webp",
        ),
        # MEDIUMBLOB (16MB) rather than the 64KB default BLOB: an optimized
        # WebP product photo runs a few hundred KB, well past TINY/BLOB.
        sa.Column("data", mysql.MEDIUMBLOB(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "uploaded_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
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
    op.drop_table("store_product_images")
    op.drop_column("store_order_items", "personalization_text")
    op.drop_column("store_products", "personalization_price")
    op.drop_column("store_products", "personalization_max_length")
    op.drop_column("store_products", "personalization_label")
    op.drop_column("store_products", "personalization_required")
    op.drop_column("store_products", "personalization_enabled")
