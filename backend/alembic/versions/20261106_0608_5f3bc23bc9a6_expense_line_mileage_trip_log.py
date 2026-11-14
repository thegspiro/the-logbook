"""Expense lines carry a mileage trip log

Owner decision, 2026-11-01 (docs/KNOWN_LIMITATIONS.md, "Finance — Expense
Receipts: What the Requirement Does Not Cover"): a mileage line records its
trips in the form instead of uploading a log, and is priced from the miles at
the department's rate. Two nullable columns on ``expense_line_items``:

* ``mileage_trips`` (JSON) -- the trips, in the one shape
  ``app/services/expense_mileage.py`` writes;
* ``mileage_rate`` (NUMERIC(6,3)) -- the rate per mile the log was priced at,
  so a later change to the department's rate does not reprice a claimed line.

Nothing is backfilled: every existing line has no log and reads as an
ordinary line, which is what it is, and keeps the receipt it was submitted
with. The table may be built by ``create_all`` rather than a migration, so each
step is skipped when it is absent; ``create_all`` then builds it from the
model, columns included.

The downgrade drops both columns, and with them any trip logs recorded since:
a line priced from a log keeps its amount, but loses the trips that justified
it and, having no uploaded receipt, could not be submitted again until one is
attached.

Revision ID: 5f3bc23bc9a6
Revises: ba80cc574948
Create Date: 2026-11-06 06:08:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5f3bc23bc9a6"
down_revision: Union[str, None] = "ba80cc574948"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "expense_line_items"


def _columns() -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if columns is None:
        return
    if "mileage_trips" not in columns:
        op.add_column(TABLE, sa.Column("mileage_trips", sa.JSON(), nullable=True))
    if "mileage_rate" not in columns:
        op.add_column(TABLE, sa.Column("mileage_rate", sa.Numeric(6, 3), nullable=True))


def downgrade() -> None:
    columns = _columns()
    if columns is None:
        return
    if "mileage_rate" in columns:
        op.drop_column(TABLE, "mileage_rate")
    if "mileage_trips" in columns:
        op.drop_column(TABLE, "mileage_trips")
