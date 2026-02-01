"""Add ballot item eligibility and email notifications

Revision ID: 20260118_0005
Revises: 20260118_0004
Create Date: 2026-01-18 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260118_0005'
down_revision = '20260118_0004'
branch_labels = None
depends_on = None


def upgrade():
    # Add ballot_items JSON column for structured ballot items with eligibility
    op.add_column('elections', sa.Column('ballot_items', sa.JSON(), nullable=True))

    # Add position_eligibility JSON column for per-position voter eligibility rules
    op.add_column('elections', sa.Column('position_eligibility', sa.JSON(), nullable=True))

    # Add email notification tracking fields
    op.add_column('elections', sa.Column('email_sent', sa.Boolean, nullable=False, server_default='0'))
    op.add_column('elections', sa.Column('email_sent_at', sa.DateTime, nullable=True))
    op.add_column('elections', sa.Column('email_recipients', sa.JSON(), nullable=True))
    op.add_column('elections', sa.Column('meeting_date', sa.DateTime, nullable=True))


def downgrade():
    op.drop_column('elections', 'meeting_date')
    op.drop_column('elections', 'email_recipients')
    op.drop_column('elections', 'email_sent_at')
    op.drop_column('elections', 'email_sent')
    op.drop_column('elections', 'position_eligibility')
    op.drop_column('elections', 'ballot_items')
