"""Add missing training tables (shifts, skill evaluations)

Revision ID: 20260206_0301
Revises: 20260206_0300
Create Date: 2026-02-06

NOTE: This migration is now a no-op because these tables were already created
in migration 20260122_0015. This migration is kept in the chain for backwards
compatibility with existing deployments that may have run it.

Originally added:
- skill_evaluations: Defines skills that require evaluation/checkoff
- skill_checkoffs: Records individual skill evaluations
- shifts: Records shift information for member participation
- shift_attendance: Tracks individual member attendance on shifts
- shift_calls: Records calls/incidents during a shift
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = '20260206_0301'
down_revision = '20260206_0300'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    No-op migration. Tables were already created in 20260122_0015.
    This migration is kept for backwards compatibility.
    """
    # Check if tables exist to avoid errors
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_tables = inspector.get_table_names()

    # Only create tables if they don't exist (for backwards compatibility)
    # In practice, these tables should already exist from migration 20260122_0015
    tables_to_create = {
        'skill_evaluations': lambda: create_skill_evaluations_table(),
        'skill_checkoffs': lambda: create_skill_checkoffs_table(),
        'shifts': lambda: create_shifts_table(),
        'shift_attendance': lambda: create_shift_attendance_table(),
        'shift_calls': lambda: create_shift_calls_table(),
    }

    for table_name, create_func in tables_to_create.items():
        if table_name not in existing_tables:
            create_func()


def create_skill_evaluations_table() -> None:
    """Create skill_evaluations table and indexes"""
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


def create_skill_checkoffs_table() -> None:
    """Create skill_checkoffs table and indexes"""
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


def create_shifts_table() -> None:
    """Create shifts table and indexes"""
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


def create_shift_attendance_table() -> None:
    """Create shift_attendance table and indexes"""
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


def create_shift_calls_table() -> None:
    """Create shift_calls table and indexes"""
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
    """
    No-op downgrade. Tables are managed by migration 20260122_0015.
    This migration does not drop tables to avoid conflicts.
    """
    # No-op: Tables were not created by this migration, so nothing to drop
    pass
