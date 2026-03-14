"""Add report_stage_groups column to membership_pipelines

Revision ID: 9a4b5c6d7e8f
Revises: 8f3a2c4d5e6b
Create Date: 2026-03-14 01:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "9a4b5c6d7e8f"
down_revision = "8f3a2c4d5e6b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "membership_pipelines",
        sa.Column("report_stage_groups", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("membership_pipelines", "report_stage_groups")
