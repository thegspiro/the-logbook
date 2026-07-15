"""Add certification-eligibility toggle to training sessions

Adds ``counts_toward_certification`` (default true) to ``training_sessions``. When
false, attendance still creates a training record — the member keeps credit toward
general training compliance — but the session no longer feeds the linked
pipeline/certificate requirements, so hours a certifying body (NFPA/NREMT) wouldn't
accept don't inflate a member's certificate progress.

Revision ID: 20260716_0001
Revises: 20260715_0001
Create Date: 2026-07-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260716_0001"
down_revision = "20260715_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_sessions",
        sa.Column(
            "counts_toward_certification",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("training_sessions", "counts_toward_certification")
