"""Add recurrence weekday/ordinal/month columns to events table

Revision ID: 20260312_0100
Revises: 20260308_0300
Create Date: 2026-03-12

Adds columns for monthly-by-weekday and annual-by-weekday recurrence
patterns (e.g., "2nd Monday of every month", "4th Monday of July").
Also extends the recurrence_pattern enum with new values.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260312_0100'
down_revision = '20260308_0300'
branch_labels = None
depends_on = None


def _column_exists(conn, table, column):
    result = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.scalar() > 0


def upgrade():
    conn = op.get_bind()

    if not _column_exists(conn, "events", "recurrence_weekday"):
        op.add_column(
            "events",
            sa.Column("recurrence_weekday", sa.Integer(), nullable=True),
        )

    if not _column_exists(conn, "events", "recurrence_week_ordinal"):
        op.add_column(
            "events",
            sa.Column("recurrence_week_ordinal", sa.Integer(), nullable=True),
        )

    if not _column_exists(conn, "events", "recurrence_month"):
        op.add_column(
            "events",
            sa.Column("recurrence_month", sa.Integer(), nullable=True),
        )

    # Extend the recurrence_pattern enum to include new values.
    # MySQL ALTER COLUMN MODIFY to expand enum values.
    try:
        op.execute(
            "ALTER TABLE events MODIFY COLUMN recurrence_pattern "
            "ENUM('daily','weekly','biweekly','monthly','monthly_weekday',"
            "'annually','annually_weekday','custom') NULL"
        )
    except Exception:
        # Non-MySQL databases or enum already updated
        pass


def downgrade():
    op.drop_column("events", "recurrence_month")
    op.drop_column("events", "recurrence_week_ordinal")
    op.drop_column("events", "recurrence_weekday")
