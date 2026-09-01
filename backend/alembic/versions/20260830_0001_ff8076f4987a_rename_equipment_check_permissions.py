"""Rename equipment_check.* permissions to inventory.check_*

Equipment checklists moved from the Scheduling module to Inventory. The
permission strings moved with them, because a checklist is a list of inventory
items: ``check_template_items`` carries an ``inventory_item_id`` into the
catalog and ``check_item_deployed_lots`` snapshots ``inventory_lots``.

``positions.permissions`` is the only place a permission string is persisted,
so it is the only thing this migration rewrites.

Unlike a grant *removal* — which scopes to ``is_system = 1`` because a
department's customized position is theirs to keep (CLAUDE.md pitfall #23) —
this is a **rename**, and the old string ceases to resolve. Scoping to system
rows would silently strip the grant from every position a department built for
itself. So every row is rewritten, system or not: the authority each position
carries is unchanged, only its spelling.

``app.core.permissions.LEGACY_PERMISSION_ALIASES`` covers whatever this cannot
reach — a database restored from an older backup, a row written by an
integration still using the old vocabulary — so the two together make the
rename safe rather than merely tidy.

Revision ID: 20260830_0001
Revises: f6a7b8c9d0e1
Create Date: 2026-08-30 00:01:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "ff8076f4987a"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


# Old string -> new string. The module wildcard is renamed too: the module
# segment itself changed, so a stored ``equipment_check.*`` would otherwise
# match nothing at all.
_RENAMES = {
    "equipment_check.view": "inventory.check_view",
    "equipment_check.manage": "inventory.check_manage",
    "equipment_check.submit": "inventory.check_submit",
}
_WILDCARD = "equipment_check.*"
_WILDCARD_REPLACEMENTS = (
    "inventory.check_view",
    "inventory.check_manage",
    "inventory.check_submit",
)

_REVERSE = {new: old for old, new in _RENAMES.items()}


def _rewrite(mapping: dict, wildcard: str | None, wildcard_to: tuple) -> None:
    """Rewrite every ``positions.permissions`` row through *mapping*."""
    bind = op.get_bind()
    # Defensive only. ``positions`` IS created by the migration chain — the
    # initial schema builds ``roles``, and 20260805_0008 renames it, which
    # makes that rename a required ancestor of this revision. An earlier
    # version of this comment claimed the opposite ("model-only table,
    # materialized by startup create_all"), which is the exact false positive
    # CLAUDE.md pitfall #26 records being reverted on 2026-08-31 after an
    # empirical `alembic upgrade head` against an empty database showed the
    # table already present. Verified again here the same way.
    #
    # The guard is kept because it costs one reflection and cannot be wrong,
    # but it is not load-bearing, and it is not the pattern to copy for a
    # genuinely create_all-only table — for those the guard is required.
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    rows = bind.execute(sa.text("SELECT id, permissions FROM positions")).fetchall()
    for row in rows:
        perms = row.permissions
        if isinstance(perms, str):
            perms = json.loads(perms or "[]")
        perms = list(perms or [])
        if not perms:
            continue

        rewritten: list[str] = []
        for perm in perms:
            if wildcard is not None and perm == wildcard:
                rewritten.extend(wildcard_to)
            else:
                rewritten.append(mapping.get(perm, perm))

        # Order-preserving de-duplication: expanding a wildcard can collide
        # with a grant the row already listed explicitly.
        deduped: list[str] = []
        for perm in rewritten:
            if perm not in deduped:
                deduped.append(perm)

        if deduped == perms:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
            {"perms": json.dumps(deduped), "id": row.id},
        )


def upgrade() -> None:
    _rewrite(_RENAMES, _WILDCARD, _WILDCARD_REPLACEMENTS)


def downgrade() -> None:
    # Lossy in one direction only: a row that stored ``equipment_check.*``
    # comes back as the three explicit grants rather than the wildcard. The
    # authority is identical — the wildcard covered exactly these three — so
    # nothing a member can do changes.
    _rewrite(_REVERSE, None, ())
