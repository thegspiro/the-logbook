"""Add training module config table

Revision ID: 20260214_0400
Revises: 20260214_0300
Create Date: 2026-02-14

Adds training_module_configs table for per-organization control
of what training data is visible to individual members.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_0400'
down_revision = '20260214_0300'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'training_module_configs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, unique=True),

        # Training records & history
        sa.Column('show_training_history', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('show_training_hours', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('show_certification_status', sa.Boolean(), nullable=False, server_default='1'),

        # Pipeline / program progress
        sa.Column('show_pipeline_progress', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('show_requirement_details', sa.Boolean(), nullable=False, server_default='1'),

        # Shift completion reports
        sa.Column('show_shift_reports', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('show_shift_stats', sa.Boolean(), nullable=False, server_default='1'),

        # Officer-written content visibility
        sa.Column('show_officer_narrative', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('show_performance_rating', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('show_areas_of_strength', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('show_areas_for_improvement', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('show_skills_observed', sa.Boolean(), nullable=False, server_default='1'),

        # Self-reported submissions
        sa.Column('show_submission_history', sa.Boolean(), nullable=False, server_default='1'),

        # Reports access
        sa.Column('allow_member_report_export', sa.Boolean(), nullable=False, server_default='0'),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('updated_by', sa.String(36), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_training_config_org', 'training_module_configs', ['organization_id'])


def downgrade() -> None:
    op.drop_index('idx_training_config_org', table_name='training_module_configs')
    op.drop_table('training_module_configs')
