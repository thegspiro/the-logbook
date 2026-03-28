"""Add unique constraint on shift_id+trainee_id for reports

Prevents duplicate shift completion reports for the same trainee on
the same shift, which could occur from finalization retries or
concurrent officer submissions.

Revision ID: 20260328_0300
Revises: 20260328_0200
Create Date: 2026-03-28
"""

from alembic import op


revision = "20260328_0300"
down_revision = "20260328_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_shift_report_shift_trainee",
        "shift_completion_reports",
        ["shift_id", "trainee_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_shift_report_shift_trainee",
        "shift_completion_reports",
        type_="unique",
    )
