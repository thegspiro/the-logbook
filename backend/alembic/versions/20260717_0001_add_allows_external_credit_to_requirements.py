"""Add allows_external_credit toggle to training requirements

Adds ``allows_external_credit`` (default false) to ``training_requirements``. When
false, imported/external training records (e.g. Vector Solutions syncs) never
auto-credit the requirement by category — it must be satisfied by an in-house
session, a skills test, or manual sign-off. Officers opt a requirement in when
online/third-party delivery is acceptable.

Revision ID: 20260717_0001
Revises: 20260716_0001
Create Date: 2026-07-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260717_0001"
down_revision = "20260716_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_requirements",
        sa.Column(
            "allows_external_credit",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("training_requirements", "allows_external_credit")
