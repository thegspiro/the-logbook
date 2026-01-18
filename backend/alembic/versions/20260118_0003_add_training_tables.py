"""Add training tables

Revision ID: 0003
Revises: 0002
Create Date: 2026-01-18

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create training_courses table
    op.create_table(
        'training_courses',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('code', sa.String(50)),
        sa.Column('description', sa.Text()),
        sa.Column('training_type', sa.Enum('certification', 'continuing_education', 'skills_practice', 'orientation', 'refresher', 'specialty', name='trainingtype'), nullable=False),
        sa.Column('duration_hours', sa.Float()),
        sa.Column('credit_hours', sa.Float()),
        sa.Column('prerequisites', postgresql.JSONB()),
        sa.Column('expiration_months', sa.Integer()),
        sa.Column('instructor', sa.String(255)),
        sa.Column('max_participants', sa.Integer()),
        sa.Column('materials_required', postgresql.JSONB()),
        sa.Column('active', sa.Boolean(), server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_course_org', 'training_courses', ['organization_id'])
    op.create_index('idx_course_active', 'training_courses', ['active'])
    op.create_index('idx_course_org_code', 'training_courses', ['organization_id', 'code'])

    # Create training_records table
    op.create_table(
        'training_records',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('course_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('training_courses.id', ondelete='SET NULL')),
        sa.Column('course_name', sa.String(255), nullable=False),
        sa.Column('course_code', sa.String(50)),
        sa.Column('training_type', sa.Enum('certification', 'continuing_education', 'skills_practice', 'orientation', 'refresher', 'specialty', name='trainingtype'), nullable=False),
        sa.Column('scheduled_date', sa.Date()),
        sa.Column('completion_date', sa.Date()),
        sa.Column('expiration_date', sa.Date()),
        sa.Column('hours_completed', sa.Float(), nullable=False),
        sa.Column('credit_hours', sa.Float()),
        sa.Column('certification_number', sa.String(100)),
        sa.Column('issuing_agency', sa.String(255)),
        sa.Column('status', sa.Enum('scheduled', 'in_progress', 'completed', 'cancelled', 'failed', name='trainingstatus'), server_default='scheduled'),
        sa.Column('score', sa.Float()),
        sa.Column('passing_score', sa.Float()),
        sa.Column('passed', sa.Boolean()),
        sa.Column('instructor', sa.String(255)),
        sa.Column('location', sa.String(255)),
        sa.Column('notes', sa.Text()),
        sa.Column('attachments', postgresql.JSONB()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_record_org', 'training_records', ['organization_id'])
    op.create_index('idx_record_user', 'training_records', ['user_id'])
    op.create_index('idx_record_user_status', 'training_records', ['user_id', 'status'])
    op.create_index('idx_record_completion', 'training_records', ['completion_date'])
    op.create_index('idx_record_expiration', 'training_records', ['expiration_date'])

    # Create training_requirements table
    op.create_table(
        'training_requirements',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('training_type', sa.Enum('certification', 'continuing_education', 'skills_practice', 'orientation', 'refresher', 'specialty', name='trainingtype')),
        sa.Column('required_hours', sa.Float()),
        sa.Column('required_courses', postgresql.JSONB()),
        sa.Column('frequency', sa.Enum('annual', 'biannual', 'quarterly', 'monthly', 'one_time', name='requirementfrequency'), nullable=False),
        sa.Column('year', sa.Integer()),
        sa.Column('applies_to_all', sa.Boolean(), server_default='true'),
        sa.Column('required_roles', postgresql.JSONB()),
        sa.Column('start_date', sa.Date()),
        sa.Column('due_date', sa.Date()),
        sa.Column('active', sa.Boolean(), server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_requirement_org', 'training_requirements', ['organization_id'])
    op.create_index('idx_requirement_year', 'training_requirements', ['organization_id', 'year'])
    op.create_index('idx_requirement_due', 'training_requirements', ['due_date'])
    op.create_index('idx_requirement_active', 'training_requirements', ['active'])


def downgrade() -> None:
    op.drop_table('training_requirements')
    op.drop_table('training_records')
    op.drop_table('training_courses')
    op.execute('DROP TYPE IF EXISTS trainingstatus')
    op.execute('DROP TYPE IF EXISTS trainingtype')
    op.execute('DROP TYPE IF EXISTS requirementfrequency')
