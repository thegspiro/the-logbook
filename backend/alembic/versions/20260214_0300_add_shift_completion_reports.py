"""Add shift completion reports table

Revision ID: 20260214_0300
Revises: 20260214_0200
Create Date: 2026-02-14

Adds shift_completion_reports table for shift officers to report on
trainee experiences. Feeds into pipeline requirement progress tracking.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_0300'
down_revision = '20260214_0200'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'shift_completion_reports',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),

        # Shift context
        sa.Column('shift_id', sa.String(36), sa.ForeignKey('shifts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('shift_date', sa.Date(), nullable=False),

        # People
        sa.Column('trainee_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('officer_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),

        # Shift details
        sa.Column('hours_on_shift', sa.Float(), nullable=False),
        sa.Column('calls_responded', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('call_types', sa.JSON(), nullable=True),

        # Performance observations
        sa.Column('performance_rating', sa.Integer(), nullable=True),
        sa.Column('areas_of_strength', sa.Text(), nullable=True),
        sa.Column('areas_for_improvement', sa.Text(), nullable=True),
        sa.Column('officer_narrative', sa.Text(), nullable=True),

        # Skills observed
        sa.Column('skills_observed', sa.JSON(), nullable=True),
        sa.Column('tasks_performed', sa.JSON(), nullable=True),

        # Pipeline linkage
        sa.Column('enrollment_id', sa.String(36), sa.ForeignKey('program_enrollments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('requirements_progressed', sa.JSON(), nullable=True),

        # Trainee acknowledgment
        sa.Column('trainee_acknowledged', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('trainee_acknowledged_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('trainee_comments', sa.Text(), nullable=True),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_shift_report_trainee', 'shift_completion_reports', ['trainee_id', 'shift_date'])
    op.create_index('idx_shift_report_officer', 'shift_completion_reports', ['officer_id'])
    op.create_index('idx_shift_report_enrollment', 'shift_completion_reports', ['enrollment_id'])
    op.create_index('idx_shift_report_org_date', 'shift_completion_reports', ['organization_id', 'shift_date'])


def downgrade() -> None:
    op.drop_index('idx_shift_report_org_date', table_name='shift_completion_reports')
    op.drop_index('idx_shift_report_enrollment', table_name='shift_completion_reports')
    op.drop_index('idx_shift_report_officer', table_name='shift_completion_reports')
    op.drop_index('idx_shift_report_trainee', table_name='shift_completion_reports')
    op.drop_table('shift_completion_reports')
