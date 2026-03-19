"""Add event_id column to elections table

Allow elections to link to calendar events (e.g. business meeting events)
in addition to formal meeting records.

Revision ID: 20260319_0100
Revises: merge_all_heads_0317
Create Date: 2026-03-19 01:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260319_0100"
down_revision = "merge_all_heads_0317"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "elections",
        sa.Column("event_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_elections_event_id",
        "elections",
        "events",
        ["event_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_elections_event_id", "elections", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_elections_event_id", table_name="elections")
    op.drop_constraint("fk_elections_event_id", "elections", type_="foreignkey")
    op.drop_column("elections", "event_id")
