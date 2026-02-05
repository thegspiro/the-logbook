"""Add enhanced training program features

Revision ID: 20260122_0030
Revises: 20260122_0015
Create Date: 2026-01-22 00:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260122_0030'
down_revision = '20260122_0015'
branch_labels = None
depends_on = None


def upgrade():
    # Add new columns to training_programs table
    op.add_column('training_programs', sa.Column('version', sa.Integer(), nullable=True, server_default='1'))
    op.add_column('training_programs', sa.Column('prerequisite_program_ids', sa.JSON(), nullable=True))
    op.add_column('training_programs', sa.Column('allows_concurrent_enrollment', sa.Boolean(), nullable=True, server_default='1'))
    op.add_column('training_programs', sa.Column('reminder_conditions', sa.JSON(), nullable=True))

    # Add new column to program_phases table
    op.add_column('program_phases', sa.Column('requires_manual_advancement', sa.Boolean(), nullable=True, server_default='0'))

    # Add new columns to program_requirements table
    op.add_column('program_requirements', sa.Column('program_specific_description', sa.Text(), nullable=True))
    op.add_column('program_requirements', sa.Column('custom_deadline_days', sa.Integer(), nullable=True))
    op.add_column('program_requirements', sa.Column('notification_message', sa.Text(), nullable=True))

    # Rename is_mandatory to is_required in program_requirements
    op.alter_column('program_requirements', 'is_mandatory', new_column_name='is_required',
                    existing_type=sa.Boolean(), existing_nullable=True)

    # Rename order to sort_order in program_requirements
    op.alter_column('program_requirements', 'order', new_column_name='sort_order',
                    existing_type=sa.Integer(), existing_nullable=True)

    # Add is_prerequisite column to program_requirements
    op.add_column('program_requirements', sa.Column('is_prerequisite', sa.Boolean(), nullable=True, server_default='0'))

    # Add notification_message to program_milestones
    op.add_column('program_milestones', sa.Column('notification_message', sa.Text(), nullable=True))


def downgrade():
    # Remove columns from program_milestones
    op.drop_column('program_milestones', 'notification_message')

    # Remove columns from program_requirements
    op.drop_column('program_requirements', 'is_prerequisite')
    op.alter_column('program_requirements', 'sort_order', new_column_name='order',
                    existing_type=sa.Integer(), existing_nullable=True)
    op.alter_column('program_requirements', 'is_required', new_column_name='is_mandatory',
                    existing_type=sa.Boolean(), existing_nullable=True)
    op.drop_column('program_requirements', 'notification_message')
    op.drop_column('program_requirements', 'custom_deadline_days')
    op.drop_column('program_requirements', 'program_specific_description')

    # Remove columns from program_phases
    op.drop_column('program_phases', 'requires_manual_advancement')

    # Remove columns from training_programs
    op.drop_column('training_programs', 'reminder_conditions')
    op.drop_column('training_programs', 'allows_concurrent_enrollment')
    op.drop_column('training_programs', 'prerequisite_program_ids')
    op.drop_column('training_programs', 'version')
