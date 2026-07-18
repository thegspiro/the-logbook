"""Add training-position fields and shift lifecycle status

Two related scheduling changes:

1. ``shift_assignments`` gains ``is_training`` plus optional
   ``training_program_id`` / ``training_evaluator_id`` so an officer can
   designate a crew seat as a supervised training/rider slot and link it to
   the trainee's program and the evaluating officer. Finalization uses these
   to draft the completion report against the right program/reviewer.
2. ``shifts`` gains a ``status`` lifecycle column (scheduled/cancelled) plus
   ``cancelled_at`` / ``cancelled_by`` / ``cancellation_reason`` so a shift can
   be called off (preserving history and notifying crew) instead of being
   hard-deleted.

Revision ID: 20260720_0001
Revises: 20260719_0001
Create Date: 2026-07-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260720_0001"
down_revision = "20260719_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- shift_assignments: training-position slot -------------------------
    op.add_column(
        "shift_assignments",
        sa.Column(
            "is_training",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "shift_assignments",
        sa.Column("training_program_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "shift_assignments",
        sa.Column("training_evaluator_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_shift_assignment_training_program",
        "shift_assignments",
        "training_programs",
        ["training_program_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_shift_assignment_training_evaluator",
        "shift_assignments",
        "users",
        ["training_evaluator_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # --- shifts: lifecycle status + cancellation ---------------------------
    op.add_column(
        "shifts",
        sa.Column(
            "status",
            sa.Enum("scheduled", "cancelled", name="shiftstatus"),
            nullable=False,
            server_default="scheduled",
        ),
    )
    op.add_column(
        "shifts",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "shifts",
        sa.Column("cancelled_by", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "shifts",
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_shift_cancelled_by",
        "shifts",
        "users",
        ["cancelled_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_shift_cancelled_by", "shifts", type_="foreignkey")
    op.drop_column("shifts", "cancellation_reason")
    op.drop_column("shifts", "cancelled_by")
    op.drop_column("shifts", "cancelled_at")
    op.drop_column("shifts", "status")

    op.drop_constraint(
        "fk_shift_assignment_training_evaluator",
        "shift_assignments",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_shift_assignment_training_program",
        "shift_assignments",
        type_="foreignkey",
    )
    op.drop_column("shift_assignments", "training_evaluator_id")
    op.drop_column("shift_assignments", "training_program_id")
    op.drop_column("shift_assignments", "is_training")
