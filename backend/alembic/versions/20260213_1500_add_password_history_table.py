"""Add password history table for HIPAA compliance

Revision ID: 20260213_1500
Revises: a7f3e2d91b04
Create Date: 2026-02-13

Adds password_history table to track previous password hashes
per user, enforcing HIPAA §164.312(d) password reuse prevention.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = '20260213_1500'
down_revision = 'a7f3e2d91b04'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'password_history',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_password_history_user_id', 'password_history', ['user_id'])
    op.create_index('idx_password_history_user_created', 'password_history', ['user_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('idx_password_history_user_created', 'password_history')
    op.drop_index('ix_password_history_user_id', 'password_history')
    op.drop_table('password_history')
