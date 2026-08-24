"""Backfill events.reopen_attendance onto existing leadership positions

Revision ID: b7d1e04f92a3
Revises: c3f8a29d54e1

``DEFAULT_POSITIONS`` is materialized only when an organization is onboarded,
so adding a permission to the registry reaches fresh installs and nobody else.
Without this pass, an established department upgrades into an event that
finalizing locks and no position can reopen — the recovery action the feature
advertises would be unreachable for exactly the chiefs it was written for,
and the only way out would be a wildcard grant or the role editor.

Mirrors the grant in app/core/permissions.py: the three chief ranks and the
president, and nobody else. events.manage reaches nine default positions, and
the point of the separate permission is that the organizer who closed the
event is not among the people who can reopen it — so this deliberately does
not follow events.manage.

Idempotent: a position already holding the grant, or covered by ``events.*``
or ``*``, is skipped.
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "b7d1e04f92a3"
down_revision = "c3f8a29d54e1"
branch_labels = None
depends_on = None


_GRANT = "events.reopen_attendance"

# Mirrors DEFAULT_POSITIONS / OPERATIONAL_RANKS in app/core/permissions.py.
_SLUGS = ("fire_chief", "deputy_chief", "assistant_chief", "president")


def _load(raw):
    """Normalize the JSON column across drivers that hand back str vs list."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _covered(permission: str, granted: list) -> bool:
    """Is this grant already implied? Mirrors ``permission_matches``."""
    if "*" in granted or permission in granted:
        return True
    module = permission.split(".")[0]
    return f"{module}.*" in granted


def upgrade() -> None:
    bind = op.get_bind()
    # positions is a model-only table, materialized by startup create_all which
    # runs AFTER migrations on a fresh install. Absent means a new database,
    # where DEFAULT_POSITIONS seeds the grant anyway.
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    for slug in _SLUGS:
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = 1"
            ),
            {"slug": slug},
        ).fetchall()
        for row in rows:
            granted = _load(row.permissions)
            if _covered(_GRANT, granted):
                continue
            bind.execute(
                sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
                {"perms": json.dumps(granted + [_GRANT]), "id": row.id},
            )


def downgrade() -> None:
    # The grant is deliberately NOT removed, matching 20260816_0005.
    #
    # The upgrade skips rows that already hold it, so nothing records which
    # rows it actually changed — a department that granted this by hand in the
    # role editor would lose configuration this migration never created. The
    # two failure modes are not symmetric either: a grant left behind is
    # visible in the role editor and removable in a click, while one silently
    # taken away leaves a chief unable to reopen an event with nothing on
    # screen to explain why.
    pass
