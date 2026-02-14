"""Add status_changed_at to users and property_return_reminders table

Revision ID: 20260214_0600
Revises: 20260214_0500
Create Date: 2026-02-14

Adds status_changed_at and status_change_reason columns to users table
for tracking when a member was dropped. Adds property_return_reminders
table for tracking which reminder notices have been sent.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_0600'
down_revision = '20260214_0500'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add status tracking columns to users
    op.add_column('users', sa.Column('status_changed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('status_change_reason', sa.Text(), nullable=True))

    # Create property_return_reminders table to track sent reminders
    op.create_table(
        'property_return_reminders',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reminder_type', sa.String(20), nullable=False),  # '30_day' or '90_day'
        sa.Column('items_outstanding', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_value_outstanding', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('sent_to_member', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('sent_to_admin', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_prop_reminder_org_user', 'property_return_reminders', ['organization_id', 'user_id'])
    op.create_index('idx_prop_reminder_type', 'property_return_reminders', ['user_id', 'reminder_type'])


def downgrade() -> None:
    op.drop_index('idx_prop_reminder_type', table_name='property_return_reminders')
    op.drop_index('idx_prop_reminder_org_user', table_name='property_return_reminders')
    op.drop_table('property_return_reminders')
    op.drop_column('users', 'status_change_reason')
    op.drop_column('users', 'status_changed_at')
