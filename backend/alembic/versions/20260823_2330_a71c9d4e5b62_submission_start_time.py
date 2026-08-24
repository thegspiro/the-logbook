"""Keep the time of day a self-reported training ran.

Revision ID: a71c9d4e5b62
Revises: d5e82c0a7f31

The submit form asks for a start time and a length and derives the hours from
the pair, but only the date and the hours were stored. Editing a submission
therefore had to invent a start — it assumed 09:00 — and an officer reviewing
a four-hour entry could not tell a morning class from an evening one.

Both columns are nullable and nothing is backfilled. A row written before this
has no start time; guessing one would put a number on the record that was
never reported. NULL reads as "not recorded", which is the truth.
"""

import sqlalchemy as sa
from alembic import op

revision = "a71c9d4e5b62"
down_revision = "d5e82c0a7f31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_submissions", sa.Column("start_time", sa.Time(), nullable=True)
    )
    op.add_column("training_records", sa.Column("start_time", sa.Time(), nullable=True))


def downgrade() -> None:
    op.drop_column("training_records", "start_time")
    op.drop_column("training_submissions", "start_time")
