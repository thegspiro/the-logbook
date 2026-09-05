"""Backfill role-targeted department messages from role names to role ids

Role-targeted messages historically stored role *names* in target_roles, so
renaming a role silently broke delivery. Targeting now matches on role id.
This migration rewrites each role-targeted message's target_roles from names to
the corresponding position id within the same organization. Names that cannot
be resolved (role since deleted/renamed) are left as-is — the service keeps a
name-match fallback for them.

Revision ID: 20260720_0002
Revises: 20260720_0001
Create Date: 2026-07-20 00:02:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260720_0002"
down_revision = "20260720_0001"
branch_labels = None
depends_on = None


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


def _rewrite(bind, mapping, key) -> None:
    """Rewrite every role-targeted message's target_roles through *mapping*.

    *key* turns a message row into the lookup key for one entry, so the same
    walk serves both directions.
    """
    rows = bind.execute(
        sa.text(
            "SELECT id, organization_id, target_roles FROM department_messages "
            "WHERE target_type = 'roles' AND target_roles IS NOT NULL"
        )
    ).fetchall()

    for row in rows:
        target = row.target_roles
        # MySQL JSON columns may surface as a JSON string depending on driver.
        if isinstance(target, str):
            try:
                target = json.loads(target)
            except (ValueError, TypeError):
                continue
        if not isinstance(target, list):
            continue

        new_target = [mapping.get(key(row, entry), entry) for entry in target]
        if new_target != target:
            bind.execute(
                sa.text(
                    "UPDATE department_messages SET target_roles = :roles "
                    "WHERE id = :id"
                ),
                {"roles": json.dumps(new_target), "id": row.id},
            )


def upgrade() -> None:
    bind = op.get_bind()
    table = _positions_table(bind)
    if table is None:
        return

    # Map (organization_id, role_name) -> role_id for every position.
    name_to_id = {}
    for row in bind.execute(
        sa.text(f"SELECT id, organization_id, name FROM `{table}`")  # noqa: S608
    ):
        name_to_id[(row.organization_id, row.name)] = row.id

    _rewrite(bind, name_to_id, lambda row, entry: (row.organization_id, entry))


def downgrade() -> None:
    # Best-effort reverse: rewrite ids back to names where the id still resolves.
    bind = op.get_bind()
    table = _positions_table(bind)
    if table is None:
        return

    id_to_name = {}
    for row in bind.execute(sa.text(f"SELECT id, name FROM `{table}`")):  # noqa: S608
        id_to_name[row.id] = row.name

    _rewrite(bind, id_to_name, lambda row, entry: entry)
