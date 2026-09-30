"""Grant the seeded Quartermaster position inventory.check_manage.

The owner's decision on workflow review W46-14: the quartermaster manages the
stock (medical supplies included, unless a department appoints an EMS supply
officer), and the apparatus checklists are lists of that stock, so the
quartermaster builds them too. The registry change in
``app/core/permissions.py`` reaches only departments onboarded from now on;
``DEFAULT_POSITIONS`` is copied into ``positions`` at onboarding, so every
installation that has already onboarded keeps a quartermaster row without the
grant until this writes it (CLAUDE.md pitfall #23).

**Direction: an addition, so it is gated on evidence rather than applied to
every row** (``docs/rules/migrations.md``). ``is_system = True`` separates the
seeded positions from ones a department created and nothing more, because
``RoleService.update_role`` lets an administrator edit a system position's
permissions in place. A row is written only when it:

* is the system ``quartermaster`` position;
* still holds ``inventory.manage`` — the grant that makes it the department's
  stock position. A department that split the role and took inventory away
  from it is left as it chose;
* does not already cover checklist management by any spelling: the grant
  itself, the pre-rename ``equipment_check.manage`` / ``equipment_check.*``
  still honoured by ``LEGACY_PERMISSION_ALIASES``, ``inventory.*`` or ``*``.

Deliberately not a comparison against the row's whole stored list: that
snapshot is pinned to one build and silently skips rows written by any other
(``b4d1c8e37f52`` → ``c7a4e91d3b68``).

**What it costs when wrong.** No build ever seeded this grant on the
quartermaster, so a row lacking it is either untouched or was never given it.
The one case this overrides is a department that granted it and later took it
away again; the cost is a quartermaster who can build checklists until an
administrator removes it on the positions screen. Nothing is disclosed: the
grant authors checklists and does not read check results or member records.

Idempotent: a row that already holds the grant is skipped.

Guarded on the table existing, defensively: ``positions`` is built by the
migration chain (the initial ``roles`` table, renamed by 20260805_0008), so the
guard is not load-bearing.

Revision ID: f73b449bdb8b
Revises: 0ff2dfd2e9a2
Create Date: 2026-09-30 03:27:38.154120
"""

import json
from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f73b449bdb8b"
down_revision: Union[str, None] = "0ff2dfd2e9a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SLUG = "quartermaster"
_GRANT = "inventory.check_manage"
# The shape tests/test_storefront_grant_backfill.py reads off every later grant
# backfill, so its frozen snapshot can subtract what this adds.
_SLUGS = (_SLUG,)
_PERMISSION = _GRANT
# Frozen rather than imported (CLAUDE.md pitfall #20): the migration must keep
# recognising the rows it was written for after the registry moves on.
_REQUIRES = "inventory.manage"
_ALREADY_COVERED = frozenset(
    {
        _GRANT,
        "equipment_check.manage",
        "equipment_check.*",
        "inventory.*",
        "*",
    }
)


def _load_permissions(raw) -> list:
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def grant(permissions: Sequence[str]) -> Optional[list]:
    """The row with the grant appended, or None to leave it as it is."""
    held = set(permissions)
    if _REQUIRES not in held or held & _ALREADY_COVERED:
        return None
    return list(permissions) + [_GRANT]


def revoke(permissions: Sequence[str]) -> Optional[list]:
    """The row without the grant, or None when it does not hold it."""
    if _GRANT not in permissions:
        return None
    return [p for p in permissions if p != _GRANT]


def _rewrite(transform) -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    rows = bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = :slug AND is_system = :is_system"
        ),
        {"slug": _SLUG, "is_system": True},
    ).fetchall()
    for row in rows:
        updated = transform(_load_permissions(row.permissions))
        if updated is None:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(updated), "id": row.id},
        )


def upgrade() -> None:
    _rewrite(grant)


def downgrade() -> None:
    # Returns the seeded quartermaster to the grants it had before this
    # revision. It cannot tell a grant this wrote from one an administrator
    # added afterwards, so it removes either; a department that wants its
    # quartermaster to keep building checklists after a downgrade re-adds the
    # grant on the positions screen.
    _rewrite(revoke)
