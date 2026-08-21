"""Normalize crew seat lists to structured position slots

shifts.positions, shift_templates.positions and basic_apparatus.positions are
untyped JSON that three writers filled three different ways: bare strings
("officer") from onboarding and the pre-2026-08 scheduling UI, structured
{"position", "required"} objects from the current template form, and — on
shift_templates only — an event-metadata dict that is not a seat list at all.

Readers had to tell those apart by hand, and the templates screen did not: it
rendered each entry straight into a span, so a department with a template saved
by the current form got React error #31 instead of the page. The write paths
now normalize (app/utils/positions.py); this settles the rows already stored.

Rows are read and rewritten in Python rather than transformed in SQL: MySQL 8's
JSON functions cannot express "map a heterogeneous array" without a stored
procedure, and the row counts here are small (seats per shift, shifts per
department).

Event-template metadata (a JSON object rather than an array) is left exactly as
found — flattening it into seats would destroy the resource structure the event
screens read.

A ``count`` — the shape ShiftTemplate.positions documents, though no writer in
the app's history has produced one — expands into that many seats rather than
collapsing to one, so a hand-seeded three-firefighter template does not come
out of an irreversible migration requiring one.

Idempotent: an already-normalized array transforms to itself and is skipped
without an UPDATE, so a re-run is a no-op.

Not reversible: the legacy shapes carried strictly less information than the
structured one (a string cannot record required=False), so downgrade() would
have to guess which rows were strings. It leaves the data normalized, which
every reader — old and new — still understands.

Revision ID: 1eeb053d59b7
Revises: 2827079fd66c
Create Date: 2026-08-19
"""

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "1eeb053d59b7"
down_revision = "2827079fd66c"
branch_labels = None
depends_on = None

_TABLES = ("shifts", "shift_templates", "basic_apparatus")


def _normalize(positions: Any) -> Any:
    """Mirror of app.utils.positions.normalize_stored_positions.

    Inlined on purpose: a migration must keep transforming rows the way it did
    the day it ran, and the application helper is free to change.
    """
    if not isinstance(positions, list):
        return positions

    slots = []
    for entry in positions:
        if isinstance(entry, str):
            name = entry.strip()
            if name:
                slots.append({"position": name, "required": True})
        elif isinstance(entry, dict):
            name = str(entry.get("position") or "").strip()
            if name:
                slot = {
                    "position": name,
                    "required": entry.get("required") is not False,
                }
                for _ in range(_seat_count(entry.get("count"))):
                    slots.append(dict(slot))
    return slots


def _seat_count(count: Any) -> int:
    """How many seats one entry stands for. Anything unusable means one.

    Capped at 50 (the min_staffing ceiling): a longer list is corrupt data
    rather than a staffing plan.
    """
    if isinstance(count, bool) or not isinstance(count, int):
        return 1
    if count < 1:
        return 1
    return min(count, 50)


def _has_positions(bind, table: str) -> bool:
    """Fresh installs materialize model tables with create_all after
    migrations run, so an absent table simply has no legacy rows."""
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return False
    return "positions" in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()

    for table in _TABLES:
        if not _has_positions(bind, table):
            continue

        rows = bind.execute(
            sa.text(
                f"SELECT id, positions FROM {table} WHERE positions IS NOT NULL"  # noqa: S608
            )
        ).fetchall()

        for row_id, raw in rows:
            # MySQL returns JSON columns as str on some drivers and as the
            # decoded value on others.
            if isinstance(raw, (str, bytes, bytearray)):
                try:
                    value = json.loads(raw)
                except (ValueError, TypeError):
                    continue
            else:
                value = raw

            normalized = _normalize(value)
            if normalized == value:
                continue

            bind.execute(
                sa.text(
                    f"UPDATE {table} SET positions = :positions WHERE id = :id"  # noqa: S608
                ),
                {"positions": json.dumps(normalized), "id": row_id},
            )


def downgrade() -> None:
    """No-op — see the module docstring."""
