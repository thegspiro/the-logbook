"""Revoke compliance.view from the system Member position.

``compliance.view`` reads as an innocuous view grant, but it is an accepted
alternative on two officer-grade checks:

* ``GET /compliance-officer/contributed-hours`` accepts
  ``training.manage`` OR ``reports.view`` OR ``compliance.view`` and returns
  hours contributed by *all* members for the year.
* ``GET /admin-hours/.../compliance`` narrows non-admins to their own record
  unless the caller holds ``admin_hours.manage``, ``compliance.view`` or
  ``*``. With every member holding the grant, that narrowing never applied and
  any member could read any other member's admin-hours compliance progress by
  passing their ``user_id`` — the endpoint's own comment says "Non-admins can
  only see their own compliance", and the seeded grant contradicted it.

Two seeded **positions** need rewriting: ``member`` and ``firefighter``.

The firefighter one is easy to miss. ``operational_ranks`` genuinely has no
permissions column — rank defaults resolve at runtime from
``OPERATIONAL_RANKS`` — but ``DEFAULT_POSITIONS["firefighter"]["permissions"]``
*is* ``OPERATIONAL_RANKS["firefighter"]["default_permissions"]``, so onboarding
also writes a system position with slug ``firefighter`` carrying a copy of that
list. ``dependencies.py`` unions every assigned position's stored permissions,
so an existing member holding the Firefighter position would have kept the
grant if only ``member`` were rewritten here.

Revision ID: 31e2816df7c3
Revises: b7d1e04f92a3
Create Date: 2026-08-24 21:40:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "31e2816df7c3"
down_revision = "b7d1e04f92a3"
branch_labels = None
depends_on = None

_PERMISSION = "compliance.view"
_SLUGS = ("member", "firefighter")


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def upgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    for slug in _SLUGS:
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = :is_system"
            ),
            {"slug": slug, "is_system": True},
        ).fetchall()
        for row in rows:
            permissions = _load_permissions(row.permissions)
            if _PERMISSION not in permissions:
                continue
            permissions = [item for item in permissions if item != _PERMISSION]
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(permissions), "id": row.id},
            )


def downgrade() -> None:
    # Restoring the grant would reopen every member's read of every other
    # member's compliance progress and of the department-wide hours report.
    pass
