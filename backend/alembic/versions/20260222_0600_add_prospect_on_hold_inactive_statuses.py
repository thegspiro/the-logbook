"""Add on_hold and inactive statuses to prospect_status enum

Adds the missing on_hold and inactive values to the ProspectStatus
enum so the backend matches the frontend status options.

Revision ID: 20260222_0600
Revises: 20260222_0500
Create Date: 2026-02-22 06:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260222_0600"
down_revision: Union[str, None] = "20260222_0500"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # For SQLite (used in dev/test), enums are stored as plain strings
    # so no DDL change is needed. For PostgreSQL, we need to add enum values.
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        # Add new values to the existing enum type
        op.execute("ALTER TYPE prospectstatus ADD VALUE IF NOT EXISTS 'on_hold'")
        op.execute("ALTER TYPE prospectstatus ADD VALUE IF NOT EXISTS 'inactive'")
    # SQLite and MySQL store enums as strings; no DDL change needed.


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values easily.
    # Any rows with on_hold/inactive would need to be migrated first.
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        # Update any rows using the new statuses back to 'withdrawn'
        op.execute(
            "UPDATE prospective_members SET status = 'withdrawn' "
            "WHERE status IN ('on_hold', 'inactive')"
        )
