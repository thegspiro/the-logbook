"""Add rollback history to elections

Revision ID: 20260119_0009
Revises: 20260119_0008
Create Date: 2026-01-19 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260119_0009'
down_revision = '20260119_0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add rollback_history column
    op.add_column('elections', sa.Column('rollback_history', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    # Remove column
    op.drop_column('elections', 'rollback_history')
