"""Add archived status and archived_at column

Revision ID: 20260214_0700
Revises: 20260214_0600
Create Date: 2026-02-14

Adds 'archived' to the user_status enum and an archived_at column
to track when a dropped member was archived after returning all property.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_0700'
down_revision = '20260214_0600'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add 'archived' to UserStatus enum
    op.execute(
        "ALTER TABLE users MODIFY COLUMN status "
        "ENUM('active','inactive','suspended','probationary','retired',"
        "'dropped_voluntary','dropped_involuntary','archived') "
        "NOT NULL DEFAULT 'active'"
    )

    # Add archived_at column to users
    op.add_column('users', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'archived_at')

    op.execute(
        "ALTER TABLE users MODIFY COLUMN status "
        "ENUM('active','inactive','suspended','probationary','retired',"
        "'dropped_voluntary','dropped_involuntary') "
        "NOT NULL DEFAULT 'active'"
    )
