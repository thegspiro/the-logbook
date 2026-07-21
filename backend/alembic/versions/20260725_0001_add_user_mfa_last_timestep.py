"""Add user MFA last-used TOTP time-step for replay prevention

Stores the highest TOTP time-step already accepted at login so a code cannot be
reused within its ±30s validity window (replay / real-time-phishing defense).

Revision ID: 20260725_0001
Revises: 20260724_0001
Create Date: 2026-07-21 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260725_0001"
down_revision = "20260724_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("mfa_last_timestep", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "mfa_last_timestep")
