"""Add rank/station to training records and LOA-waiver link fields

Adds:
- training_records.rank_at_completion (VARCHAR 100)
- training_records.station_at_completion (VARCHAR 100)
- member_leaves_of_absence.exempt_from_training_waiver (BOOLEAN)
- member_leaves_of_absence.linked_training_waiver_id (VARCHAR 36)

Revision ID: 20260223_0100
Revises: 20260222_1000
Create Date: 2026-02-23 01:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "20260223_0100"
down_revision = "20260222_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add rank/station snapshot columns to training_records
    op.add_column(
        "training_records",
        sa.Column("rank_at_completion", sa.String(100), nullable=True),
    )
    op.add_column(
        "training_records",
        sa.Column("station_at_completion", sa.String(100), nullable=True),
    )

    # Add LOA ↔ training waiver link columns
    op.add_column(
        "member_leaves_of_absence",
        sa.Column(
            "exempt_from_training_waiver",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "member_leaves_of_absence",
        sa.Column("linked_training_waiver_id", sa.String(36), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("member_leaves_of_absence", "linked_training_waiver_id")
    op.drop_column("member_leaves_of_absence", "exempt_from_training_waiver")
    op.drop_column("training_records", "station_at_completion")
    op.drop_column("training_records", "rank_at_completion")
