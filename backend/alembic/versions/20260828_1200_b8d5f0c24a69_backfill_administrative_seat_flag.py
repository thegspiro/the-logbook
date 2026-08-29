"""Backfill the administrative-access flag on canonical crew seats.

Legacy strings and two-field slot objects become the current three-field shape.
Non-list values are preserved because shift templates also store event metadata
in the positions column. The transformation is irreversible but remains readable
by older application versions.

Revision ID: b8d5f0c24a69
Revises: e5f6a7b8c9d0
Create Date: 2026-08-28 12:00:00
"""

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "b8d5f0c24a69"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None

_TABLES = ("shifts", "shift_templates", "basic_apparatus")


def _backfill(value: Any) -> Any:
    if not isinstance(value, list):
        return value
    settled = []
    for entry in value:
        if isinstance(entry, str):
            settled.append(
                {
                    "position": entry,
                    "required": True,
                    "allow_administrative_members": False,
                }
            )
        elif isinstance(entry, dict):
            slot = dict(entry)
            slot["allow_administrative_members"] = (
                entry.get("allow_administrative_members") is True
            )
            settled.append(slot)
    return settled


def _load(raw: Any) -> Any:
    if isinstance(raw, (str, bytes, bytearray)):
        return json.loads(raw)
    return raw


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table in _TABLES:
        if table not in tables:
            continue
        rows = bind.execute(
            sa.text(
                f"SELECT id, positions FROM {table} WHERE positions IS NOT NULL"  # noqa: S608
            )
        ).fetchall()
        for row_id, raw in rows:
            try:
                value = _load(raw)
            except (TypeError, ValueError):
                continue
            settled = _backfill(value)
            if settled == value:
                continue
            bind.execute(
                sa.text(
                    f"UPDATE {table} SET positions = :positions WHERE id = :id"  # noqa: S608
                ),
                {"positions": json.dumps(settled), "id": row_id},
            )


def downgrade() -> None:
    """No-op: the prior readers accept the added object property."""
