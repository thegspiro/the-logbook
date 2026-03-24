"""Add category_id and external provider fields to training_records

Enables tracking which recertification category (e.g., Virginia NCCR area)
each training record counts toward, and links externally imported records
back to their source provider.

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-03-24 01:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "b7c8d9e0f1a2"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_records",
        sa.Column(
            "category_id",
            sa.String(36),
            sa.ForeignKey(
                "training_categories.id", ondelete="SET NULL", name="fk_record_category"
            ),
            nullable=True,
        ),
    )
    op.create_index("idx_record_category", "training_records", ["category_id"])

    op.add_column(
        "training_records",
        sa.Column(
            "external_provider_id",
            sa.String(36),
            sa.ForeignKey(
                "external_training_providers.id",
                ondelete="SET NULL",
                name="fk_record_ext_provider",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "training_records",
        sa.Column("external_record_id", sa.String(255), nullable=True),
    )
    op.create_index(
        "idx_record_external",
        "training_records",
        ["external_provider_id", "external_record_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_record_external", table_name="training_records")
    op.drop_column("training_records", "external_record_id")
    op.drop_column("training_records", "external_provider_id")
    op.drop_index("idx_record_category", table_name="training_records")
    op.drop_column("training_records", "category_id")
