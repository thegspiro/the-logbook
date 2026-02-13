"""Add minutes templates, documents module, and dynamic sections

Revision ID: 20260213_0800
Revises: 20260212_1200
Create Date: 2026-02-13 08:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers
revision = '20260213_0800'
down_revision = '20260212_1200'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Minutes Templates ──
    op.create_table(
        'minutes_templates',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('meeting_type', sa.Enum('business', 'special', 'committee', 'board', 'other', name='meetingtype'), nullable=False, server_default='business'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('sections', sa.JSON(), nullable=False),
        sa.Column('header_config', sa.JSON(), nullable=True),
        sa.Column('footer_config', sa.JSON(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')),
    )
    op.create_index('ix_minutes_templates_organization_id', 'minutes_templates', ['organization_id'])
    op.create_index('ix_minutes_templates_meeting_type', 'minutes_templates', ['meeting_type'])

    # ── Add new columns to meeting_minutes ──
    op.add_column('meeting_minutes', sa.Column('sections', sa.JSON(), nullable=True))
    op.add_column('meeting_minutes', sa.Column('template_id', sa.String(36), sa.ForeignKey('minutes_templates.id', ondelete='SET NULL'), nullable=True))
    op.add_column('meeting_minutes', sa.Column('header_config', sa.JSON(), nullable=True))
    op.add_column('meeting_minutes', sa.Column('footer_config', sa.JSON(), nullable=True))
    op.add_column('meeting_minutes', sa.Column('published_document_id', sa.String(36), nullable=True))

    # ── Document Folders ──
    op.create_table(
        'document_folders',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('slug', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('parent_folder_id', sa.String(36), sa.ForeignKey('document_folders.id', ondelete='CASCADE'), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('icon', sa.String(50), nullable=True),
        sa.Column('color', sa.String(50), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')),
    )
    op.create_index('ix_document_folders_organization_id', 'document_folders', ['organization_id'])
    op.create_index('ix_document_folders_slug', 'document_folders', ['organization_id', 'slug'])
    op.create_index('ix_document_folders_parent', 'document_folders', ['parent_folder_id'])

    # ── Documents ──
    op.create_table(
        'documents',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('folder_id', sa.String(36), sa.ForeignKey('document_folders.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('document_type', sa.Enum('uploaded', 'generated', name='documenttype'), nullable=False, server_default='uploaded'),
        sa.Column('file_path', sa.Text(), nullable=True),
        sa.Column('file_name', sa.String(255), nullable=True),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('content_html', mysql.LONGTEXT(), nullable=True),
        sa.Column('source_type', sa.String(50), nullable=True),
        sa.Column('source_id', sa.String(36), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')),
    )
    op.create_index('ix_documents_organization_id', 'documents', ['organization_id'])
    op.create_index('ix_documents_folder_id', 'documents', ['folder_id'])
    op.create_index('ix_documents_source', 'documents', ['source_type', 'source_id'])
    op.create_index('ix_documents_document_type', 'documents', ['document_type'])

    # ── Migrate existing minutes data into sections JSON ──
    # Populate the new sections column from legacy fields for existing rows
    op.execute("""
        UPDATE meeting_minutes
        SET sections = JSON_ARRAY(
            JSON_OBJECT('order', 0, 'key', 'agenda', 'title', 'Agenda', 'content', COALESCE(agenda, '')),
            JSON_OBJECT('order', 1, 'key', 'old_business', 'title', 'Old Business', 'content', COALESCE(old_business, '')),
            JSON_OBJECT('order', 2, 'key', 'new_business', 'title', 'New Business', 'content', COALESCE(new_business, '')),
            JSON_OBJECT('order', 3, 'key', 'treasurer_report', 'title', 'Treasurer\\'s Report', 'content', COALESCE(treasurer_report, '')),
            JSON_OBJECT('order', 4, 'key', 'chief_report', 'title', 'Chief\\'s Report', 'content', COALESCE(chief_report, '')),
            JSON_OBJECT('order', 5, 'key', 'committee_reports', 'title', 'Committee Reports', 'content', COALESCE(committee_reports, '')),
            JSON_OBJECT('order', 6, 'key', 'announcements', 'title', 'Announcements', 'content', COALESCE(announcements, '')),
            JSON_OBJECT('order', 7, 'key', 'notes', 'title', 'General Notes', 'content', COALESCE(notes, ''))
        )
        WHERE sections IS NULL
    """)


def downgrade() -> None:
    op.drop_table('documents')
    op.drop_table('document_folders')
    op.drop_column('meeting_minutes', 'published_document_id')
    op.drop_column('meeting_minutes', 'footer_config')
    op.drop_column('meeting_minutes', 'header_config')
    op.drop_column('meeting_minutes', 'template_id')
    op.drop_column('meeting_minutes', 'sections')
    op.drop_table('minutes_templates')
