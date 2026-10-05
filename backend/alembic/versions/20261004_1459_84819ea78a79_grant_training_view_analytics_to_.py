"""Grant ``training.view_analytics`` to the seeded leadership positions.

Department-wide shift-report analytics used to be served to anyone holding
``training.manage`` — which every company officer holds, because it is what
files a shift report. The "Written by me" screen then showed the whole
department's totals under the heading "Your reporting summary". As of this
revision the endpoint serves the caller's own reports by default, and the
department-wide figures need the new ``training.view_analytics``.

The registry grants it to the Chief, Deputy Chief and Assistant Chief ranks and
to the President and Training Officer positions. Rank defaults resolve at
runtime, but each of those ranks is mirrored by a seeded system position
holding a *copy* of its list (CLAUDE.md pitfall #23), so the grant only reaches
an installation that has run onboarding by way of this migration.

**Direction: an addition, gated on evidence.** A seeded row is only given the
grant while it still holds ``training.manage`` — the permission that showed
these positions the department view until today. That is exactly the access
they had, preserved; a department that took training management away from one
of these positions does not have analytics handed back to it. A row holding
``training.*`` or ``*`` already satisfies the new check and is not touched.
Positions a department created itself are out of scope (``is_system``).

**What it costs when wrong:** a seeded leadership row an administrator had
deliberately kept on ``training.manage`` but meant to exclude from department
totals gains them — the same totals it could already see this morning.

Revision ID: 84819ea78a79
Revises: d058b5e7c1f4
Create Date: 2026-10-04 14:59:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "84819ea78a79"
down_revision = "d058b5e7c1f4"
branch_labels = None
depends_on = None

_PERMISSION = "training.view_analytics"

# Frozen rather than imported (CLAUDE.md pitfall #20): the registry may move,
# and this revision must keep doing what it did the day it ran.
_SLUGS = (
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "president",
    "training_officer",
)

_ALREADY_COVERED = {"*", "training.*", _PERMISSION}


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def grant(permissions):
    """Return the row with the grant appended, or None to leave it alone."""
    held = set(permissions)
    if held & _ALREADY_COVERED:
        return None
    if "training.manage" not in held:
        return None
    return list(permissions) + [_PERMISSION]


def revoke(permissions):
    """Return the row without the grant, or None when it does not hold it."""
    if _PERMISSION not in permissions:
        return None
    return [p for p in permissions if p != _PERMISSION]


def _rewrite(change) -> None:
    bind = op.get_bind()
    # Defensive only: positions is built by the migration chain (20260805_0008
    # renames roles), so this is not a create_all-only table.
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    rows = bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE is_system = :is_system AND slug IN :slugs"
        ).bindparams(sa.bindparam("slugs", expanding=True)),
        {"is_system": True, "slugs": list(_SLUGS)},
    ).fetchall()
    for row in rows:
        updated = change(_load_permissions(row.permissions))
        if updated is None:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(updated), "id": row.id},
        )


def upgrade() -> None:
    _rewrite(grant)


def downgrade() -> None:
    # Before this revision nothing read the permission, so removing it from the
    # rows it could have reached restores the prior behaviour exactly; the old
    # endpoint gated department totals on training.manage alone.
    _rewrite(revoke)
