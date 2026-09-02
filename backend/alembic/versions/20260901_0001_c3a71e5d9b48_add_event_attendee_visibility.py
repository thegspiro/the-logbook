"""add event attendee visibility

Adds the per-event override that decides whether ordinary members (holders of
``events.view``) may see an event's going-only attendee list, or whether the
roster stays restricted to ``events.manage`` as it always has been.

NULL means "inherit the organization's ``events.defaults.attendee_visibility``
setting". That is a real third state rather than a missing value, so no
backfill is performed: every existing row inherits, the shipped org default is
``managers``, and behavior is therefore unchanged on upgrade.

Revision ID: c3a71e5d9b48
Revises: 4e7e125cb00f
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3a71e5d9b48"
down_revision: Union[str, None] = "4e7e125cb00f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Stored as a String, not a SQL ENUM: MySQL stores an ENUM as the member's
    # ordinal, so adding a visibility level later would reassign the type of
    # every row already written.
    op.add_column(
        "events",
        sa.Column("attendee_visibility", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "event_templates",
        sa.Column("attendee_visibility", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("event_templates", "attendee_visibility")
    op.drop_column("events", "attendee_visibility")
