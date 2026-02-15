"""Add membership_type and membership_type_changed_at to users table

Revision ID: 20260214_0900
Revises: 20260214_0800
Create Date: 2026-02-14

Adds membership tier tracking columns to the users table.
Tier definitions and benefits are stored in the organization JSON
settings column (membership_tiers) and require no migration.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_0900'
down_revision = '20260214_0800'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('membership_type', sa.String(50), nullable=True, server_default='active'))
    op.add_column('users', sa.Column('membership_type_changed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'membership_type_changed_at')
    op.drop_column('users', 'membership_type')
