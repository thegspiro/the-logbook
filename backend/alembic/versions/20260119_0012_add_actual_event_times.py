"""add actual event times

Revision ID: 20260119_0012
Revises: 20260119_0011
Create Date: 2026-01-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260119_0012'
down_revision = '20260119_0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add actual_start_time and actual_end_time columns to events table
    op.add_column('events', sa.Column('actual_start_time', sa.DateTime(), nullable=True))
    op.add_column('events', sa.Column('actual_end_time', sa.DateTime(), nullable=True))


def downgrade() -> None:
    # Remove actual_start_time and actual_end_time columns from events table
    op.drop_column('events', 'actual_end_time')
    op.drop_column('events', 'actual_start_time')
