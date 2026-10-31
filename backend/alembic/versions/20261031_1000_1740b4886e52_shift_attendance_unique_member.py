"""Shift attendance: one row per member per shift

Revision ID: 1740b4886e52
Revises: f90b1124e6f4
Create Date: 2026-10-31 10:00:00.000000

Adds ``uq_shift_attendance_shift_user`` on ``shift_attendance (shift_id,
user_id)`` (KNOWN_LIMITATIONS, "Scheduling — Left Open by the Shifts-Module
Review", item 5). The service paths already lock the shift and refuse a second
row; the constraint is what holds when two requests race past that check.

Rows already stored are settled first (CLAUDE.md Pitfall #35). For each
``(shift_id, user_id)`` holding more than one row, the earliest-created row is
kept and given:

- the earliest ``checked_in_at`` and the latest ``checked_out_at`` among the
  group, ignoring NULLs;
- the largest ``duration_minutes`` and the largest ``call_count``.

The largest duration, not the sum, because a duplicate is far more often the
same stint recorded twice (a check-in and an officer's close-out entry) than
two stints, and summing would double a member's credited hours. The other rows
are deleted. That deletion is not reversed by the downgrade, which removes only
the constraint: the merged-away rows carried nothing the kept row does not now
hold except their own ids.

Safe to run twice: the merge finds nothing on a second run and the constraint
is added only when absent. A table ``create_all`` has not built yet is skipped
(Pitfall #26) — it will be built from the model, which declares the constraint.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1740b4886e52"
down_revision: Union[str, None] = "f90b1124e6f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "shift_attendance"
CONSTRAINT = "uq_shift_attendance_shift_user"


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def _has_constraint() -> bool:
    inspector = sa.inspect(op.get_bind())
    names = {c["name"] for c in inspector.get_unique_constraints(TABLE)}
    names |= {i["name"] for i in inspector.get_indexes(TABLE) if i.get("unique")}
    return CONSTRAINT in names


def _merge_duplicates() -> None:
    bind = op.get_bind()
    groups = bind.execute(
        sa.text(
            "SELECT shift_id, user_id FROM shift_attendance "
            "GROUP BY shift_id, user_id HAVING COUNT(*) > 1"
        )
    ).fetchall()
    for shift_id, user_id in groups:
        rows = bind.execute(
            sa.text(
                "SELECT id, checked_in_at, checked_out_at, duration_minutes, "
                "call_count FROM shift_attendance "
                "WHERE shift_id = :s AND user_id = :u ORDER BY created_at, id"
            ),
            {"s": shift_id, "u": user_id},
        ).fetchall()
        keep, rest = rows[0], rows[1:]

        def pick(values, choose):
            present = [v for v in values if v is not None]
            return choose(present) if present else None

        bind.execute(
            sa.text(
                "UPDATE shift_attendance SET checked_in_at = :ci, "
                "checked_out_at = :co, duration_minutes = :dm, call_count = :cc "
                "WHERE id = :id"
            ),
            {
                "ci": pick([r[1] for r in rows], min),
                "co": pick([r[2] for r in rows], max),
                "dm": pick([r[3] for r in rows], max),
                "cc": pick([r[4] for r in rows], max),
                "id": keep[0],
            },
        )
        for row in rest:
            bind.execute(
                sa.text("DELETE FROM shift_attendance WHERE id = :id"),
                {"id": row[0]},
            )


def upgrade() -> None:
    if not _has_table() or _has_constraint():
        return
    _merge_duplicates()
    op.create_unique_constraint(CONSTRAINT, TABLE, ["shift_id", "user_id"])


def downgrade() -> None:
    if _has_table() and _has_constraint():
        op.drop_constraint(CONSTRAINT, TABLE, type_="unique")
