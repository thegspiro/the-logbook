"""Replace reminder_hours_before (Integer) with reminder_schedule (JSON array) on events and event_templates

Revision ID: 20260221_0600
Revises: 20260221_0500
Create Date: 2026-02-21 06:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260221_0600"
down_revision: Union[str, None] = "20260221_0500"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new JSON column with default [24]
    for table in ("events", "event_templates"):
        op.add_column(table, sa.Column("reminder_schedule", sa.JSON(), nullable=True))

        # Migrate existing integer value into a JSON array
        op.execute(
            f"""
            UPDATE {table}
            SET reminder_schedule = json_array(COALESCE(reminder_hours_before, 24))
            """
        )

        # Set NOT NULL now that data is populated
        op.alter_column(table, "reminder_schedule", nullable=False)

        # Drop old column
        op.drop_column(table, "reminder_hours_before")


def downgrade() -> None:
    for table in ("events", "event_templates"):
        op.add_column(
            table,
            sa.Column("reminder_hours_before", sa.Integer(), nullable=False, server_default="24"),
        )

        # Extract first value from JSON array back to integer
        op.execute(
            f"""
            UPDATE {table}
            SET reminder_hours_before = COALESCE(
                json_extract(reminder_schedule, '$[0]'),
                24
            )
            """
        )

        op.drop_column(table, "reminder_schedule")
