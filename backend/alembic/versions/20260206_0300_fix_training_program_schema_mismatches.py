"""Fix training program schema mismatches between models and database

Revision ID: 20260206_0300
Revises: 20260205_0200
Create Date: 2026-02-06

Fixes:
- Renames program_requirements.is_mandatory -> is_required (match model)
- Renames program_requirements.order -> sort_order (match model)
- Adds missing columns to program_requirements: is_prerequisite,
  program_specific_description, custom_deadline_days, notification_message
- Adds missing column to program_phases: requires_manual_advancement
- Adds missing column to program_milestones: notification_message
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260206_0300'
down_revision = '20260205_0200'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ========================================
    # Fix program_requirements column names
    # ========================================

    # Rename is_mandatory -> is_required
    op.alter_column(
        'program_requirements',
        'is_mandatory',
        new_column_name='is_required',
        existing_type=sa.Boolean(),
        existing_nullable=True,
        existing_server_default='1',
    )

    # Rename order -> sort_order
    op.alter_column(
        'program_requirements',
        'order',
        new_column_name='sort_order',
        existing_type=sa.Integer(),
        existing_nullable=True,
    )

    # Add missing columns to program_requirements
    op.add_column(
        'program_requirements',
        sa.Column('is_prerequisite', sa.Boolean(), nullable=True, server_default='0'),
    )
    op.add_column(
        'program_requirements',
        sa.Column('program_specific_description', sa.Text(), nullable=True),
    )
    op.add_column(
        'program_requirements',
        sa.Column('custom_deadline_days', sa.Integer(), nullable=True),
    )
    op.add_column(
        'program_requirements',
        sa.Column('notification_message', sa.Text(), nullable=True),
    )

    # ========================================
    # Fix program_phases missing column
    # ========================================
    op.add_column(
        'program_phases',
        sa.Column('requires_manual_advancement', sa.Boolean(), nullable=True, server_default='0'),
    )

    # ========================================
    # Fix program_milestones missing column
    # ========================================
    op.add_column(
        'program_milestones',
        sa.Column('notification_message', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    # Remove added columns from program_milestones
    op.drop_column('program_milestones', 'notification_message')

    # Remove added column from program_phases
    op.drop_column('program_phases', 'requires_manual_advancement')

    # Remove added columns from program_requirements
    op.drop_column('program_requirements', 'notification_message')
    op.drop_column('program_requirements', 'custom_deadline_days')
    op.drop_column('program_requirements', 'program_specific_description')
    op.drop_column('program_requirements', 'is_prerequisite')

    # Rename columns back
    op.alter_column(
        'program_requirements',
        'sort_order',
        new_column_name='order',
        existing_type=sa.Integer(),
        existing_nullable=True,
    )
    op.alter_column(
        'program_requirements',
        'is_required',
        new_column_name='is_mandatory',
        existing_type=sa.Boolean(),
        existing_nullable=True,
        existing_server_default='1',
    )
