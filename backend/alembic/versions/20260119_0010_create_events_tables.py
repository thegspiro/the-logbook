"""Create events tables

Revision ID: 20260119_0010
Revises: 20260119_0009
Create Date: 2026-01-19 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260119_0010'
down_revision = '20260119_0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create events table
    op.create_table(
        'events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('event_type', sa.Enum('business_meeting', 'public_education', 'training', 'social', 'fundraiser', 'ceremony', 'other', name='eventtype'), nullable=False, server_default='other'),
        sa.Column('location', sa.String(length=300), nullable=True),
        sa.Column('location_details', sa.Text(), nullable=True),
        sa.Column('start_datetime', sa.DateTime(), nullable=False),
        sa.Column('end_datetime', sa.DateTime(), nullable=False),
        sa.Column('requires_rsvp', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('rsvp_deadline', sa.DateTime(), nullable=True),
        sa.Column('max_attendees', sa.Integer(), nullable=True),
        sa.Column('is_mandatory', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('eligible_roles', sa.JSON(), nullable=True),
        sa.Column('allow_guests', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('send_reminders', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('reminder_hours_before', sa.Integer(), nullable=False, server_default='24'),
        sa.Column('custom_fields', sa.JSON(), nullable=True),
        sa.Column('attachments', sa.JSON(), nullable=True),
        sa.Column('is_cancelled', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('cancellation_reason', sa.Text(), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )

    # Create indexes for events
    op.create_index('ix_events_organization_id', 'events', ['organization_id'])
    op.create_index('ix_events_start_datetime', 'events', ['start_datetime'])
    op.create_index('ix_events_event_type', 'events', ['event_type'])

    # Create event_rsvps table
    op.create_table(
        'event_rsvps',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('event_id', sa.String(36), sa.ForeignKey('events.id'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.Enum('going', 'not_going', 'maybe', name='rsvpstatus'), nullable=False, server_default='going'),
        sa.Column('guest_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('responded_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('checked_in', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('checked_in_at', sa.DateTime(), nullable=True),
    )

    # Create indexes for event_rsvps
    op.create_index('ix_event_rsvps_event_id', 'event_rsvps', ['event_id'])
    op.create_index('ix_event_rsvps_user_id', 'event_rsvps', ['user_id'])
    op.create_index('ix_event_rsvps_event_user', 'event_rsvps', ['event_id', 'user_id'], unique=True)


def downgrade() -> None:
    # Drop tables
    op.drop_index('ix_event_rsvps_event_user', table_name='event_rsvps')
    op.drop_index('ix_event_rsvps_user_id', table_name='event_rsvps')
    op.drop_index('ix_event_rsvps_event_id', table_name='event_rsvps')
    op.drop_table('event_rsvps')

    op.drop_index('ix_events_event_type', table_name='events')
    op.drop_index('ix_events_start_datetime', table_name='events')
    op.drop_index('ix_events_organization_id', table_name='events')
    op.drop_table('events')
