"""drop unused approval_required from training_sessions

The ``approval_required`` flag was never read anywhere in the codebase —
``finalize_training_session`` always creates a TrainingApproval regardless
of its value, so the column had no effect. Remove it; instructor
confirmation is governed by ``require_completion_confirmation``.

Revision ID: 20260502_0004
Revises: 20260502_0003
Create Date: 2026-05-25 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260502_0004"
down_revision = "20260502_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("training_sessions", "approval_required")


def downgrade() -> None:
    op.add_column(
        "training_sessions",
        sa.Column(
            "approval_required",
            sa.Boolean(),
            nullable=True,
            server_default="1",
        ),
    )
