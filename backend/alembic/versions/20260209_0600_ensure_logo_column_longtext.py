"""Ensure logo column is LONGTEXT (migration retry)

Revision ID: 20260209_0600
Revises: 20260208_1934
Create Date: 2026-02-09

This migration ensures the organizations.logo column is LONGTEXT.
This is a retry/insurance migration in case the previous fix didn't apply.
Uses idempotent raw SQL to safely change the column type.
"""
from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = '20260209_0600'
down_revision = '20260208_1934'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Ensure logo column is LONGTEXT using idempotent approach.

    This migration checks the current column type and only modifies
    it if it's not already LONGTEXT.
    """
    bind = op.get_bind()

    # Check current column type
    result = bind.execute(text("""
        SELECT COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'organizations'
        AND COLUMN_NAME = 'logo'
    """))

    row = result.fetchone()

    if row:
        current_type = row[0].lower()

        # Only modify if not already LONGTEXT
        if 'longtext' not in current_type:
            print(f"Updating logo column from {current_type} to LONGTEXT...")
            bind.execute(text(
                "ALTER TABLE organizations MODIFY COLUMN logo LONGTEXT"
            ))
            print("✓ Logo column updated to LONGTEXT")
        else:
            print("✓ Logo column already LONGTEXT, skipping")
    else:
        print("⚠ Logo column not found, skipping")


def downgrade() -> None:
    """
    Downgrade not implemented - keeping LONGTEXT is safe.

    We don't want to risk truncating data by downgrading
    from LONGTEXT to a smaller type.
    """
    pass
