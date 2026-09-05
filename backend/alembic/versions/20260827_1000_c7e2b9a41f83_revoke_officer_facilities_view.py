"""Take facilities.view off the operational officer positions.

Revision ID: c7e2b9a41f83
Revises: 8fb3757b80ec
Create Date: 2026-08-27 10:00:00.000000

The registry stopped handing ``facilities.view`` to the shared operational
leadership set, but a registry edit alone reaches fresh installs and nobody
else: ``DEFAULT_POSITIONS`` is materialized into ``positions`` once, at
onboarding. Every department already running keeps the grant on its stored
Captain and Lieutenant rows — which is the whole population the change exists
to restrict — so the revocation has to be written to the rows as well.

A separate revision rather than widening ``e4f5a6b7c8d9``: that one is already
on main and may be stamped, and a migration an environment has run is never
revisited, so a slug added to it there would silently never be applied.

The chief ranks are included even though they keep ``facilities.manage`` and so
lose no access: leaving a grant on the row that the registry no longer issues
is what makes a stored position and its definition disagree, and the next
person to read either one has no way to tell which is authoritative.

Scoped to ``is_system = True``. A department that customized its own Captain
position chose those grants, and they are not ours to edit.
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "c7e2b9a41f83"
down_revision = "8fb3757b80ec"
branch_labels = None
depends_on = None

_PERMISSION = "facilities.view"
_SLUGS = ("fire_chief", "deputy_chief", "assistant_chief", "captain", "lieutenant")


def _load_permissions(raw):
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def upgrade() -> None:
    bind = op.get_bind()
    # Defensive only. ``positions`` IS created by the migration chain — the
    # initial schema builds ``roles`` and 20260805_0008 renames it, which makes
    # that a required ancestor of this revision, so the table is present by the
    # time this runs. Claiming otherwise is the false positive CLAUDE.md
    # pitfall #26 records being reverted after an empirical ``alembic upgrade
    # head`` against an empty database. The guard is kept because it costs one
    # reflection and cannot be wrong, but it is not load-bearing, and it is not
    # the pattern to copy for a genuinely create_all-only table — for those the
    # guard is required.
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
    # Re-adding this grant would reopen the workspace to every officer, which
    # is the state this revision exists to end.
    pass
