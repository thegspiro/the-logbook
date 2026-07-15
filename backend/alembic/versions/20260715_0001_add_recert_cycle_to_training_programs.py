"""Add recertification-cycle auto-reset to training programs

Adds a recurring recert cycle to ``training_programs`` (enabled flag, interval in
months, and an optional fixed calendar anchor month/day) plus per-enrollment
tracking on ``program_enrollments`` (the next scheduled reset date and the last
reset timestamp). When a member's ``next_recert_reset_at`` passes, their pipeline
progress is cleared for a fresh certification cycle — e.g. NREMT's biennial
recert due each March 30.

Revision ID: 20260715_0001
Revises: 20260714_0001
Create Date: 2026-07-15 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260715_0001"
down_revision = "20260714_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_programs",
        sa.Column(
            "recert_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "training_programs",
        sa.Column("recert_interval_months", sa.Integer(), nullable=True),
    )
    op.add_column(
        "training_programs",
        sa.Column("recert_anchor_month", sa.Integer(), nullable=True),
    )
    op.add_column(
        "training_programs",
        sa.Column("recert_anchor_day", sa.Integer(), nullable=True),
    )

    op.add_column(
        "program_enrollments",
        sa.Column("next_recert_reset_at", sa.Date(), nullable=True),
    )
    op.add_column(
        "program_enrollments",
        sa.Column("last_recert_reset_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_enrollment_recert_reset",
        "program_enrollments",
        ["next_recert_reset_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_enrollment_recert_reset", table_name="program_enrollments")
    op.drop_column("program_enrollments", "last_recert_reset_at")
    op.drop_column("program_enrollments", "next_recert_reset_at")
    op.drop_column("training_programs", "recert_anchor_day")
    op.drop_column("training_programs", "recert_anchor_month")
    op.drop_column("training_programs", "recert_interval_months")
    op.drop_column("training_programs", "recert_enabled")
