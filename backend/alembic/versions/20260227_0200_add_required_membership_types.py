"""Add required_membership_types column to training_requirements

Revision ID: 20260227_0200
Revises: 20260227_0100
Create Date: 2026-02-27

Adds a JSON column to store which membership types (e.g. active,
administrative, probationary) a training requirement applies to.
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260227_0200"
down_revision = "20260227_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_requirements",
        sa.Column("required_membership_types", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("training_requirements", "required_membership_types")
