"""Grant equipment_check.submit to existing member positions

EC-7 tightened the equipment-check read endpoints from bare
authentication to require_permission("equipment_check.view",
"equipment_check.submit") (OR logic). The default member position now
carries equipment_check.submit so the member check-performing flow
keeps working — but positions are seeded at org creation, so existing
organizations' member positions must be backfilled or their members
would lose access to the checklist/check read endpoints on deploy.

Only the system member position (slug='member', is_system=1) is
touched, and only when the permission is absent. Downgrade removes the
permission again from those same rows.

Revision ID: 20260801_0010
Revises: 20260801_0009
Create Date: 2026-08-01 00:10:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260801_0010"
down_revision = "20260801_0009"
branch_labels = None
depends_on = None

_PERMISSION = "equipment_check.submit"
# A wildcard grant already covers submit; don't clutter the list.
_COVERING = ("*", "equipment_check.*")


def _positions_table(bind) -> str | None:
    """The table holding position rows at this point in the chain.

    This revision is an ancestor of ``20260805_0008``, which renames ``roles``
    to ``positions``. Until that revision runs the rows live in ``roles``. The
    models were renamed long before the database was, which is why this
    migration was originally written against ``positions`` and then silently
    no-opped on every upgrade path it was supposed to repair.

    A database that has also been started against current code carries an empty
    ``positions`` beside a populated ``roles`` -- the shape ``20260805_0008``
    calls "shape 2" -- so ``roles`` is preferred whenever it is present.
    """
    tables = set(sa.inspect(bind).get_table_names())
    if "roles" in tables:
        return "roles"
    if "positions" in tables:
        return "positions"
    return None


def _member_rows(bind, table: str):
    return bind.execute(
        sa.text(
            f"SELECT id, permissions FROM `{table}` "  # noqa: S608
            "WHERE slug = 'member' AND is_system = 1"
        )
    ).fetchall()


def _permissions(row) -> list:
    perms = row.permissions
    if isinstance(perms, str):
        perms = json.loads(perms or "[]")
    return list(perms or [])


def _store(bind, table: str, row_id: str, perms: list) -> None:
    bind.execute(
        sa.text(
            f"UPDATE `{table}` SET permissions = :perms WHERE id = :id"  # noqa: S608
        ),
        {"perms": json.dumps(perms), "id": row_id},
    )


def upgrade() -> None:
    bind = op.get_bind()
    table = _positions_table(bind)
    if table is None:
        return

    for row in _member_rows(bind, table):
        perms = _permissions(row)
        if _PERMISSION in perms or any(w in perms for w in _COVERING):
            continue
        perms.append(_PERMISSION)
        _store(bind, table, row.id, perms)


def downgrade() -> None:
    bind = op.get_bind()
    table = _positions_table(bind)
    if table is None:
        return

    for row in _member_rows(bind, table):
        perms = _permissions(row)
        if _PERMISSION not in perms:
            continue
        perms.remove(_PERMISSION)
        _store(bind, table, row.id, perms)
