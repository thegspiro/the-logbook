"""Settle a stored "Paramedic" crew seat onto the now-canonical ``paramedic``.

``d7a4e9c31b60`` settled the seat vocabulary as it stood, and ``paramedic`` was
not in it: EMT and EMS were one seat, and a medic was not a seat at all. A
department that needed to staff an ALS unit had exactly one way to say so —
type a custom seat — and the obvious spelling is "Paramedic".

Only case variants of "paramedic" are folded, matching what
``canonical_position`` now does. "Medic" and other spellings a department chose
stay exactly as written: they remain custom seats at runtime, and rewriting
them here would rename somebody's seat and produce a token the application
never writes.

Adding ``paramedic`` to ``CANONICAL_POSITIONS`` makes ``canonical_position``
fold that spelling from now on, which is the same half-fix the EMT change
started with: every *new* write settles on ``paramedic`` while the ambulance
configured last month keeps its capital-P custom seat. The two then read
identically on screen (``POSITION_LABELS`` renders both "Paramedic") and are
different tokens in the database, which is precisely the state that made the
EMT seat unfillable.

It matters more here than a tidy-up, because the fold changes what the seat
*does*. A custom "Paramedic" seat is granted by nothing — no rank, no held
position, no program — so it could never be filled. Once folded it is a real
seat, fillable by any member holding a current paramedic certification. The
rows left behind are exactly the departments that wanted a medic seat badly
enough to hand-roll one.

**Irreversible.** The downgrade is a no-op, for the same reason
``d7a4e9c31b60``'s is: nothing records which spelling a row originally carried,
so rewriting every ``paramedic`` back to "Paramedic" would corrupt the rows
that were always correct and put the seat back out of reach.

Revision ID: e2c8f5a71d40
Revises: b3d7e1a45c92
Create Date: 2026-08-26 14:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "e2c8f5a71d40"
down_revision = "b3d7e1a45c92"
branch_labels = None
depends_on = None


# --- frozen, as of this revision (pitfall #20) ------------------------------
# Only the seat this revision adds to the vocabulary, and only the spellings
# ``canonical_position`` itself now folds -- case variants of "paramedic" and
# nothing else. The spellings d7a4e9c31b60 settled ("EMT" -> "ems") are an
# ancestor of this revision and already settled by the time it runs, so
# re-folding them here would only make this migration's result depend on that
# one having run.
#
# "Medic" is deliberately NOT folded. ``canonical_position`` returns it
# verbatim as a department's own custom seat, and
# ``test_a_departments_custom_seat_round_trips_verbatim`` pins that. Folding it
# here would rewrite stored rows into a spelling the runtime does not produce,
# manufacturing the very drift this migration exists to remove -- and renaming
# a seat the department chose, which is the thing custom positions are
# explicitly protected from.
_CANONICAL_SEAT = "paramedic"

# table -> JSON column holding a crew-seat list. Same four as d7a4e9c31b60.
_TARGETS = (
    ("basic_apparatus", "positions"),
    ("shifts", "positions"),
    ("shift_templates", "positions"),
    ("apparatus", "crew_positions"),
)


def _canonical(name: str) -> str:
    """Fold a case variant of "paramedic"; leave every other seat as found."""
    cleaned = (name or "").strip()
    if not cleaned:
        return cleaned
    if cleaned.casefold() == _CANONICAL_SEAT:
        return _CANONICAL_SEAT
    return cleaned


def _load(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        if not raw:
            return None
        return json.loads(raw)
    return raw


def _settle(value):
    """Return the seat list with medic names folded, or None if unchanged.

    The stored *shape* is left exactly as found, and anything that is not a
    list passes through — a shift template's event-resource metadata lives in
    this same column and flattening it would destroy what the event screens
    read.
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
        # Guarded on the table: a backfill has nothing to rewrite on a database
        # that has not built it yet, and reflecting an absent table takes down
        # the whole upgrade rather than this step (pitfall #26).
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
