"""Store election-wide settings in saved ballot templates.

Revision ID: 20260814_0001
Revises: 20260813_0011
"""

import sqlalchemy as sa
from alembic import op

revision = "20260814_0001"
down_revision = "20260813_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "saved_ballot_templates",
        sa.Column(
            "voting_method",
            sa.String(50),
            nullable=False,
            server_default="simple_majority",
        ),
    )
    op.add_column(
        "saved_ballot_templates",
        sa.Column(
            "allow_write_ins", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column("saved_ballot_templates", "allow_write_ins")
    op.drop_column("saved_ballot_templates", "voting_method")
