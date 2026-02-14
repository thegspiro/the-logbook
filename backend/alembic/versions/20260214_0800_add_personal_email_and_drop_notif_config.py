"""Add personal_email column to users table

Revision ID: 20260214_0800
Revises: 20260214_0700
Create Date: 2026-02-14

Adds personal_email field to users table for post-separation contact.
Drop notification settings (CC roles, extra emails, personal email toggle)
are stored in the organization's JSON settings column and require no migration.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_0800'
down_revision = '20260214_0700'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('personal_email', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'personal_email')
