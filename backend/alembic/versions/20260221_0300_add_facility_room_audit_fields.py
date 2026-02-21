"""Add created_by and updated_by to facility_rooms

Adds audit tracking fields so room creation and modification can be
attributed to specific users, consistent with other facility entities.

Revision ID: 20260221_0300
Revises: 20260221_0200
Create Date: 2026-02-21
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "20260221_0300"
down_revision = "20260221_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("facility_rooms", sa.Column("created_by", sa.String(36), nullable=True))
    op.add_column("facility_rooms", sa.Column("updated_by", sa.String(36), nullable=True))


def downgrade() -> None:
    op.drop_column("facility_rooms", "updated_by")
    op.drop_column("facility_rooms", "created_by")
