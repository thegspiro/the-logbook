"""Add missing training tables (shifts, skill evaluations)

Revision ID: 20260206_0301
Revises: 20260206_0300
Create Date: 2026-02-06

Adds tables defined in the training model but missing from migrations:
- skill_evaluations: Defines skills that require evaluation/checkoff
- skill_checkoffs: Records individual skill evaluations
- shifts: Records shift information for member participation
- shift_attendance: Tracks individual member attendance on shifts
- shift_calls: Records calls/incidents during a shift
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260206_0301'
down_revision = '20260206_0300'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ========================================
    # Skill Evaluations
    # ========================================
    op.create_table(
        'skill_evaluations',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(100), nullable=True),
        sa.Column('evaluation_criteria', sa.JSON(), nullable=True),
        sa.Column('passing_requirements', sa.Text(), nullable=True),
        sa.Column('required_for_programs', sa.JSON(), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=True, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    )
    op.create_index('ix_skill_evaluations_organization_id', 'skill_evaluations', ['organization_id'])
    op.create_index('ix_skill_evaluations_active', 'skill_evaluations', ['active'])
    op.create_index('idx_skill_org_category', 'skill_evaluations', ['organization_id', 'category'])

    # ========================================
    # Skill Checkoffs
    # ========================================
    op.create_table(
        'skill_checkoffs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('skill_evaluation_id', sa.String(36), nullable=False),
        sa.Column('evaluator_id', sa.String(36), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('evaluation_results', sa.JSON(), nullable=True),
        sa.Column('score', sa.Float(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('evaluated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['skill_evaluation_id'], ['skill_evaluations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['evaluator_id'], ['users.id']),
    )
    op.create_index('ix_skill_checkoffs_organization_id', 'skill_checkoffs', ['organization_id'])
    op.create_index('idx_checkoff_user', 'skill_checkoffs', ['user_id'])
    op.create_index('idx_checkoff_skill', 'skill_checkoffs', ['skill_evaluation_id'])

    # ========================================
    # Shifts
    # ========================================
    op.create_table(
        'shifts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('shift_date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_time', sa.DateTime(timezone=True), nullable=True),
        sa.Column('apparatus_id', sa.String(36), nullable=True),
        sa.Column('station_id', sa.String(36), nullable=True),
        sa.Column('shift_officer_id', sa.String(36), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('activities', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shift_officer_id'], ['users.id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    )
    op.create_index('ix_shifts_organization_id', 'shifts', ['organization_id'])
    op.create_index('ix_shifts_shift_date', 'shifts', ['shift_date'])
    op.create_index('idx_shift_date', 'shifts', ['organization_id', 'shift_date'])

    # ========================================
    # Shift Attendance
    # ========================================
    op.create_table(
        'shift_attendance',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('shift_id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('checked_in_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('checked_out_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('duration_minutes', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['shift_id'], ['shifts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('idx_shift_att_shift', 'shift_attendance', ['shift_id'])
    op.create_index('idx_shift_att_user', 'shift_attendance', ['user_id'])

    # ========================================
    # Shift Calls
    # ========================================
    op.create_table(
        'shift_calls',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('shift_id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('incident_number', sa.String(100), nullable=True),
        sa.Column('incident_type', sa.String(100), nullable=True),
        sa.Column('dispatched_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('on_scene_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cleared_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_en_route', sa.Boolean(), nullable=True, server_default='0'),
        sa.Column('medical_refusal', sa.Boolean(), nullable=True, server_default='0'),
        sa.Column('responding_members', sa.JSON(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['shift_id'], ['shifts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
    )
    op.create_index('idx_call_shift', 'shift_calls', ['shift_id'])
    op.create_index('idx_call_type', 'shift_calls', ['incident_type'])


def downgrade() -> None:
    op.drop_index('idx_call_type', 'shift_calls')
    op.drop_index('idx_call_shift', 'shift_calls')
    op.drop_table('shift_calls')

    op.drop_index('idx_shift_att_user', 'shift_attendance')
    op.drop_index('idx_shift_att_shift', 'shift_attendance')
    op.drop_table('shift_attendance')

    op.drop_index('idx_shift_date', 'shifts')
    op.drop_index('ix_shifts_shift_date', 'shifts')
    op.drop_index('ix_shifts_organization_id', 'shifts')
    op.drop_table('shifts')

    op.drop_index('idx_checkoff_skill', 'skill_checkoffs')
    op.drop_index('idx_checkoff_user', 'skill_checkoffs')
    op.drop_index('ix_skill_checkoffs_organization_id', 'skill_checkoffs')
    op.drop_table('skill_checkoffs')

    op.drop_index('idx_skill_org_category', 'skill_evaluations')
    op.drop_index('ix_skill_evaluations_active', 'skill_evaluations')
    op.drop_index('ix_skill_evaluations_organization_id', 'skill_evaluations')
    op.drop_table('skill_evaluations')
