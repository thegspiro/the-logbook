"""Add on_hold and inactive to prospect status enum

Adds ON_HOLD and INACTIVE values to the prospective_members.status
ENUM column so the frontend on-hold and inactivity workflows map
directly to backend statuses instead of being aliased to 'withdrawn'.

Revision ID: 20260222_0600
Revises: 20260222_0500
Create Date: 2026-02-22 06:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260222_0600"
down_revision: Union[str, None] = "20260222_0500"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Old and new enum values
OLD_VALUES = ("active", "approved", "rejected", "withdrawn", "transferred")
NEW_VALUES = ("active", "on_hold", "approved", "rejected", "withdrawn", "inactive", "transferred")


def upgrade() -> None:
    # MySQL ALTER TABLE to extend the ENUM
    new_enum = ", ".join(f"'{v}'" for v in NEW_VALUES)
    op.execute(
        f"ALTER TABLE prospective_members MODIFY COLUMN status ENUM({new_enum}) NOT NULL DEFAULT 'active'"
    )


def downgrade() -> None:
    # Convert on_hold → active and inactive → withdrawn before shrinking the enum
    op.execute("UPDATE prospective_members SET status = 'active' WHERE status = 'on_hold'")
    op.execute("UPDATE prospective_members SET status = 'withdrawn' WHERE status = 'inactive'")

    old_enum = ", ".join(f"'{v}'" for v in OLD_VALUES)
    op.execute(
        f"ALTER TABLE prospective_members MODIFY COLUMN status ENUM({old_enum}) NOT NULL DEFAULT 'active'"
    )
