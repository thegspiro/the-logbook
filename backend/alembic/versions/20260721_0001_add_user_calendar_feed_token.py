"""Add per-user calendar feed token for ICS subscriptions

Members subscribe to a personal read-only ICS feed of their shifts from
Google/Apple Calendar, which cannot authenticate with cookies. The feed URL
is protected by this unguessable per-user token instead.

Revision ID: 20260721_0001
Revises: 20260720_0001
Create Date: 2026-07-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260721_0001"
down_revision = "20260720_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("calendar_feed_token", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_users_calendar_feed_token",
        "users",
        ["calendar_feed_token"],
    )


def downgrade() -> None:
    op.drop_index("ix_users_calendar_feed_token", table_name="users")
    op.drop_column("users", "calendar_feed_token")
