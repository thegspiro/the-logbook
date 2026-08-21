"""Add shifts.closeout_step for resumable shift close-out

Revision ID: 2827079fd66c
Revises: 82bdcb3b1e64
Create Date: 2026-08-19

The close-out wizard writes real records as it advances (attendance times on
step 1, call rows on step 2), so this column carries no entered data — only
where to resume if the officer's phone locks mid-flow.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "2827079fd66c"
down_revision = "82bdcb3b1e64"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("shifts")}
    if "closeout_step" not in cols:
        op.add_column("shifts", sa.Column("closeout_step", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("shifts")}
    if "closeout_step" in cols:
        op.drop_column("shifts", "closeout_step")
