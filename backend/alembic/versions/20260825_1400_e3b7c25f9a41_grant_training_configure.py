"""Grant training.configure to the seeded positions that configure training.

``training.configure`` is new: it gates the training module's org-level
settings — chiefly the member visibility panel, which decides how much of an
officer's written assessment the member being assessed may read. Until now
that panel was gated on ``training.manage``, which also carries the power to
create and edit anybody's training records; the Membership Coordinator needs
the former and should not be handed the latter.

The endpoints accept ``training.configure`` OR ``training.manage``, so a
department's own customized position that holds ``training.manage`` keeps
working untouched. This migration only rewrites the **seeded** rows, so their
stored permission lists match the registry.

Two kinds of seeded row need it, and the second is the one Pitfall #23 in
CLAUDE.md is about: ``DEFAULT_POSITIONS["fire_chief"]["permissions"]`` *is*
``OPERATIONAL_RANKS["fire_chief"]["default_permissions"]`` — the same list
object — so onboarding writes rank-mirroring positions carrying a copy of it.
Rewriting only the non-rank positions would leave every existing department's
chiefs and company officers without the new grant.

Revision ID: e3b7c25f9a41
Revises: a7c93f21d5b8
Create Date: 2026-08-25 14:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "e3b7c25f9a41"
down_revision = "a7c93f21d5b8"
branch_labels = None
depends_on = None

_PERMISSION = "training.configure"

# Every seeded position whose registry entry now carries the grant: the eight
# that already held ``training.manage`` (five of them rank-mirroring), plus the
# Membership Coordinator, which holds ``training.configure`` alone.
_SLUGS = (
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "captain",
    "lieutenant",
    "president",
    "safety_officer",
    "training_officer",
    "membership_coordinator",
)


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _apply(add: bool) -> None:
    bind = op.get_bind()
    # `positions` is one of the tables no migration creates — it is built by
    # create_all() on first boot (Pitfall #26). On a database that has not
    # started the app yet there is nothing to rewrite, and the rows
    # create_all() writes later come from the registry, which already carries
    # the grant.
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
            has = _PERMISSION in permissions
            if add == has:
                continue
            if add:
                permissions.append(_PERMISSION)
            else:
                permissions = [p for p in permissions if p != _PERMISSION]
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(permissions), "id": row.id},
            )


def upgrade() -> None:
    _apply(add=True)


def downgrade() -> None:
    # Reversible: the grant is additive and the endpoints still accept
    # training.manage, so removing it only costs the Membership Coordinator
    # the access this revision introduced.
    _apply(add=False)
