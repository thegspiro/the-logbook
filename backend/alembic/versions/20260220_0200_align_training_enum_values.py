"""Align training ENUM values between frontend and backend

Revision ID: 20260220_0200
Revises: 20260220_0100
Create Date: 2026-02-20

Adds missing ENUM values so the backend model, database, and frontend
type definitions all agree:

- program_enrollments.status: add 'on_hold', 'failed'
- requirement_progress.status: add 'waived'
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260220_0200'
down_revision = '20260220_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # --- program_enrollments.status: add 'on_hold' and 'failed' ---
    result = conn.execute(sa.text("""
        SELECT COLUMN_TYPE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'program_enrollments'
        AND COLUMN_NAME = 'status'
    """))
    row = result.fetchone()
    if row:
        col_type = row[0]
        if 'on_hold' not in col_type or 'failed' not in col_type:
            conn.execute(sa.text("""
                ALTER TABLE program_enrollments
                MODIFY COLUMN status
                ENUM('active','completed','expired','on_hold','withdrawn','failed')
                NOT NULL DEFAULT 'active'
            """))

    # --- requirement_progress.status: add 'waived' ---
    result = conn.execute(sa.text("""
        SELECT COLUMN_TYPE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'requirement_progress'
        AND COLUMN_NAME = 'status'
    """))
    row = result.fetchone()
    if row:
        col_type = row[0]
        if 'waived' not in col_type:
            conn.execute(sa.text("""
                ALTER TABLE requirement_progress
                MODIFY COLUMN status
                ENUM('not_started','in_progress','completed','verified','waived')
                NOT NULL DEFAULT 'not_started'
            """))


def downgrade() -> None:
    conn = op.get_bind()

    # Revert program_enrollments.status
    result = conn.execute(sa.text("""
        SELECT COLUMN_TYPE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'program_enrollments'
        AND COLUMN_NAME = 'status'
    """))
    row = result.fetchone()
    if row and ('on_hold' in row[0] or 'failed' in row[0]):
        conn.execute(sa.text("""
            ALTER TABLE program_enrollments
            MODIFY COLUMN status
            ENUM('active','completed','expired','withdrawn')
            NOT NULL DEFAULT 'active'
        """))

    # Revert requirement_progress.status
    result = conn.execute(sa.text("""
        SELECT COLUMN_TYPE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'requirement_progress'
        AND COLUMN_NAME = 'status'
    """))
    row = result.fetchone()
    if row and 'waived' in row[0]:
        conn.execute(sa.text("""
            ALTER TABLE requirement_progress
            MODIFY COLUMN status
            ENUM('not_started','in_progress','completed','verified')
            NOT NULL DEFAULT 'not_started'
        """))
