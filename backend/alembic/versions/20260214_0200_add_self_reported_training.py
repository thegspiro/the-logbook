"""Add self-reported training tables

Revision ID: 20260214_0200
Revises: 20260214_0100
Create Date: 2026-02-14

Adds self_report_configs and training_submissions tables to support
member self-reported training with configurable approval workflows.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_0200'
down_revision = '20260214_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Self-report configuration table
    op.create_table(
        'self_report_configs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, unique=True),

        # Approval settings
        sa.Column('require_approval', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('auto_approve_under_hours', sa.Float(), nullable=True),
        sa.Column('approval_deadline_days', sa.Integer(), nullable=False, server_default='14'),

        # Notification settings
        sa.Column('notify_officer_on_submit', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('notify_member_on_decision', sa.Boolean(), nullable=False, server_default='1'),

        # Field configuration (JSON)
        sa.Column('field_config', sa.JSON(), nullable=False),

        # Restrictions
        sa.Column('allowed_training_types', sa.JSON(), nullable=True),
        sa.Column('max_hours_per_submission', sa.Float(), nullable=True),
        sa.Column('member_instructions', sa.Text(), nullable=True),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('updated_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
    )
    op.create_index('idx_self_report_config_org', 'self_report_configs', ['organization_id'])

    # Training submissions table
    op.create_table(
        'training_submissions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('submitted_by', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),

        # Training details
        sa.Column('course_name', sa.String(255), nullable=False),
        sa.Column('course_code', sa.String(50), nullable=True),
        sa.Column('training_type', sa.Enum('certification', 'continuing_education', 'skills_practice', 'orientation', 'refresher', 'specialty', name='trainingtype'), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),

        # Dates and hours
        sa.Column('completion_date', sa.Date(), nullable=False),
        sa.Column('hours_completed', sa.Float(), nullable=False),
        sa.Column('credit_hours', sa.Float(), nullable=True),

        # Instructor and location
        sa.Column('instructor', sa.String(255), nullable=True),
        sa.Column('location', sa.String(255), nullable=True),

        # Certification
        sa.Column('certification_number', sa.String(100), nullable=True),
        sa.Column('issuing_agency', sa.String(255), nullable=True),
        sa.Column('expiration_date', sa.Date(), nullable=True),

        # Category
        sa.Column('category_id', sa.String(36), sa.ForeignKey('training_categories.id', ondelete='SET NULL'), nullable=True),

        # Attachments
        sa.Column('attachments', sa.JSON(), nullable=True),

        # Status
        sa.Column('status', sa.Enum('draft', 'pending_review', 'approved', 'rejected', 'revision_requested', name='submissionstatus'), nullable=False, server_default='pending_review'),

        # Review
        sa.Column('reviewed_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reviewer_notes', sa.Text(), nullable=True),

        # Link to created record
        sa.Column('training_record_id', sa.String(36), sa.ForeignKey('training_records.id', ondelete='SET NULL'), nullable=True),

        # Timestamps
        sa.Column('submitted_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_submission_org_status', 'training_submissions', ['organization_id', 'status'])
    op.create_index('idx_submission_user', 'training_submissions', ['submitted_by', 'status'])
    op.create_index('idx_submission_date', 'training_submissions', ['completion_date'])


def downgrade() -> None:
    op.drop_index('idx_submission_date', table_name='training_submissions')
    op.drop_index('idx_submission_user', table_name='training_submissions')
    op.drop_index('idx_submission_org_status', table_name='training_submissions')
    op.drop_table('training_submissions')

    op.drop_index('idx_self_report_config_org', table_name='self_report_configs')
    op.drop_table('self_report_configs')
