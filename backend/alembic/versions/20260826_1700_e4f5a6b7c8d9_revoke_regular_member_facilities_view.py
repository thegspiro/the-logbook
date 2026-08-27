"""Restrict the facilities workspace to leadership and facility managers.

Revision ID: e4f5a6b7c8d9
Revises: 472a1e34aa84
Create Date: 2026-08-26 17:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "e4f5a6b7c8d9"
down_revision = "a8f3c1d7e902"
branch_labels = None
depends_on = None

_PERMISSION = "facilities.view"
_SLUGS = ("member", "firefighter", "emt", "engineer")


def _load_permissions(raw):
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def upgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    statement = sa.text(
        "SELECT id, permissions FROM positions "
        "WHERE slug IN :slugs AND is_system = :is_system"
    ).bindparams(sa.bindparam("slugs", expanding=True))
    rows = bind.execute(statement, {"slugs": _SLUGS, "is_system": True}).fetchall()
    for row in rows:
        permissions = _load_permissions(row.permissions)
        if _PERMISSION not in permissions:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {
                "permissions": json.dumps(
                    [item for item in permissions if item != _PERMISSION]
                ),
                "id": row.id,
            },
        )


def downgrade() -> None:
    # Re-adding this grant would reopen a leadership workspace to all members.
    pass
