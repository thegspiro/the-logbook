"""add include_current_month override to training_requirements

Per-requirement override for the compliance evaluation period. NULL means
inherit the organization-wide ``compliance_configs.include_current_month``
setting; True/False override it for this requirement.

Revision ID: 20260503_0002
Revises: 20260503_0001
Create Date: 2026-05-29 00:10:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260503_0002"
down_revision = "20260503_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_requirements",
        sa.Column(
            "include_current_month",
            sa.Boolean(),
            nullable=True,
            comment=(
                "Per-requirement evaluation-period override. NULL = inherit the "
                "org compliance setting; True = count current month; False = "
                "stop at end of previous month."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("training_requirements", "include_current_month")
