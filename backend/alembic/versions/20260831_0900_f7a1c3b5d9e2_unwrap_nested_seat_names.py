"""Unwrap crew seats whose name is itself a seat object.

The templates form changed the event-metadata key ``flat_positions`` from a
list of names to a list of seat objects, while the reader that flattens that
metadata into concrete shifts still bound each entry in as the *name*. Every
shift generated from an event-category template therefore stored
``{"position": {"position": "officer", ...}, "required": true}`` — a seat no
member can be assigned to, and one that fails ``ShiftResponse`` validation, so
a single such row returns 500 for the whole scheduling calendar page.

The wrapper carried no information of its own, so unwrapping restores the seat
exactly. Irreversible in the sense that the downgrade does not put the wrapper
back: re-nesting would only reinstate the 500.

Revision ID: f7a1c3b5d9e2
Revises: e1f2a3b4c5d6
Create Date: 2026-08-31 09:00:00
"""

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "f7a1c3b5d9e2"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None

# ``shifts`` is where pattern generation writes; the other two are covered
# because the same nested entry can reach them through a copied template.
#
# All three ARE created by the migration chain — ``shifts`` by 20260122_0015,
# ``shift_templates`` by 20260214_2200, ``basic_apparatus`` by 20260218_0200,
# every one of them an ancestor of this revision — so the guards below are
# defensive rather than load-bearing. An earlier version of this comment
# claimed none of them was, which is the false positive CLAUDE.md pitfall #26
# records being reverted. They are kept because a reflection costs nothing and
# cannot be wrong, but this is not the pattern to copy for a genuinely
# create_all-only table.
_TABLES = ("shifts", "shift_templates", "basic_apparatus")


def _unwrap(value: Any) -> Any:
    """Flatten one level of seat-inside-seat, leaving everything else alone."""
    if not isinstance(value, list):
        return value
    settled = []
    for entry in value:
        if isinstance(entry, dict) and isinstance(entry.get("position"), dict):
            inner = entry["position"]
            name = inner.get("position")
            if not isinstance(name, str) or not name.strip():
                # Nothing recoverable: an unnamed seat cannot be filled and
                # only inflates the staffing target.
                continue
            settled.append(
                {
                    "position": name,
                    # The wrapper's own ``required`` was a hardcoded True, so
                    # the inner flag is the one the admin actually chose.
                    "required": inner.get("required") is not False,
                    "allow_administrative_members": inner.get(
                        "allow_administrative_members"
                    )
                    is True,
                }
            )
        else:
            settled.append(entry)
    return settled


def _load(raw: Any) -> Any:
    if isinstance(raw, (str, bytes, bytearray)):
        return json.loads(raw)
    return raw


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table in _TABLES:
        if table not in tables:
            continue
        rows = bind.execute(
            sa.text(
                f"SELECT id, positions FROM {table} WHERE positions IS NOT NULL"  # noqa: S608, E501
            )
        ).fetchall()
        for row_id, raw in rows:
            try:
                value = _load(raw)
            except (TypeError, ValueError):
                continue
            settled = _unwrap(value)
            if settled == value:
                continue
            bind.execute(
                sa.text(
                    f"UPDATE {table} SET positions = :positions WHERE id = :id"  # noqa: S608, E501
                ),
                {"positions": json.dumps(settled), "id": row_id},
            )


def downgrade() -> None:
    """No-op: re-nesting a seat name would only restore the 500."""
