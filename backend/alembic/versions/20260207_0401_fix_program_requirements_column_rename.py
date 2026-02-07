"""Fix program_requirements column rename to be idempotent

Revision ID: 20260207_0401
Revises: 20260207_0400
Create Date: 2026-02-07

Fixes the issue where migration 20260206_0300 fails if the is_mandatory
column doesn't exist or was already renamed. This migration safely handles
both cases by checking column existence before attempting to rename.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '20260207_0401'
down_revision = '20260207_0400'
branch_labels = None
depends_on = None


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    """
    Fix program_requirements column names if they haven't been renamed yet.

    This migration is idempotent - it only renames columns if they exist
    with the old name and don't exist with the new name.
    """
    # Check if table exists
    conn = op.get_bind()
    inspector = inspect(conn)
    tables = inspector.get_table_names()

    if 'program_requirements' not in tables:
        # Table doesn't exist yet, skip this migration
        return

    # Rename is_mandatory -> is_required (only if not already done)
    if column_exists('program_requirements', 'is_mandatory') and \
       not column_exists('program_requirements', 'is_required'):
        op.alter_column(
            'program_requirements',
            'is_mandatory',
            new_column_name='is_required',
            existing_type=sa.Boolean(),
            existing_nullable=True,
            existing_server_default='1',
        )
    elif not column_exists('program_requirements', 'is_required'):
        # Neither column exists, add is_required
        op.add_column(
            'program_requirements',
            sa.Column('is_required', sa.Boolean(), nullable=True, server_default='1'),
        )

    # Rename order -> sort_order (only if not already done)
    if column_exists('program_requirements', 'order') and \
       not column_exists('program_requirements', 'sort_order'):
        op.alter_column(
            'program_requirements',
            'order',
            new_column_name='sort_order',
            existing_type=sa.Integer(),
            existing_nullable=True,
        )
    elif not column_exists('program_requirements', 'sort_order'):
        # Neither column exists, add sort_order
        op.add_column(
            'program_requirements',
            sa.Column('sort_order', sa.Integer(), nullable=True),
        )

    # Add missing columns if they don't exist
    if not column_exists('program_requirements', 'is_prerequisite'):
        op.add_column(
            'program_requirements',
            sa.Column('is_prerequisite', sa.Boolean(), nullable=True, server_default='0'),
        )

    if not column_exists('program_requirements', 'program_specific_description'):
        op.add_column(
            'program_requirements',
            sa.Column('program_specific_description', sa.Text(), nullable=True),
        )

    if not column_exists('program_requirements', 'custom_deadline_days'):
        op.add_column(
            'program_requirements',
            sa.Column('custom_deadline_days', sa.Integer(), nullable=True),
        )

    if not column_exists('program_requirements', 'notification_message'):
        op.add_column(
            'program_requirements',
            sa.Column('notification_message', sa.Text(), nullable=True),
        )


def downgrade() -> None:
    """
    Revert changes - remove added columns and rename back to original names.
    """
    # Check if table exists
    conn = op.get_bind()
    inspector = inspect(conn)
    tables = inspector.get_table_names()

    if 'program_requirements' not in tables:
        return

    # Remove added columns if they exist
    if column_exists('program_requirements', 'notification_message'):
        op.drop_column('program_requirements', 'notification_message')

    if column_exists('program_requirements', 'custom_deadline_days'):
        op.drop_column('program_requirements', 'custom_deadline_days')

    if column_exists('program_requirements', 'program_specific_description'):
        op.drop_column('program_requirements', 'program_specific_description')

    if column_exists('program_requirements', 'is_prerequisite'):
        op.drop_column('program_requirements', 'is_prerequisite')

    # Rename columns back
    if column_exists('program_requirements', 'sort_order') and \
       not column_exists('program_requirements', 'order'):
        op.alter_column(
            'program_requirements',
            'sort_order',
            new_column_name='order',
            existing_type=sa.Integer(),
            existing_nullable=True,
        )

    if column_exists('program_requirements', 'is_required') and \
       not column_exists('program_requirements', 'is_mandatory'):
        op.alter_column(
            'program_requirements',
            'is_required',
            new_column_name='is_mandatory',
            existing_type=sa.Boolean(),
            existing_nullable=True,
            existing_server_default='1',
        )
