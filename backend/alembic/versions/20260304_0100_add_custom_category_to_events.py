"""Add custom_category column to events table

Revision ID: 20260304_0100
Revises: 20260303_0300
Create Date: 2026-03-04

Adds:
- custom_category nullable varchar(100) column to events table
- Index on custom_category for filtering
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260304_0100"
down_revision = "20260303_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("custom_category", sa.String(100), nullable=True))
    op.create_index("ix_events_custom_category", "events", ["custom_category"])


def downgrade() -> None:
    op.drop_index("ix_events_custom_category", table_name="events")
    op.drop_column("events", "custom_category")
