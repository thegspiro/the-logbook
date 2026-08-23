"""Record how early a self check-in landed, per event RSVP.

Revision ID: d5e82c0a7f31
Revises: c3b71f0d5a92

An NFC tap or a QR scan can land inside the check-in window but well before
the event itself starts. The tap time stays the honest record of when the
member arrived; this column says how far ahead of the scheduled start it was,
so the event's manager can be shown who tapped in early rather than having to
compare timestamps by eye.

Existing rows are left NULL. Backfilling would mean deciding, for every
historical RSVP, what its event's start time was at the moment somebody tapped
— and an event whose start was edited afterwards would be given a number that
was never true. NULL reads as "not recorded", which is what it is.
"""

import sqlalchemy as sa
from alembic import op

revision = "d5e82c0a7f31"
down_revision = "c3b71f0d5a92"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "event_rsvps",
        sa.Column("early_check_in_minutes", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("event_rsvps", "early_check_in_minutes")
