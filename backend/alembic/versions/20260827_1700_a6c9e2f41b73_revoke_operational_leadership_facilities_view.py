"""Remove facilities.view inherited by operational leadership positions.

Revision ID: a6c9e2f41b73
Revises: 8fb3757b80ec
Create Date: 2026-08-27 17:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "a6c9e2f41b73"
down_revision = "8fb3757b80ec"
branch_labels = None
depends_on = None

_PERMISSION = "facilities.view"
_SLUGS = (
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "captain",
    "lieutenant",
)


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
    # Re-adding an inherited read would recreate the overly broad grant.
    pass
