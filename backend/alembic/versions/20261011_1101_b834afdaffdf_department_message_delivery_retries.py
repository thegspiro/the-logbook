"""Department message delivery retries (MSG-12)

A department message delivery that failed, or was never attempted because the
department's hourly escalation cap was reached, was final: the row said
``failed`` (or no row existed at all) and nothing ever tried again. Retries
need two facts per row, so this adds them:

* ``attempt_count`` — attempts made so far, the first included. Existing rows
  are given 1, which is what each of them represents.
* ``next_attempt_at`` — when a ``retrying`` row is next due. NULL for every
  existing row, so nothing already recorded is retried by this upgrade: a row
  that failed before it stays failed.

Plus an index on ``(status, next_attempt_at)`` for the scheduled retry scan.

Every step is guarded on the table and on the column/index already being
there, so a re-run and a database built by ``create_all`` are both no-ops.
The downgrade drops the index and both columns; any row then in the new
``retrying`` state is first written down as ``failed`` so the narrower code
does not find a status it has never heard of.

Revision ID: b834afdaffdf
Revises: 2cfc5a75105e
Create Date: 2026-10-11 11:01:27.716066

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b834afdaffdf"
down_revision: Union[str, None] = "2cfc5a75105e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "department_message_deliveries"
_INDEX = "idx_dept_msg_delivery_due"


def _has_table(bind, table: str) -> bool:
    return table in sa.inspect(bind).get_table_names()


def _columns(bind, table: str) -> set:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _indexes(bind, table: str) -> set:
    return {i["name"] for i in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_table(bind, _TABLE):
        return
    columns = _columns(bind, _TABLE)
    if "attempt_count" not in columns:
        op.add_column(
            _TABLE,
            sa.Column(
                "attempt_count", sa.Integer(), nullable=False, server_default="1"
            ),
        )
    if "next_attempt_at" not in columns:
        op.add_column(
            _TABLE,
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        )
    if _INDEX not in _indexes(bind, _TABLE):
        op.create_index(_INDEX, _TABLE, ["status", "next_attempt_at"])


def downgrade() -> None:
    bind = op.get_bind()
    if not _has_table(bind, _TABLE):
        return
    bind.execute(
        sa.text(f"UPDATE {_TABLE} SET status = 'failed' WHERE status = 'retrying'")
    )
    if _INDEX in _indexes(bind, _TABLE):
        op.drop_index(_INDEX, table_name=_TABLE)
    columns = _columns(bind, _TABLE)
    if "next_attempt_at" in columns:
        op.drop_column(_TABLE, "next_attempt_at")
    if "attempt_count" in columns:
        op.drop_column(_TABLE, "attempt_count")
