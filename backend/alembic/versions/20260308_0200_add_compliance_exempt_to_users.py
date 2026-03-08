"""add compliance_exempt column to users

Revision ID: 20260308_0200
Revises: 20260308_0100
Create Date: 2026-03-08 02:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260308_0200"
down_revision = "20260308_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "compliance_exempt",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "compliance_exempt")
