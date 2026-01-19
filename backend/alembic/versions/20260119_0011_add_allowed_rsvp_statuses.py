"""add allowed rsvp statuses

Revision ID: 20260119_0011
Revises: 20260119_0010
Create Date: 2026-01-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260119_0011'
down_revision = '20260119_0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add allowed_rsvp_statuses column to events table
    op.add_column('events', sa.Column('allowed_rsvp_statuses', postgresql.JSONB(astext_type=sa.Text()), nullable=True))

    # Set default value for existing events to ["going", "not_going"]
    op.execute("""
        UPDATE events
        SET allowed_rsvp_statuses = '["going", "not_going"]'::jsonb
        WHERE allowed_rsvp_statuses IS NULL AND requires_rsvp = true
    """)


def downgrade() -> None:
    # Remove allowed_rsvp_statuses column from events table
    op.drop_column('events', 'allowed_rsvp_statuses')
