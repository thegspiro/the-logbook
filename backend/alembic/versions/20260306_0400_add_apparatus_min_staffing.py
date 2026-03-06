"""add min_staffing to apparatus table

Revision ID: add_apparatus_min_staffing
Revises: add_location_room_link
Create Date: 2026-03-06 04:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "add_apparatus_min_staffing"
down_revision = "add_location_room_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "apparatus",
        sa.Column(
            "min_staffing",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )


def downgrade() -> None:
    op.drop_column("apparatus", "min_staffing")
