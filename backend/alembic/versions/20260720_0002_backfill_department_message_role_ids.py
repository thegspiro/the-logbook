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


def upgrade() -> None:
    bind = op.get_bind()

    # Map (organization_id, role_name) -> role_id for every position.
    name_to_id = {}
    for row in bind.execute(
        sa.text("SELECT id, organization_id, name FROM positions")
    ):
        name_to_id[(row.organization_id, row.name)] = row.id

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

        new_target = [
            name_to_id.get((row.organization_id, entry), entry) for entry in target
        ]
        if new_target != target:
            bind.execute(
                sa.text(
                    "UPDATE department_messages SET target_roles = :roles "
                    "WHERE id = :id"
                ),
                {"roles": json.dumps(new_target), "id": row.id},
            )


def downgrade() -> None:
    # Best-effort reverse: rewrite ids back to names where the id still resolves.
    bind = op.get_bind()

    id_to_name = {}
    for row in bind.execute(sa.text("SELECT id, name FROM positions")):
        id_to_name[row.id] = row.name

    rows = bind.execute(
        sa.text(
            "SELECT id, target_roles FROM department_messages "
            "WHERE target_type = 'roles' AND target_roles IS NOT NULL"
        )
    ).fetchall()

    for row in rows:
        target = row.target_roles
        if isinstance(target, str):
            try:
                target = json.loads(target)
            except (ValueError, TypeError):
                continue
        if not isinstance(target, list):
            continue

        new_target = [id_to_name.get(entry, entry) for entry in target]
        if new_target != target:
            bind.execute(
                sa.text(
                    "UPDATE department_messages SET target_roles = :roles "
                    "WHERE id = :id"
                ),
                {"roles": json.dumps(new_target), "id": row.id},
            )
