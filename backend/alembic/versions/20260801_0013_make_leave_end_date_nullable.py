"""Make member_leaves_of_absence.end_date nullable (model/schema drift)

The model declares ``end_date = Column(Date, nullable=True)`` with the
documented meaning "None = permanent leave", but the original table
migration (20260220_0300) created the column NOT NULL — so inserting a
permanent leave fails with IntegrityError 1048 on any real database. Align
the schema with the model's contract.

Revision ID: 20260801_0013
Revises: 20260801_0012
Create Date: 2026-08-01 00:13:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260801_0013"
down_revision = "20260801_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "member_leaves_of_absence",
        "end_date",
        existing_type=sa.Date(),
        nullable=True,
    )


def downgrade() -> None:
    # Backfill NULLs before restoring NOT NULL; use the start date as the
    # least-wrong stand-in for an open-ended leave.
    op.execute(
        "UPDATE member_leaves_of_absence SET end_date = start_date "
        "WHERE end_date IS NULL"
    )
    op.alter_column(
        "member_leaves_of_absence",
        "end_date",
        existing_type=sa.Date(),
        nullable=False,
    )
