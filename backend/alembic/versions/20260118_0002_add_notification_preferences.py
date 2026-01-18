"""Add notification preferences to users

Revision ID: 0002
Revises: 0001
Create Date: 2026-01-18

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add notification_preferences column to users table
    op.add_column(
        'users',
        sa.Column(
            'notification_preferences',
            postgresql.JSONB(),
            server_default='{"email": true, "sms": false, "push": false}'
        )
    )


def downgrade() -> None:
    op.drop_column('users', 'notification_preferences')
