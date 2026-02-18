"""Add passing_score and max_attempts columns to training_requirements

Revision ID: 20260218_0100
Revises: 20260216_0300
Create Date: 2026-02-18

Adds columns required for the KNOWLEDGE_TEST requirement type:
- passing_score (Float): minimum passing percentage
- max_attempts (Integer): maximum number of attempts allowed

Also adds 'knowledge_test' to the requirement_type MySQL ENUM.

These columns were defined in the SQLAlchemy model but never added
via migration, causing OperationalError on queries that select them.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260218_0100'
down_revision = '20260216_0300'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Check which columns already exist (idempotent for fast-path databases)
    result = conn.execute(sa.text("""
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'training_requirements'
        AND COLUMN_NAME IN ('passing_score', 'max_attempts')
    """))
    existing_columns = {row[0] for row in result}

    if 'passing_score' not in existing_columns:
        op.add_column(
            'training_requirements',
            sa.Column('passing_score', sa.Float(), nullable=True),
        )

    if 'max_attempts' not in existing_columns:
        op.add_column(
            'training_requirements',
            sa.Column('max_attempts', sa.Integer(), nullable=True),
        )

    # Add 'knowledge_test' to the requirement_type ENUM if not already present.
    # MySQL ENUMs must be modified with ALTER TABLE ... MODIFY COLUMN.
    result = conn.execute(sa.text("""
        SELECT COLUMN_TYPE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'training_requirements'
        AND COLUMN_NAME = 'requirement_type'
    """))
    row = result.fetchone()
    if row:
        col_type = row[0]
        if 'knowledge_test' not in col_type:
            conn.execute(sa.text("""
                ALTER TABLE training_requirements
                MODIFY COLUMN requirement_type
                ENUM('hours','courses','certification','shifts','calls',
                     'skills_evaluation','checklist','knowledge_test')
                NOT NULL DEFAULT 'hours'
            """))


def downgrade() -> None:
    conn = op.get_bind()

    # Revert ENUM to remove 'knowledge_test'
    result = conn.execute(sa.text("""
        SELECT COLUMN_TYPE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'training_requirements'
        AND COLUMN_NAME = 'requirement_type'
    """))
    row = result.fetchone()
    if row and 'knowledge_test' in row[0]:
        conn.execute(sa.text("""
            ALTER TABLE training_requirements
            MODIFY COLUMN requirement_type
            ENUM('hours','courses','certification','shifts','calls',
                 'skills_evaluation','checklist')
            NOT NULL DEFAULT 'hours'
        """))

    op.drop_column('training_requirements', 'max_attempts')
    op.drop_column('training_requirements', 'passing_score')
