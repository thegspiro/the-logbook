"""add meeting minutes tables

Revision ID: add_meeting_minutes
Revises:
Create Date: 2026-02-12 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_meeting_minutes'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Meeting Minutes table
    op.create_table(
        'meeting_minutes',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('meeting_type', sa.Enum('business', 'special', 'committee', 'board', 'other', name='meetingtype'), nullable=False, server_default='business'),
        sa.Column('meeting_date', sa.DateTime(), nullable=False),
        sa.Column('location', sa.String(300), nullable=True),
        sa.Column('called_by', sa.String(200), nullable=True),
        sa.Column('called_to_order_at', sa.DateTime(), nullable=True),
        sa.Column('adjourned_at', sa.DateTime(), nullable=True),
        sa.Column('attendees', sa.JSON(), nullable=True),
        sa.Column('quorum_met', sa.Boolean(), nullable=True),
        sa.Column('quorum_count', sa.Integer(), nullable=True),
        sa.Column('agenda', sa.Text(), nullable=True),
        sa.Column('old_business', sa.Text(), nullable=True),
        sa.Column('new_business', sa.Text(), nullable=True),
        sa.Column('treasurer_report', sa.Text(), nullable=True),
        sa.Column('chief_report', sa.Text(), nullable=True),
        sa.Column('committee_reports', sa.Text(), nullable=True),
        sa.Column('announcements', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', sa.Enum('draft', 'submitted', 'approved', 'rejected', name='minutesstatus'), nullable=False, server_default='draft'),
        sa.Column('submitted_at', sa.DateTime(), nullable=True),
        sa.Column('submitted_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('approved_at', sa.DateTime(), nullable=True),
        sa.Column('approved_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('rejected_at', sa.DateTime(), nullable=True),
        sa.Column('rejected_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('rejection_reason', sa.Text(), nullable=True),
        sa.Column('event_id', sa.String(36), sa.ForeignKey('events.id'), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    op.create_index('ix_meeting_minutes_organization_id', 'meeting_minutes', ['organization_id'])
    op.create_index('ix_meeting_minutes_meeting_date', 'meeting_minutes', ['meeting_date'])
    op.create_index('ix_meeting_minutes_status', 'meeting_minutes', ['status'])
    op.create_index('ix_meeting_minutes_meeting_type', 'meeting_minutes', ['meeting_type'])

    # Motions table
    op.create_table(
        'meeting_motions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('minutes_id', sa.String(36), sa.ForeignKey('meeting_minutes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('motion_text', sa.Text(), nullable=False),
        sa.Column('moved_by', sa.String(200), nullable=True),
        sa.Column('seconded_by', sa.String(200), nullable=True),
        sa.Column('discussion_notes', sa.Text(), nullable=True),
        sa.Column('status', sa.Enum('passed', 'failed', 'tabled', 'withdrawn', name='motionstatus'), nullable=False, server_default='passed'),
        sa.Column('votes_for', sa.Integer(), nullable=True),
        sa.Column('votes_against', sa.Integer(), nullable=True),
        sa.Column('votes_abstain', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    op.create_index('ix_meeting_motions_minutes_id', 'meeting_motions', ['minutes_id'])

    # Action Items table
    op.create_table(
        'meeting_action_items',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('minutes_id', sa.String(36), sa.ForeignKey('meeting_minutes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('assignee_id', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('assignee_name', sa.String(200), nullable=True),
        sa.Column('due_date', sa.DateTime(), nullable=True),
        sa.Column('priority', sa.Enum('low', 'medium', 'high', 'urgent', name='actionitempriority'), nullable=False, server_default='medium'),
        sa.Column('status', sa.Enum('pending', 'in_progress', 'completed', 'cancelled', 'overdue', name='actionitemstatus'), nullable=False, server_default='pending'),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('completion_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    op.create_index('ix_meeting_action_items_minutes_id', 'meeting_action_items', ['minutes_id'])
    op.create_index('ix_meeting_action_items_assignee_id', 'meeting_action_items', ['assignee_id'])
    op.create_index('ix_meeting_action_items_status', 'meeting_action_items', ['status'])
    op.create_index('ix_meeting_action_items_due_date', 'meeting_action_items', ['due_date'])


def downgrade() -> None:
    op.drop_table('meeting_action_items')
    op.drop_table('meeting_motions')
    op.drop_table('meeting_minutes')
