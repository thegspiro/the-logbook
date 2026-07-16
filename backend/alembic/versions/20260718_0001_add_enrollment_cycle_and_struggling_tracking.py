"""Add cycle_started_at and struggling_alert_sent_at to program enrollments

``cycle_started_at`` anchors pace/behind-schedule heuristics to the current
(recert) cycle rather than the original enrollment, so a member isn't flagged
overdue the instant a fresh cycle begins. ``struggling_alert_sent_at`` throttles
the weekly "falling behind" alert so it isn't re-sent every run.

Revision ID: 20260718_0001
Revises: 20260717_0001
Create Date: 2026-07-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260718_0001"
down_revision = "20260717_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "program_enrollments",
        sa.Column("struggling_alert_sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "program_enrollments",
        sa.Column("cycle_started_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("program_enrollments", "cycle_started_at")
    op.drop_column("program_enrollments", "struggling_alert_sent_at")
