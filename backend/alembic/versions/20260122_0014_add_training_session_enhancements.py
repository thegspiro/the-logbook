"""add training session enhancements

Revision ID: 20260122_0014
Revises: 20260120_0013b
Create Date: 2026-01-22 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260122_0014'
down_revision = '20260120_0013b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add check-in window fields to events table
    op.add_column('events', sa.Column('check_in_window_type', sa.Enum('flexible', 'strict', 'window', name='checkinwindowtype'), nullable=False, server_default='flexible'))
    op.add_column('events', sa.Column('check_in_minutes_before', sa.Integer(), nullable=True, server_default='15'))
    op.add_column('events', sa.Column('check_in_minutes_after', sa.Integer(), nullable=True, server_default='15'))
    op.add_column('events', sa.Column('require_checkout', sa.Boolean(), nullable=False, server_default='0'))

    # Add check-out and duration tracking to event_rsvps table
    op.add_column('event_rsvps', sa.Column('checked_out_at', sa.DateTime(), nullable=True))
    op.add_column('event_rsvps', sa.Column('attendance_duration_minutes', sa.Integer(), nullable=True))

    # Add override fields to event_rsvps table
    op.add_column('event_rsvps', sa.Column('override_check_in_at', sa.DateTime(), nullable=True))
    op.add_column('event_rsvps', sa.Column('override_check_out_at', sa.DateTime(), nullable=True))
    op.add_column('event_rsvps', sa.Column('override_duration_minutes', sa.Integer(), nullable=True))
    op.add_column('event_rsvps', sa.Column('overridden_by', sa.String(36), nullable=True))
    op.add_column('event_rsvps', sa.Column('overridden_at', sa.DateTime(), nullable=True))

    # Add foreign key constraint for overridden_by
    op.create_foreign_key('fk_event_rsvps_overridden_by', 'event_rsvps', 'users', ['overridden_by'], ['id'])

    # Create training_sessions table
    op.create_table(
        'training_sessions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('event_id', sa.String(36), nullable=False),
        sa.Column('course_id', sa.String(36), nullable=True),
        sa.Column('course_name', sa.String(255), nullable=False),
        sa.Column('course_code', sa.String(50), nullable=True),
        sa.Column('training_type', sa.Enum('certification', 'continuing_education', 'skills_practice', 'orientation', 'refresher', 'specialty', name='trainingtype'), nullable=False),
        sa.Column('credit_hours', sa.Float(), nullable=False),
        sa.Column('instructor', sa.String(255), nullable=True),
        sa.Column('issues_certification', sa.Boolean(), nullable=True, server_default='0'),
        sa.Column('certification_number_prefix', sa.String(50), nullable=True),
        sa.Column('issuing_agency', sa.String(255), nullable=True),
        sa.Column('expiration_months', sa.Integer(), nullable=True),
        sa.Column('auto_create_records', sa.Boolean(), nullable=True, server_default='1'),
        sa.Column('require_completion_confirmation', sa.Boolean(), nullable=True, server_default='0'),
        sa.Column('approval_required', sa.Boolean(), nullable=True, server_default='1'),
        sa.Column('approval_deadline_days', sa.Integer(), nullable=True, server_default='7'),
        sa.Column('is_finalized', sa.Boolean(), nullable=True, server_default='0'),
        sa.Column('finalized_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finalized_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['course_id'], ['training_courses.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['finalized_by'], ['users.id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    )
    op.create_index('idx_training_session_event', 'training_sessions', ['event_id'], unique=True)
    op.create_index('idx_training_session_org', 'training_sessions', ['organization_id'])

    # Create training_approvals table
    op.create_table(
        'training_approvals',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('training_session_id', sa.String(36), nullable=False),
        sa.Column('event_id', sa.String(36), nullable=False),
        sa.Column('approval_token', sa.String(64), nullable=False),
        sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.Enum('pending', 'approved', 'modified', 'rejected', name='approvalstatus'), nullable=True, server_default='pending'),
        sa.Column('approved_by', sa.String(36), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('approval_notes', sa.Text(), nullable=True),
        sa.Column('approval_deadline', sa.DateTime(timezone=True), nullable=False),
        sa.Column('reminder_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attendee_data', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['training_session_id'], ['training_sessions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['approved_by'], ['users.id']),
    )
    op.create_index('idx_approval_session', 'training_approvals', ['training_session_id'])
    op.create_index('idx_approval_status', 'training_approvals', ['status'])
    op.create_index('idx_approval_token', 'training_approvals', ['approval_token'], unique=True)
    op.create_index('idx_approval_deadline', 'training_approvals', ['approval_deadline'])


def downgrade() -> None:
    # Drop training_approvals table
    op.drop_index('idx_approval_deadline', 'training_approvals')
    op.drop_index('idx_approval_token', 'training_approvals')
    op.drop_index('idx_approval_status', 'training_approvals')
    op.drop_index('idx_approval_session', 'training_approvals')
    op.drop_table('training_approvals')

    # Drop training_sessions table
    op.drop_index('idx_training_session_org', 'training_sessions')
    op.drop_index('idx_training_session_event', 'training_sessions')
    op.drop_table('training_sessions')

    # Remove override fields from event_rsvps table
    op.drop_constraint('fk_event_rsvps_overridden_by', 'event_rsvps', type_='foreignkey')
    op.drop_column('event_rsvps', 'overridden_at')
    op.drop_column('event_rsvps', 'overridden_by')
    op.drop_column('event_rsvps', 'override_duration_minutes')
    op.drop_column('event_rsvps', 'override_check_out_at')
    op.drop_column('event_rsvps', 'override_check_in_at')

    # Remove check-out and duration tracking from event_rsvps table
    op.drop_column('event_rsvps', 'attendance_duration_minutes')
    op.drop_column('event_rsvps', 'checked_out_at')

    # Remove check-in window fields from events table
    op.drop_column('events', 'require_checkout')
    op.drop_column('events', 'check_in_minutes_after')
    op.drop_column('events', 'check_in_minutes_before')
    op.drop_column('events', 'check_in_window_type')
