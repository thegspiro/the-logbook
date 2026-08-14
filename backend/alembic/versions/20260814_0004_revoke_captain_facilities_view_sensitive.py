"""Remove the sensitive facilities grant backfilled onto system Captains.

Revision ID: 20260814_0004
Revises: 20260814_0003
Create Date: 2026-08-14 00:02:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "20260814_0004"
down_revision = "20260814_0003"
branch_labels = None
depends_on = None

_PERMISSION = "facilities.view_sensitive"


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def upgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    rows = bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = :slug AND is_system = :is_system"
        ),
        {"slug": "captain", "is_system": True},
    ).fetchall()
    for row in rows:
        permissions = _load_permissions(row.permissions)
        if _PERMISSION not in permissions:
            continue
        permissions = [item for item in permissions if item != _PERMISSION]
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(permissions), "id": row.id},
        )


def downgrade() -> None:
    # Restoring the grant would recreate the cross-station disclosure.
    pass
