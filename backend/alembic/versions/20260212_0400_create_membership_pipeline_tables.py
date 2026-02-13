"""create membership pipeline tables

Revision ID: 20260212_0400
Revises: 20260212_0300
Create Date: 2026-02-12 04:00:00.000000

Creates the membership_pipelines, membership_pipeline_steps,
prospective_members, prospect_step_progress, and prospect_activity_log
tables for the prospective member pipeline module.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260212_0400'
down_revision = '20260212_0300'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Membership pipelines table
    op.create_table(
        'membership_pipelines',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('is_template', sa.Boolean, server_default='0'),
        sa.Column('is_default', sa.Boolean, server_default='0'),
        sa.Column('auto_transfer_on_approval', sa.Boolean, server_default='0'),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_pipeline_org_default', 'membership_pipelines', ['organization_id', 'is_default'])
    op.create_index('idx_pipeline_org_template', 'membership_pipelines', ['organization_id', 'is_template'])

    # Membership pipeline steps table
    op.create_table(
        'membership_pipeline_steps',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('pipeline_id', sa.String(36), sa.ForeignKey('membership_pipelines.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('step_type', sa.Enum('action', 'checkbox', 'note', name='pipelinesteptype'), nullable=False, server_default='checkbox'),
        sa.Column('action_type', sa.Enum('send_email', 'schedule_meeting', 'collect_document', 'custom', name='actiontype'), nullable=True),
        sa.Column('is_first_step', sa.Boolean, server_default='0'),
        sa.Column('is_final_step', sa.Boolean, server_default='0'),
        sa.Column('sort_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('email_template_id', sa.String(36), sa.ForeignKey('email_templates.id', ondelete='SET NULL'), nullable=True),
        sa.Column('required', sa.Boolean, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_pipeline_step_order', 'membership_pipeline_steps', ['pipeline_id', 'sort_order'])

    # Prospective members table
    op.create_table(
        'prospective_members',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('pipeline_id', sa.String(36), sa.ForeignKey('membership_pipelines.id', ondelete='SET NULL'), nullable=True),
        sa.Column('first_name', sa.String(100), nullable=False),
        sa.Column('last_name', sa.String(100), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('phone', sa.String(20)),
        sa.Column('mobile', sa.String(20)),
        sa.Column('date_of_birth', sa.Date),
        sa.Column('address_street', sa.String(255)),
        sa.Column('address_city', sa.String(100)),
        sa.Column('address_state', sa.String(50)),
        sa.Column('address_zip', sa.String(20)),
        sa.Column('interest_reason', sa.Text),
        sa.Column('referral_source', sa.String(255)),
        sa.Column('referred_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('current_step_id', sa.String(36), sa.ForeignKey('membership_pipeline_steps.id', ondelete='SET NULL')),
        sa.Column('status', sa.Enum('active', 'approved', 'rejected', 'withdrawn', 'transferred', name='prospectstatus'), nullable=False, server_default='active'),
        sa.Column('metadata', sa.JSON),
        sa.Column('form_submission_id', sa.String(36), sa.ForeignKey('form_submissions.id', ondelete='SET NULL')),
        sa.Column('transferred_user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('transferred_at', sa.DateTime(timezone=True)),
        sa.Column('notes', sa.Text),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_prospect_org_status', 'prospective_members', ['organization_id', 'status'])
    op.create_index('idx_prospect_org_pipeline', 'prospective_members', ['organization_id', 'pipeline_id'])
    op.create_index('idx_prospect_org_email', 'prospective_members', ['organization_id', 'email'])

    # Prospect step progress table
    op.create_table(
        'prospect_step_progress',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('prospect_id', sa.String(36), sa.ForeignKey('prospective_members.id', ondelete='CASCADE'), nullable=False),
        sa.Column('step_id', sa.String(36), sa.ForeignKey('membership_pipeline_steps.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.Enum('pending', 'in_progress', 'completed', 'skipped', name='stepprogressstatus'), nullable=False, server_default='pending'),
        sa.Column('completed_at', sa.DateTime(timezone=True)),
        sa.Column('completed_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('notes', sa.Text),
        sa.Column('action_result', sa.JSON),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_step_progress_prospect_step', 'prospect_step_progress', ['prospect_id', 'step_id'], unique=True)

    # Prospect activity log table
    op.create_table(
        'prospect_activity_log',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('prospect_id', sa.String(36), sa.ForeignKey('prospective_members.id', ondelete='CASCADE'), nullable=False),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('details', sa.JSON),
        sa.Column('performed_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_activity_log_prospect', 'prospect_activity_log', ['prospect_id'])
    op.create_index('idx_activity_log_action', 'prospect_activity_log', ['action'])

    print("Created membership pipeline tables: membership_pipelines, membership_pipeline_steps, prospective_members, prospect_step_progress, prospect_activity_log")


def downgrade() -> None:
    op.drop_table('prospect_activity_log')
    op.drop_table('prospect_step_progress')
    op.drop_table('prospective_members')
    op.drop_table('membership_pipeline_steps')
    op.drop_table('membership_pipelines')
    print("Dropped membership pipeline tables")
