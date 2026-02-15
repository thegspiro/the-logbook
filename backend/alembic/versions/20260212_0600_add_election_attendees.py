"""add election attendees column for meeting attendance tracking

Revision ID: 20260212_0600
Revises: 20260212_0500
Create Date: 2026-02-12 16:00:00.000000

Adds attendees JSON column to elections table to track
which members are present at meetings for ballot eligibility.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260212_0600'
down_revision = '20260212_0500'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add attendees JSON column for meeting attendance tracking
    # Format: [{"user_id": "abc-123", "name": "John Doe",
    #           "checked_in_at": "2026-02-10T09:00:00", "checked_in_by": "user-456"}]
    op.add_column('elections', sa.Column('attendees', sa.JSON, nullable=True))

    print("✅ Added attendees column to elections table")


def downgrade() -> None:
    op.drop_column('elections', 'attendees')

    print("⚠️  Removed attendees column from elections table")
