"""Add membership_id column to users table

Adds a membership_id field to the users table for sequential
department membership IDs. Includes a unique index per organization.

Revision ID: 20260216_0100
Revises: 20260215_0200
Create Date: 2026-02-16

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260216_0100'
down_revision = '20260215_0200'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('membership_id', sa.String(50), nullable=True))
    op.create_index(
        'idx_user_org_membership_id',
        'users',
        ['organization_id', 'membership_id'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('idx_user_org_membership_id', table_name='users')
    op.drop_column('users', 'membership_id')
