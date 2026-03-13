"""Rename meeting_action_items to minutes_action_items

Revision ID: 20260312_0200
Revises: 20260312_0100
Create Date: 2026-03-12

The ActionItem model uses __tablename__ = "minutes_action_items" but the
original migration (20260212_1200) created the table as "meeting_action_items".
This migration renames the table and its indexes to match the model.
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = '20260312_0200'
down_revision = '20260312_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rename the table to match the SQLAlchemy model
    op.rename_table('meeting_action_items', 'minutes_action_items')

    # Recreate indexes with the correct table-prefixed names
    # Drop old indexes (silently skip if they don't exist)
    try:
        op.drop_index('ix_meeting_action_items_minutes_id', table_name='minutes_action_items')
    except Exception:
        pass
    try:
        op.drop_index('ix_meeting_action_items_assignee_id', table_name='minutes_action_items')
    except Exception:
        pass
    try:
        op.drop_index('ix_meeting_action_items_status', table_name='minutes_action_items')
    except Exception:
        pass
    try:
        op.drop_index('ix_meeting_action_items_due_date', table_name='minutes_action_items')
    except Exception:
        pass

    # Create new indexes with the correct names
    op.create_index('ix_minutes_action_items_minutes_id', 'minutes_action_items', ['minutes_id'])
    op.create_index('ix_minutes_action_items_assignee_id', 'minutes_action_items', ['assignee_id'])
    op.create_index('ix_minutes_action_items_status', 'minutes_action_items', ['status'])
    op.create_index('ix_minutes_action_items_due_date', 'minutes_action_items', ['due_date'])


def downgrade() -> None:
    # Drop new indexes
    op.drop_index('ix_minutes_action_items_due_date', table_name='minutes_action_items')
    op.drop_index('ix_minutes_action_items_status', table_name='minutes_action_items')
    op.drop_index('ix_minutes_action_items_assignee_id', table_name='minutes_action_items')
    op.drop_index('ix_minutes_action_items_minutes_id', table_name='minutes_action_items')

    # Rename back
    op.rename_table('minutes_action_items', 'meeting_action_items')

    # Recreate original indexes
    op.create_index('ix_meeting_action_items_minutes_id', 'meeting_action_items', ['minutes_id'])
    op.create_index('ix_meeting_action_items_assignee_id', 'meeting_action_items', ['assignee_id'])
    op.create_index('ix_meeting_action_items_status', 'meeting_action_items', ['status'])
    op.create_index('ix_meeting_action_items_due_date', 'meeting_action_items', ['due_date'])
