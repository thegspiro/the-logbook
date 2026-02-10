"""Fix user_roles table to use composite primary key

Revision ID: 20260210_0600
Revises: 20260209_0600
Create Date: 2026-02-10

Removes the unnecessary 'id' column from user_roles table and replaces it
with a composite primary key on (user_id, role_id). This is the standard
pattern for many-to-many association tables and fixes the issue where
SQLAlchemy's relationship handling couldn't auto-generate the id value.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260210_0600'
down_revision = '20260209_0600'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the existing primary key constraint
    op.drop_constraint('PRIMARY', 'user_roles', type_='primary')

    # Drop the id column
    op.drop_column('user_roles', 'id')

    # Create composite primary key on (user_id, role_id)
    op.create_primary_key('pk_user_roles', 'user_roles', ['user_id', 'role_id'])

    # Note: The unique index idx_user_role is now redundant with the primary key
    # but we'll leave it for now to avoid breaking existing code


def downgrade() -> None:
    # Drop the composite primary key
    op.drop_constraint('pk_user_roles', 'user_roles', type_='primary')

    # Add back the id column
    op.add_column('user_roles', sa.Column('id', sa.String(36), nullable=False))

    # Recreate the original primary key on id
    op.create_primary_key('PRIMARY', 'user_roles', ['id'])

    # Note: Manual intervention may be required to populate id values
    # if there's existing data in the table
