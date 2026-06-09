"""Merge migration heads and add shift_assignments composite index

Two migration branches both descended from 20260502_0004 left the graph
with two heads (20260528_0002 and 20260503_0002), which makes
``alembic upgrade head`` ambiguous. This revision merges them.

It also adds a composite index on shift_assignments (shift_id,
assignment_status). Active-assignment scans — open-shifts staffing checks,
attendee counts, and the compliance report — all filter on these two
columns together, so the existing shift_id-only index forces a status
filter on every matching row.

Revision ID: 20260604_0001
Revises: 20260528_0002, 20260503_0002
Create Date: 2026-06-04
"""

from alembic import op


revision = "20260604_0001"
down_revision = ("20260528_0002", "20260503_0002")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_shift_assign_shift_status",
        "shift_assignments",
        ["shift_id", "assignment_status"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_shift_assign_shift_status",
        table_name="shift_assignments",
    )
