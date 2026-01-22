"""add training programs and requirements system

Revision ID: 20260122_0015
Revises: 20260122_0014
Create Date: 2026-01-22 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260122_0015'
down_revision = '20260122_0014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create new enums
    requirement_type = postgresql.ENUM('hours', 'courses', 'certification', 'shifts', 'calls', 'skills_evaluation', 'checklist', name='requirementtype')
    requirement_type.create(op.get_bind())

    requirement_source = postgresql.ENUM('department', 'state', 'national', name='requirementsource')
    requirement_source.create(op.get_bind())

    program_structure_type = postgresql.ENUM('sequential', 'phases', 'flexible', name='programstructuretype')
    program_structure_type.create(op.get_bind())

    enrollment_status = postgresql.ENUM('active', 'completed', 'expired', 'withdrawn', name='enrollmentstatus')
    enrollment_status.create(op.get_bind())

    requirement_progress_status = postgresql.ENUM('not_started', 'in_progress', 'completed', 'verified', name='requirementprogressstatus')
    requirement_progress_status.create(op.get_bind())

    # Update training_requirements table
    op.add_column('training_requirements', sa.Column('requirement_type', sa.Enum('hours', 'courses', 'certification', 'shifts', 'calls', 'skills_evaluation', 'checklist', name='requirementtype'), nullable=False, server_default='hours'))
    op.add_column('training_requirements', sa.Column('source', sa.Enum('department', 'state', 'national', name='requirementsource'), nullable=False, server_default='department'))
    op.add_column('training_requirements', sa.Column('registry_name', sa.String(100), nullable=True))
    op.add_column('training_requirements', sa.Column('registry_code', sa.String(50), nullable=True))
    op.add_column('training_requirements', sa.Column('is_editable', sa.Boolean(), nullable=True, server_default='true'))
    op.add_column('training_requirements', sa.Column('required_shifts', sa.Integer(), nullable=True))
    op.add_column('training_requirements', sa.Column('required_calls', sa.Integer(), nullable=True))
    op.add_column('training_requirements', sa.Column('required_call_types', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('training_requirements', sa.Column('required_skills', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('training_requirements', sa.Column('checklist_items', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('training_requirements', sa.Column('required_positions', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('training_requirements', sa.Column('time_limit_days', sa.Integer(), nullable=True))

    # Update indexes
    op.create_index('idx_requirement_org_source', 'training_requirements', ['organization_id', 'source'])
    op.create_index('idx_requirement_type', 'training_requirements', ['requirement_type'])

    # Create training_programs table
    op.create_table(
        'training_programs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('code', sa.String(50), nullable=True),
        sa.Column('target_position', sa.String(100), nullable=True),
        sa.Column('target_roles', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('structure_type', sa.Enum('sequential', 'phases', 'flexible', name='programstructuretype'), nullable=False, server_default='flexible'),
        sa.Column('time_limit_days', sa.Integer(), nullable=True),
        sa.Column('warning_days_before', sa.Integer(), nullable=True, server_default='30'),
        sa.Column('active', sa.Boolean(), nullable=True, server_default='true'),
        sa.Column('is_template', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    )
    op.create_index('idx_program_org_active', 'training_programs', ['organization_id', 'active'])
    op.create_index('idx_program_position', 'training_programs', ['target_position'])

    # Create program_phases table
    op.create_table(
        'program_phases',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('program_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('phase_number', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('prerequisite_phase_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('time_limit_days', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['program_id'], ['training_programs.id'], ondelete='CASCADE'),
    )
    op.create_index('idx_phase_program', 'program_phases', ['program_id', 'phase_number'])

    # Create program_requirements table
    op.create_table(
        'program_requirements',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('program_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('phase_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('requirement_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('is_mandatory', sa.Boolean(), nullable=True, server_default='true'),
        sa.Column('order', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['program_id'], ['training_programs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['phase_id'], ['program_phases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['requirement_id'], ['training_requirements.id'], ondelete='CASCADE'),
    )
    op.create_index('idx_prog_req_program', 'program_requirements', ['program_id'])
    op.create_index('idx_prog_req_phase', 'program_requirements', ['phase_id'])

    # Create program_milestones table
    op.create_table(
        'program_milestones',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('program_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('phase_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('completion_percentage_threshold', sa.Float(), nullable=True),
        sa.Column('requires_verification', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('verification_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['program_id'], ['training_programs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['phase_id'], ['program_phases.id'], ondelete='CASCADE'),
    )
    op.create_index('idx_milestone_program', 'program_milestones', ['program_id'])

    # Create program_enrollments table
    op.create_table(
        'program_enrollments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('program_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('enrolled_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('target_completion_date', sa.Date(), nullable=True),
        sa.Column('current_phase_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('progress_percentage', sa.Float(), nullable=True, server_default='0.0'),
        sa.Column('status', sa.Enum('active', 'completed', 'expired', 'withdrawn', name='enrollmentstatus'), nullable=True, server_default='active'),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('withdrawn_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('withdrawal_reason', sa.Text(), nullable=True),
        sa.Column('deadline_warning_sent', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('deadline_warning_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('enrolled_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['program_id'], ['training_programs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['current_phase_id'], ['program_phases.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['enrolled_by'], ['users.id']),
    )
    op.create_index('idx_enrollment_user', 'program_enrollments', ['user_id', 'status'])
    op.create_index('idx_enrollment_program', 'program_enrollments', ['program_id', 'status'])
    op.create_index('idx_enrollment_deadline', 'program_enrollments', ['target_completion_date'])

    # Create requirement_progress table
    op.create_table(
        'requirement_progress',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('enrollment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('requirement_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.Enum('not_started', 'in_progress', 'completed', 'verified', name='requirementprogressstatus'), nullable=True, server_default='not_started'),
        sa.Column('progress_value', sa.Float(), nullable=True, server_default='0.0'),
        sa.Column('progress_percentage', sa.Float(), nullable=True, server_default='0.0'),
        sa.Column('progress_notes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('verified_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('verification_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['enrollment_id'], ['program_enrollments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['requirement_id'], ['training_requirements.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['verified_by'], ['users.id']),
    )
    op.create_index('idx_progress_enrollment', 'requirement_progress', ['enrollment_id', 'status'])
    op.create_index('idx_progress_requirement', 'requirement_progress', ['requirement_id'])

    # Create skill_evaluations table
    op.create_table(
        'skill_evaluations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(100), nullable=True),
        sa.Column('evaluation_criteria', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('passing_requirements', sa.Text(), nullable=True),
        sa.Column('required_for_programs', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=True, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    )
    op.create_index('idx_skill_org_category', 'skill_evaluations', ['organization_id', 'category'])

    # Create skill_checkoffs table
    op.create_table(
        'skill_checkoffs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('skill_evaluation_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('evaluator_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('evaluation_results', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('score', sa.Float(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('evaluated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['skill_evaluation_id'], ['skill_evaluations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['evaluator_id'], ['users.id']),
    )
    op.create_index('idx_checkoff_user', 'skill_checkoffs', ['user_id'])
    op.create_index('idx_checkoff_skill', 'skill_checkoffs', ['skill_evaluation_id'])

    # Create shifts table (framework)
    op.create_table(
        'shifts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('shift_date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_time', sa.DateTime(timezone=True), nullable=True),
        sa.Column('apparatus_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('station_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('shift_officer_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('activities', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shift_officer_id'], ['users.id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    )
    op.create_index('idx_shift_date', 'shifts', ['organization_id', 'shift_date'])

    # Create shift_attendance table
    op.create_table(
        'shift_attendance',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('shift_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('checked_in_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('checked_out_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('duration_minutes', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['shift_id'], ['shifts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('idx_shift_att_shift', 'shift_attendance', ['shift_id'])
    op.create_index('idx_shift_att_user', 'shift_attendance', ['user_id'])

    # Create shift_calls table
    op.create_table(
        'shift_calls',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('shift_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('incident_number', sa.String(100), nullable=True),
        sa.Column('incident_type', sa.String(100), nullable=True),
        sa.Column('dispatched_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('on_scene_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cleared_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_en_route', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('medical_refusal', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('responding_members', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['shift_id'], ['shifts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
    )
    op.create_index('idx_call_shift', 'shift_calls', ['shift_id'])
    op.create_index('idx_call_type', 'shift_calls', ['incident_type'])


def downgrade() -> None:
    # Drop shift tables
    op.drop_index('idx_call_type', 'shift_calls')
    op.drop_index('idx_call_shift', 'shift_calls')
    op.drop_table('shift_calls')

    op.drop_index('idx_shift_att_user', 'shift_attendance')
    op.drop_index('idx_shift_att_shift', 'shift_attendance')
    op.drop_table('shift_attendance')

    op.drop_index('idx_shift_date', 'shifts')
    op.drop_table('shifts')

    # Drop skill tables
    op.drop_index('idx_checkoff_skill', 'skill_checkoffs')
    op.drop_index('idx_checkoff_user', 'skill_checkoffs')
    op.drop_table('skill_checkoffs')

    op.drop_index('idx_skill_org_category', 'skill_evaluations')
    op.drop_table('skill_evaluations')

    # Drop program tables
    op.drop_index('idx_progress_requirement', 'requirement_progress')
    op.drop_index('idx_progress_enrollment', 'requirement_progress')
    op.drop_table('requirement_progress')

    op.drop_index('idx_enrollment_deadline', 'program_enrollments')
    op.drop_index('idx_enrollment_program', 'program_enrollments')
    op.drop_index('idx_enrollment_user', 'program_enrollments')
    op.drop_table('program_enrollments')

    op.drop_index('idx_milestone_program', 'program_milestones')
    op.drop_table('program_milestones')

    op.drop_index('idx_prog_req_phase', 'program_requirements')
    op.drop_index('idx_prog_req_program', 'program_requirements')
    op.drop_table('program_requirements')

    op.drop_index('idx_phase_program', 'program_phases')
    op.drop_table('program_phases')

    op.drop_index('idx_program_position', 'training_programs')
    op.drop_index('idx_program_org_active', 'training_programs')
    op.drop_table('training_programs')

    # Drop columns from training_requirements
    op.drop_index('idx_requirement_type', 'training_requirements')
    op.drop_index('idx_requirement_org_source', 'training_requirements')

    op.drop_column('training_requirements', 'time_limit_days')
    op.drop_column('training_requirements', 'required_positions')
    op.drop_column('training_requirements', 'checklist_items')
    op.drop_column('training_requirements', 'required_skills')
    op.drop_column('training_requirements', 'required_call_types')
    op.drop_column('training_requirements', 'required_calls')
    op.drop_column('training_requirements', 'required_shifts')
    op.drop_column('training_requirements', 'is_editable')
    op.drop_column('training_requirements', 'registry_code')
    op.drop_column('training_requirements', 'registry_name')
    op.drop_column('training_requirements', 'source')
    op.drop_column('training_requirements', 'requirement_type')

    # Drop enums
    requirement_progress_status = postgresql.ENUM('not_started', 'in_progress', 'completed', 'verified', name='requirementprogressstatus')
    requirement_progress_status.drop(op.get_bind())

    enrollment_status = postgresql.ENUM('active', 'completed', 'expired', 'withdrawn', name='enrollmentstatus')
    enrollment_status.drop(op.get_bind())

    program_structure_type = postgresql.ENUM('sequential', 'phases', 'flexible', name='programstructuretype')
    program_structure_type.drop(op.get_bind())

    requirement_source = postgresql.ENUM('department', 'state', 'national', name='requirementsource')
    requirement_source.drop(op.get_bind())

    requirement_type = postgresql.ENUM('hours', 'courses', 'certification', 'shifts', 'calls', 'skills_evaluation', 'checklist', name='requirementtype')
    requirement_type.drop(op.get_bind())
