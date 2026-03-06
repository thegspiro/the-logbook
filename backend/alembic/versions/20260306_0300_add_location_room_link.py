"""Add facility_room_id to locations table

Revision ID: 20260306_0300
Revises: 20260306_0200
Create Date: 2026-03-06

Allows Location records to reference specific FacilityRoom records,
making rooms available to Events, Storage, and other modules that
use the Location model as a universal "place picker".
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260306_0300"
down_revision = "20260306_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "locations",
        sa.Column(
            "facility_room_id",
            sa.String(36),
            sa.ForeignKey("facility_rooms.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_locations_facility_room_id",
        "locations",
        ["facility_room_id"],
    )
    # Ensure one Location per room
    op.create_unique_constraint(
        "uq_locations_facility_room_id",
        "locations",
        ["facility_room_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_locations_facility_room_id", "locations", type_="unique")
    op.drop_index("ix_locations_facility_room_id", table_name="locations")
    op.drop_column("locations", "facility_room_id")
