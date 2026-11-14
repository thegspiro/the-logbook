"""Finance requests record when their second approval was asked for

Owner decision, 2026-11-01: when a request is held by the dual-approval
threshold, the members who may give its second approval are emailed. Each
request is emailed about once, and the column that makes a second run a no-op
is recorded on the request itself:

* ``purchase_requests``, ``expense_reports``, ``check_requests``:
  ``second_approval_requested_at`` (nullable).

Nothing is backfilled. A request already held for its second approver on
upgrade keeps a null, and is not emailed retroactively: the approval that held
it has happened, and only a hold reached from now on sends the notice. Any of
these tables may be built by ``create_all`` rather than a migration, so each
step is skipped when its table is absent; ``create_all`` then builds it from
the model, column included.

The downgrade drops the column. Nothing else reads it.

Revision ID: ee9ff4596ce7
Revises: 50c94d5c30f8
Create Date: 2026-11-06 05:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ee9ff4596ce7"
down_revision: Union[str, None] = "50c94d5c30f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("purchase_requests", "expense_reports", "check_requests")
COLUMN = "second_approval_requested_at"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str) -> bool:
    return COLUMN in {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    for table in TABLES:
        if _has_table(table) and not _has_column(table):
            op.add_column(
                table,
                sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True),
            )


def downgrade() -> None:
    for table in TABLES:
        if _has_table(table) and _has_column(table):
            op.drop_column(table, COLUMN)
