"""Leave month rule on compliance configs

Revision ID: 5438939506b9
Revises: bbe101d29964
Create Date: 2026-11-02 16:06:00.000000

``compliance_configs`` gains ``leave_month_rule``: how a month that a leave of
absence or training waiver only partly covers reduces a member's target.

- ``full_month``   — any day of leave excuses the whole month.
- ``proportional`` — the month is excused by the share of its days on leave.
- ``half``         — 15 or more days on leave excuses half the month; a whole
  month on leave excuses all of it; fewer than 15 days excuses none.

Existing rows take ``full_month`` through the server default (owner decision
2026-11-02: full month is the default for every department). That is a change
in behaviour, not only a new column: before this revision a month was excused
only when leave covered 15 or more of its days. Safe to run twice. The
downgrade drops the column, which returns every department to the 15-day rule
the code before this revision applied.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5438939506b9"
down_revision: Union[str, None] = "bbe101d29964"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "compliance_configs"
COLUMN = "leave_month_rule"


def _column_state() -> tuple[bool, bool]:
    """(table exists, column exists)."""
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return False, False
    return True, COLUMN in {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    has_table, has_column = _column_state()
    if not has_table or has_column:
        return
    op.add_column(
        TABLE,
        sa.Column(
            COLUMN,
            sa.String(20),
            nullable=False,
            server_default="full_month",
            comment=(
                "How a partly-covered month reduces a target: full_month, "
                "proportional or half"
            ),
        ),
    )


def downgrade() -> None:
    if _column_state()[1]:
        op.drop_column(TABLE, COLUMN)
