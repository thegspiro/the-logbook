"""add include_current_month to compliance_configs

Lets a department choose whether compliance calculations count the
in-progress current month or stop at the end of the previous month.
Defaults to True (existing behaviour: current month is included).

Revision ID: 20260503_0001
Revises: 20260502_0004
Create Date: 2026-05-29 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260503_0001"
down_revision = "20260502_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "compliance_configs",
        sa.Column(
            "include_current_month",
            sa.Boolean(),
            nullable=False,
            server_default="1",
            comment=(
                "When false, compliance calculations evaluate as of the last "
                "day of the previous month so the in-progress month does not "
                "yet count against members."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("compliance_configs", "include_current_month")
