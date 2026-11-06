"""A reversal keeps naming the amendment it reversed, even once rejected

Owner decision, 2026-11-01 ("Keep a display-only link"). Rejecting a pending
reversal clears ``reverses_amendment_id``, because that column's unique key
would otherwise stop the amendment from being reversed again. The rejected row
then read "Reverses an earlier amendment" without saying which.

* ``budget_amendments.reverses_amendment_ref`` -- the id of the amendment a
  reversal was entered against, written when the reversal is entered and never
  cleared. Display only: no foreign key and no unique key, so it holds nothing
  back and is never what the money arithmetic reads.

Existing rows are settled in the same step (CLAUDE.md pitfall #35):

* a reversal still linked copies its ``reverses_amendment_id``;
* a reversal whose link a rejection already cleared is recovered from the audit
  log, which recorded the pair on both events that name it
  (``finance.budget_amendment_reversed`` and
  ``finance.budget_amendment_rejected``). Only a negative row on the same line
  as the amendment the event names is filled; anything else in the event is
  ignored, so a stray or foreign id names nothing.

Every other row -- an ordinary amendment, or a reversal the audit log cannot
place -- keeps NULL, and the screen reads "an earlier amendment" for it as it
did before.

``budget_amendments`` may be built by ``create_all`` rather than a migration,
so each step is skipped when the table is absent; ``create_all`` then builds
it from the model, the column included. ``audit_logs`` is read only if present.

The downgrade drops the column. Nothing that moves money reads it; the audit
log keeps the pairs it was recovered from.

Revision ID: 0961ffc2cdf1
Revises: c6b690cc33d6
Create Date: 2026-11-06 04:32:37.469612

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0961ffc2cdf1"
down_revision: Union[str, None] = "c6b690cc33d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "budget_amendments"
AUDIT = "audit_logs"
COLUMN = "reverses_amendment_ref"
EVENTS = ("finance.budget_amendment_reversed", "finance.budget_amendment_rejected")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _pairs_from_audit(bind) -> dict[str, str]:
    """Reversal id -> the amendment it reversed, as the audit log recorded."""
    if not _has_table(AUDIT):
        return {}
    rows = bind.execute(
        sa.text(
            f"SELECT event_data FROM {AUDIT} WHERE event_type IN :events"
        ).bindparams(sa.bindparam("events", expanding=True)),
        {"events": list(EVENTS)},
    )
    pairs: dict[str, str] = {}
    for (raw,) in rows:
        data = raw
        if isinstance(raw, (bytes, str)):
            try:
                data = json.loads(raw)
            except ValueError:
                continue
        if not isinstance(data, dict):
            continue
        reversal = data.get("amendment_id")
        target = data.get("reversed_amendment_id")
        if isinstance(reversal, str) and isinstance(target, str) and target:
            pairs.setdefault(reversal, target)
    return pairs


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    if COLUMN not in _columns(TABLE):
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(36), nullable=True))

    bind = op.get_bind()
    bind.execute(
        sa.text(
            f"UPDATE {TABLE} SET {COLUMN} = reverses_amendment_id "
            f"WHERE reverses_amendment_id IS NOT NULL AND {COLUMN} IS NULL"
        )
    )

    unplaced = {
        row.id: row.budget_id
        for row in bind.execute(
            sa.text(
                f"SELECT id, budget_id FROM {TABLE} WHERE amount < 0 "
                f"AND reverses_amendment_id IS NULL AND {COLUMN} IS NULL"
            )
        )
    }
    if not unplaced:
        return
    pairs = {
        reversal: target
        for reversal, target in _pairs_from_audit(bind).items()
        if reversal in unplaced
    }
    if not pairs:
        return
    # Read separately rather than in the UPDATE: MySQL refuses a subquery on
    # the table being updated (error 1093).
    targets = {
        row.id: row.budget_id
        for row in bind.execute(
            sa.text(f"SELECT id, budget_id FROM {TABLE} WHERE id IN :ids").bindparams(
                sa.bindparam("ids", expanding=True)
            ),
            {"ids": sorted(set(pairs.values()))},
        )
    }
    for reversal, target in pairs.items():
        if targets.get(target) != unplaced[reversal]:
            continue
        bind.execute(
            sa.text(f"UPDATE {TABLE} SET {COLUMN} = :target WHERE id = :reversal"),
            {"target": target, "reversal": reversal},
        )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    if COLUMN in _columns(TABLE):
        op.drop_column(TABLE, COLUMN)
