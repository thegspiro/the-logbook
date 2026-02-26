"""Add unique constraint on shift_assignments (shift_id, user_id)

Revision ID: 20260226_0200
Revises: 20260226_0100
Create Date: 2026-02-26

Prevents duplicate assignment of the same member to the same shift at the
database level, guarding against race conditions in concurrent requests.
"""

from alembic import op


# revision identifiers
revision = "20260226_0200"
down_revision = "20260226_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_shift_assignment_shift_user",
        "shift_assignments",
        ["shift_id", "user_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_shift_assignment_shift_user", "shift_assignments", type_="unique")
