"""Settle stored crew-seat names onto the signup vocabulary ("EMT" -> "ems").

The apparatus editor wrote the EMT seat as the literal ``"EMT"`` while every
other writer in the system used ``"ems"``. Because ``POSITION_LABELS`` renders
``EMT``, ``EMS`` and ``ems`` identically, the two read as one seat on screen and
were two different tokens in the database.

Nothing grants ``"EMT"``: not an operational rank's ``eligible_positions``, not
a held position, not a completed training program. ``ShiftEligibilityService``
intersects the member's granted seats with the shift's own seats
case-sensitively, so that intersection was always empty — and ``ShiftPosition``
has no ``EMT`` member either, so the signup API could not even name the seat.
An ambulance created from the built-in defaults (``["driver", "EMT"]``)
therefore had an EMT seat that no EMT could sign up for, and neither the
org-wide ``open_positions`` setting nor a shift's ``open_to_all_members`` flag
could unblock it.

``app/utils/positions.canonical_position`` now settles the name on every write.
This migration settles the rows already stored, which is the half a write-side
fix cannot do: an ambulance created last month keeps its unfillable seat until
its row is rewritten.

**Irreversible.** The downgrade is a no-op. ``"EMT"`` and ``"ems"`` both mean
the same seat and nothing records which spelling a row originally carried, so
rewriting every ``"ems"`` back to ``"EMT"`` would corrupt the rows that were
always correct — putting the seat back out of reach for exactly the members
this migration exists to serve, on a rollback that was meant to be a no-change.
Leaving the canonical spelling in place is the safe direction here.

Revision ID: d7a4e9c31b60
Revises: a1f7c34e9b02
Create Date: 2026-08-26 12:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d7a4e9c31b60"
down_revision = "a1f7c34e9b02"
branch_labels = None
depends_on = None


# --- frozen copy of the seat vocabulary, as of this revision ----------------
# Deliberately inlined rather than imported from app.utils.positions: a
# migration must keep transforming rows the way it did the day it ran, and that
# helper is free to change (CLAUDE.md pitfall #20).
_CANONICAL = {
    "officer",
    "driver",
    "firefighter",
    "ems",
    "captain",
    "lieutenant",
    "probationary",
    "volunteer",
    "other",
}
_ALIASES = {"emt": "ems"}

# table -> JSON column holding a crew-seat list.
_TARGETS = (
    ("basic_apparatus", "positions"),
    ("shifts", "positions"),
    ("shift_templates", "positions"),
    ("apparatus", "crew_positions"),
)


def _canonical(name: str) -> str:
    """Settle one seat name. Custom seats round-trip verbatim."""
    cleaned = (name or "").strip()
    if not cleaned:
        return ""
    folded = cleaned.casefold()
    if folded in _ALIASES:
        return _ALIASES[folded]
    if folded in _CANONICAL:
        return folded
    return cleaned


def _load(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        if not raw:
            return None
        return json.loads(raw)
    return raw


def _settle(value):
    """Return the seat list with names canonicalized, or None if unchanged.

    The stored *shape* is left exactly as found — a bare string stays a string,
    a ``{"position", "required"}`` object keeps its other keys. Only the seat
    name moves. Anything that is not a list (a shift template's event-resource
    metadata lives in this same column) passes through untouched, because
    flattening it would destroy the structure the event screens read.
    """
    if not isinstance(value, list):
        return None

    changed = False
    settled = []
    for entry in value:
        if isinstance(entry, str):
            name = _canonical(entry)
            if name != entry:
                changed = True
            settled.append(name)
        elif isinstance(entry, dict) and "position" in entry:
            raw_name = entry.get("position")
            name = _canonical(raw_name if isinstance(raw_name, str) else "")
            if name != raw_name:
                changed = True
                entry = {**entry, "position": name}
            settled.append(entry)
        else:
            settled.append(entry)
    return settled if changed else None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column in _TARGETS:
        # Guarded even though a migration creates each of these today: a
        # backfill has nothing to rewrite on a database that has not built the
        # table yet, and reflecting an absent one would take down the whole
        # upgrade rather than this one step (pitfall #26).
        if not _has_table(table):
            continue
        if column not in {c["name"] for c in inspector.get_columns(table)}:
            continue

        rows = bind.execute(
            sa.text(f"SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL")
        ).fetchall()

        for row in rows:
            settled = _settle(_load(row[1]))
            if settled is None:
                continue
            bind.execute(
                sa.text(f"UPDATE {table} SET {column} = :value WHERE id = :id"),
                {"value": json.dumps(settled), "id": row[0]},
            )


def downgrade() -> None:
    """No-op — see the irreversibility note in the module docstring."""
