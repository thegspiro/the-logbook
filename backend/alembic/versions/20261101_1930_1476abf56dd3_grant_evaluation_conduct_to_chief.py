"""Grant evaluations.conduct and evaluations.view_all to the seeded Chief.

Both permissions are new: ``evaluations.conduct`` lets a member be assigned as
an evaluator and draft an evaluation they will conduct themselves;
``evaluations.view_all`` reads every member's evaluations and completes the
calibration step. ``OPERATIONAL_RANKS["fire_chief"]`` now carries both, and a
member holding the Chief *rank* gets them at runtime, but the system
``fire_chief`` *position* stores a copy of that list (CLAUDE.md pitfall #23),
so existing departments only get them on the position through this migration.

**Direction: adding, gated on the grant's own absence.** Neither permission
existed before this revision, so the position editor could never have offered
it and no department can have removed it on purpose. Absence is therefore
true of every seeded row and says nothing about a department's choice. Only
``is_system`` rows are touched; a position a department created is theirs.
The IT Manager holds ``*`` and needs nothing.

Idempotent: a row already carrying a grant is skipped. The downgrade takes
both grants back off the same seeded rows; a department that granted them to
the Chief position deliberately after the upgrade loses them too, the
unavoidable cost of reversing a grant nothing distinguishes from the seed.

Revision ID: 1476abf56dd3
Revises: 4262144ac214
Create Date: 2026-11-01 19:30:00.000000
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1476abf56dd3"
down_revision: Union[str, None] = "4262144ac214"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PERMISSIONS = ("evaluations.conduct", "evaluations.view_all")

# Frozen at this revision, not imported: a migration must keep targeting the
# rows it was written for after the registry moves on.
_SLUGS = ("fire_chief",)

# The same grants keyed by slug, the shape tests/test_storefront_grant_backfill.py
# reads from a later migration that adds several permissions at once.
_GRANTS = {slug: _PERMISSIONS for slug in _SLUGS}


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _rewrite(bind, mutate) -> None:
    for slug in _SLUGS:
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = :is_system"
            ),
            {"slug": slug, "is_system": True},
        ).fetchall()
        for row in rows:
            updated = mutate(_load_permissions(row.permissions))
            if updated is None:
                continue
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(updated), "id": row.id},
            )


def _add(permissions):
    missing = [p for p in _PERMISSIONS if p not in permissions]
    if not missing:
        return None
    return permissions + missing


def _remove(permissions):
    if not any(p in permissions for p in _PERMISSIONS):
        return None
    return [item for item in permissions if item not in _PERMISSIONS]


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
