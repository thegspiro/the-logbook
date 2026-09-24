"""Grant suggestions.manage to the seeded officer positions.

``suggestions.manage`` is new: it lets a holder create suggestion boxes and
choose their reviewers. ``DEFAULT_POSITIONS`` now grants it to the Fire Chief,
Deputy Chief, Assistant Chief, President and Communications Officer, but that
only reaches departments onboarded after this deploy — every existing
installation keeps the permission list its positions were seeded with
(CLAUDE.md pitfall #23). This carries the grant to the stored rows.

**Direction: adding, gated on the grant's own absence.** The rule in
``docs/rules/migrations.md`` is that an addition needs positive evidence the
row is an unrepaired seed, because an unconditional add would override a
department that removed the grant on purpose. No department can have removed
this one: the permission did not exist before this revision, so the position
editor could never have offered it. Its absence is therefore true of every
seeded row and says nothing about a department's choice, and it cannot drift
the way a whole-list snapshot does. Only ``is_system`` rows are touched; a
position a department created is theirs.

The chief ranks resolve their defaults from the registry at runtime, so they
need no data change here.

Idempotent: a row already carrying the grant is skipped. The downgrade takes
the grant back off the same seeded rows; a department that granted it to one of
those positions deliberately after the upgrade loses it too, which is the
unavoidable cost of reversing a grant nothing distinguishes from the seed.

Revision ID: 394600cbfae2
Revises: 80e2004cd691
Create Date: 2026-09-23 22:19:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "394600cbfae2"
down_revision = "80e2004cd691"
branch_labels = None
depends_on = None

_PERMISSION = "suggestions.manage"

# Frozen at this revision, not imported: a migration must keep targeting the
# rows it was written for after the registry moves on.
_SLUGS = (
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "president",
    "communications_officer",
)


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
    if _PERMISSION in permissions:
        return None
    return permissions + [_PERMISSION]


def _remove(permissions):
    if _PERMISSION not in permissions:
        return None
    return [item for item in permissions if item != _PERMISSION]


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
