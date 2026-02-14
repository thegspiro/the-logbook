"""Add program and category linkage to training_sessions

Revision ID: 20260214_0100
Revises: 20260213_1500
Create Date: 2026-02-14

Adds category_id, program_id, phase_id, and requirement_id columns to
training_sessions table so training events can be linked to the training
pipeline (programs, phases, requirements) and categorized by training type.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_0100'
down_revision = '20260213_1500'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add category linkage
    op.add_column('training_sessions', sa.Column(
        'category_id', sa.String(36), nullable=True,
    ))
    op.create_foreign_key(
        'fk_training_session_category',
        'training_sessions', 'training_categories',
        ['category_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'idx_training_session_category',
        'training_sessions', ['category_id'],
    )

    # Add program linkage
    op.add_column('training_sessions', sa.Column(
        'program_id', sa.String(36), nullable=True,
    ))
    op.create_foreign_key(
        'fk_training_session_program',
        'training_sessions', 'training_programs',
        ['program_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'idx_training_session_program',
        'training_sessions', ['program_id'],
    )

    # Add phase linkage
    op.add_column('training_sessions', sa.Column(
        'phase_id', sa.String(36), nullable=True,
    ))
    op.create_foreign_key(
        'fk_training_session_phase',
        'training_sessions', 'program_phases',
        ['phase_id'], ['id'],
        ondelete='SET NULL',
    )

    # Add requirement linkage
    op.add_column('training_sessions', sa.Column(
        'requirement_id', sa.String(36), nullable=True,
    ))
    op.create_foreign_key(
        'fk_training_session_requirement',
        'training_sessions', 'training_requirements',
        ['requirement_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_training_session_requirement', 'training_sessions', type_='foreignkey')
    op.drop_column('training_sessions', 'requirement_id')

    op.drop_constraint('fk_training_session_phase', 'training_sessions', type_='foreignkey')
    op.drop_column('training_sessions', 'phase_id')

    op.drop_index('idx_training_session_program', table_name='training_sessions')
    op.drop_constraint('fk_training_session_program', 'training_sessions', type_='foreignkey')
    op.drop_column('training_sessions', 'program_id')

    op.drop_index('idx_training_session_category', table_name='training_sessions')
    op.drop_constraint('fk_training_session_category', 'training_sessions', type_='foreignkey')
    op.drop_column('training_sessions', 'category_id')
