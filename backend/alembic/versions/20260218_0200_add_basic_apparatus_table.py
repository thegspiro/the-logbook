"""Add basic_apparatus table for lightweight vehicle management

Revision ID: 20260218_0200
Revises: 20260218_0100
Create Date: 2026-02-18

Adds the basic_apparatus table for departments that don't have
the full Apparatus module enabled. Provides lightweight vehicle/unit
definitions with crew positions for shift scheduling.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260218_0200'
down_revision = '20260218_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'basic_apparatus',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('unit_number', sa.String(20), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('apparatus_type', sa.String(50), nullable=False, server_default='engine'),
        sa.Column('min_staffing', sa.Integer(), server_default='1'),
        sa.Column('positions', sa.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_basic_apparatus_org', 'basic_apparatus', ['organization_id'])


def downgrade() -> None:
    op.drop_index('idx_basic_apparatus_org', table_name='basic_apparatus')
    op.drop_table('basic_apparatus')
