"""add registry_code to training_categories

Revision ID: 20260411_0200
Revises: 20260411_0100
Create Date: 2026-04-11

Links training categories to national/state standard identifiers
(NCCR topic areas, NFPA standards) so compliance checks can verify
per-category hour minimums for NREMT recertification and state
requirements.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = "20260411_0200"
down_revision = "20260411_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_categories",
        sa.Column("registry_code", sa.String(100), nullable=True),
    )
    op.create_index(
        "idx_category_registry_code",
        "training_categories",
        ["organization_id", "registry_code"],
    )


def downgrade() -> None:
    op.drop_index("idx_category_registry_code", table_name="training_categories")
    op.drop_column("training_categories", "registry_code")
