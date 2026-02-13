"""create documents meetings and notifications tables

Revision ID: 20260212_0300
Revises: 20260212_0200
Create Date: 2026-02-12 03:00:00.000000

Creates tables for documents, meetings/minutes, and notifications modules.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260212_0300'
down_revision = '20260212_0200'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ============================================
    # Document Folders table
    # ============================================
    op.create_table(
        'document_folders',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('color', sa.String(20), server_default='#3B82F6'),
        sa.Column('icon', sa.String(50), server_default='folder'),
        sa.Column('parent_id', sa.String(36), sa.ForeignKey('document_folders.id', ondelete='CASCADE')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_doc_folders_org', 'document_folders', ['organization_id'])
    op.create_index('idx_doc_folders_parent', 'document_folders', ['parent_id'])

    # ============================================
    # Documents table
    # ============================================
    op.create_table(
        'documents',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('folder_id', sa.String(36), sa.ForeignKey('document_folders.id', ondelete='SET NULL')),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('file_name', sa.String(255), nullable=False),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('file_size', sa.BigInteger, server_default='0'),
        sa.Column('file_type', sa.String(100)),
        sa.Column('status', sa.Enum('active', 'archived', name='documentstatus'), nullable=False, server_default='active'),
        sa.Column('version', sa.Integer, server_default='1'),
        sa.Column('tags', sa.Text),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('uploaded_by', sa.String(36), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_documents_org', 'documents', ['organization_id'])
    op.create_index('idx_documents_folder', 'documents', ['folder_id'])
    op.create_index('idx_documents_org_status', 'documents', ['organization_id', 'status'])

    # ============================================
    # Meetings table
    # ============================================
    op.create_table(
        'meetings',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('meeting_type', sa.Enum('business', 'special', 'committee', 'board', 'other', name='meetingtype'), nullable=False, server_default='business'),
        sa.Column('meeting_date', sa.Date, nullable=False),
        sa.Column('start_time', sa.Time),
        sa.Column('end_time', sa.Time),
        sa.Column('location', sa.String(255)),
        sa.Column('called_by', sa.String(255)),
        sa.Column('status', sa.Enum('draft', 'pending_approval', 'approved', name='meetingstatus'), nullable=False, server_default='draft'),
        sa.Column('agenda', sa.Text),
        sa.Column('notes', sa.Text),
        sa.Column('motions', sa.Text),
        sa.Column('approved_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('approved_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_meetings_org_date', 'meetings', ['organization_id', 'meeting_date'])
    op.create_index('idx_meetings_org_type', 'meetings', ['organization_id', 'meeting_type'])
    op.create_index('idx_meetings_org_status', 'meetings', ['organization_id', 'status'])

    # ============================================
    # Meeting Attendees table
    # ============================================
    op.create_table(
        'meeting_attendees',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('meeting_id', sa.String(36), sa.ForeignKey('meetings.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('present', sa.Boolean, server_default='1'),
        sa.Column('excused', sa.Boolean, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_meeting_attendees_meeting', 'meeting_attendees', ['meeting_id'])
    op.create_index('idx_meeting_attendees_user', 'meeting_attendees', ['user_id'])

    # ============================================
    # Meeting Action Items table
    # ============================================
    op.create_table(
        'meeting_action_items',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('meeting_id', sa.String(36), sa.ForeignKey('meetings.id', ondelete='CASCADE'), nullable=False),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('description', sa.Text, nullable=False),
        sa.Column('assigned_to', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('due_date', sa.Date),
        sa.Column('status', sa.Enum('open', 'in_progress', 'completed', 'cancelled', name='actionitemstatus'), nullable=False, server_default='open'),
        sa.Column('priority', sa.Integer, server_default='0'),
        sa.Column('completed_at', sa.DateTime(timezone=True)),
        sa.Column('completion_notes', sa.Text),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_action_items_meeting', 'meeting_action_items', ['meeting_id'])
    op.create_index('idx_action_items_org_status', 'meeting_action_items', ['organization_id', 'status'])
    op.create_index('idx_action_items_assigned', 'meeting_action_items', ['assigned_to', 'status'])

    # ============================================
    # Notification Rules table
    # ============================================
    op.create_table(
        'notification_rules',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('trigger', sa.Enum(
            'event_reminder', 'training_expiry', 'schedule_change', 'new_member',
            'maintenance_due', 'election_started', 'form_submitted',
            'action_item_assigned', 'meeting_scheduled', 'document_uploaded',
            name='notificationtrigger'
        ), nullable=False),
        sa.Column('category', sa.Enum(
            'events', 'training', 'scheduling', 'members', 'maintenance', 'general',
            name='notificationcategory'
        ), nullable=False, server_default='general'),
        sa.Column('channel', sa.Enum('email', 'in_app', name='notificationchannel'), nullable=False, server_default='in_app'),
        sa.Column('enabled', sa.Boolean, server_default='1'),
        sa.Column('config', sa.JSON),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_notif_rules_org', 'notification_rules', ['organization_id'])
    op.create_index('idx_notif_rules_org_trigger', 'notification_rules', ['organization_id', 'trigger'])
    op.create_index('idx_notif_rules_org_enabled', 'notification_rules', ['organization_id', 'enabled'])

    # ============================================
    # Notification Logs table
    # ============================================
    op.create_table(
        'notification_logs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('rule_id', sa.String(36), sa.ForeignKey('notification_rules.id', ondelete='SET NULL')),
        sa.Column('recipient_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('recipient_email', sa.String(255)),
        sa.Column('channel', sa.Enum('email', 'in_app', name='notificationchannel', create_type=False), nullable=False),
        sa.Column('subject', sa.String(500)),
        sa.Column('message', sa.Text),
        sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('delivered', sa.Boolean, server_default='0'),
        sa.Column('read', sa.Boolean, server_default='0'),
        sa.Column('read_at', sa.DateTime(timezone=True)),
        sa.Column('error', sa.Text),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_notif_logs_org', 'notification_logs', ['organization_id'])
    op.create_index('idx_notif_logs_recipient', 'notification_logs', ['recipient_id'])
    op.create_index('idx_notif_logs_org_sent', 'notification_logs', ['organization_id', 'sent_at'])


def downgrade() -> None:
    op.drop_table('notification_logs')
    op.drop_table('notification_rules')
    op.drop_table('meeting_action_items')
    op.drop_table('meeting_attendees')
    op.drop_table('meetings')
    op.drop_table('documents')
    op.drop_table('document_folders')
