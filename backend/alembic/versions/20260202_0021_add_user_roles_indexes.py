"""Add missing indexes to user_roles table

Revision ID: 20260202_0021
Revises: 20260202_0020
Create Date: 2026-02-02

Adds indexes needed for efficient role-based queries:
- idx_user_roles_role_id: For "get all users with role X" queries
- idx_user_roles_assigned_by: For audit queries
- idx_user_roles_assigned_at: For time-based queries
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260202_0021'
down_revision = '20260202_0020'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add index on role_id for efficient "get users by role" queries
    # The existing unique index (user_id, role_id) can't be used for role_id-only lookups
    op.create_index('idx_user_roles_role_id', 'user_roles', ['role_id'])

    # Add index on assigned_by for audit queries ("who assigned this role?")
    op.create_index('idx_user_roles_assigned_by', 'user_roles', ['assigned_by'])

    # Add index on assigned_at for time-based queries ("recent role assignments")
    op.create_index('idx_user_roles_assigned_at', 'user_roles', ['assigned_at'])


def downgrade() -> None:
    op.drop_index('idx_user_roles_assigned_at', table_name='user_roles')
    op.drop_index('idx_user_roles_assigned_by', table_name='user_roles')
    op.drop_index('idx_user_roles_role_id', table_name='user_roles')
