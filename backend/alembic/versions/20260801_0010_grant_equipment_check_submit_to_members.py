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


def upgrade() -> None:
    bind = op.get_bind()
    # positions is a model-only table (materialized by startup create_all,
    # which runs AFTER migrations on fresh installs) — skip when absent;
    # brand-new orgs seed the permission from DEFAULT_POSITIONS anyway.
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    rows = bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = 'member' AND is_system = 1"
        )
    ).fetchall()
    for row in rows:
        perms = row.permissions
        if isinstance(perms, str):
            perms = json.loads(perms or "[]")
        perms = list(perms or [])
        # A wildcard grant already covers submit; don't clutter the list.
        if _PERMISSION in perms or "*" in perms or "equipment_check.*" in perms:
            continue
        perms.append(_PERMISSION)
        bind.execute(
            sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
            {"perms": json.dumps(perms), "id": row.id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    rows = bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = 'member' AND is_system = 1"
        )
    ).fetchall()
    for row in rows:
        perms = row.permissions
        if isinstance(perms, str):
            perms = json.loads(perms or "[]")
        perms = list(perms or [])
        if _PERMISSION not in perms:
            continue
        perms.remove(_PERMISSION)
        bind.execute(
            sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
            {"perms": json.dumps(perms), "id": row.id},
        )
