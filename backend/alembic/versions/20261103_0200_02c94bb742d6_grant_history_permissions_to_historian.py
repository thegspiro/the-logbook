"""Grant the history permissions to the seeded Historian position.

``history.view``, ``history.manage`` and ``history.publish`` are new, with the
History module. ``DEFAULT_POSITIONS`` grants all three to the Historian, but
that only reaches departments onboarded after this deploy — every existing
installation keeps the permission list its positions were seeded with
(CLAUDE.md pitfall #23). This carries the grants to the stored rows, so a
department that turns the module on finds its Historian able to use it.

**Direction: adding, gated on each grant's own absence**, as ``394600cbfae2``
did. No department can have removed these: the permissions did not exist
before this revision, so the position editor could never have offered them.
Their absence is true of every seeded row and says nothing about a
department's choice. Only ``is_system`` rows are touched; a position a
department created is theirs.

**Also rejoins two heads.** ``main`` reached this revision with two heads,
``5438939506b9`` and ``b840c0d2b961`` — two merge revisions of the same pair
landed independently — so this revision takes both as its parents. Neither
parent changes anything a grant depends on.

Idempotent: a grant already present is not added twice. The downgrade takes
the three grants back off the same seeded rows; a department that granted one
deliberately after the upgrade loses it too, which is the unavoidable cost of
reversing a grant nothing distinguishes from the seed.

Revision ID: 02c94bb742d6
Revises: 5438939506b9, b840c0d2b961
Create Date: 2026-11-03 02:00:42.291405
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "02c94bb742d6"
down_revision: Union[str, Sequence[str], None] = ("5438939506b9", "b840c0d2b961")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen at this revision, not imported: a migration must keep targeting the
# rows and grants it was written for after the registry moves on.
_SLUG = "historian"
_PERMISSIONS = ("history.view", "history.manage", "history.publish")


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _rewrite(bind, mutate) -> None:
    rows = bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = :slug AND is_system = :is_system"
        ),
        {"slug": _SLUG, "is_system": True},
    ).fetchall()
    for row in rows:
        current = _load_permissions(row.permissions)
        updated = mutate(current)
        if updated == current:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(updated), "id": row.id},
        )


def _add(permissions):
    return permissions + [p for p in _PERMISSIONS if p not in permissions]


def _remove(permissions):
    return [p for p in permissions if p not in _PERMISSIONS]


def upgrade() -> None:
    bind = op.get_bind()
    # Defensive only: ``positions`` is built by the migration chain (renamed
    # from ``roles`` in 20260805_0008), so it exists by the time this runs.
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    _rewrite(bind, _add)


def downgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    _rewrite(bind, _remove)
