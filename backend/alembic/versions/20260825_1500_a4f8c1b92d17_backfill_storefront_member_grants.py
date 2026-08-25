"""Backfill the storefront grants onto existing organizations' positions

The department store is unreachable for a regular member on any department
that onboarded before the storefront grants were added to the registry.

``DEFAULT_POSITIONS`` is materialized into the ``positions`` table only when an
organization is onboarded, so a grant added to the registry afterwards reaches
fresh installs and nobody else. ``storefront.view`` / ``storefront.order`` were
added to ``DEFAULT_POSITIONS["member"]`` after the storefront module shipped,
and no migration ever wrote them to the rows already stored.

Why this is invisible for the people who would report it: ``dependencies.py``
unions each assigned position's *stored* permissions with the member's
operational rank defaults, and rank defaults resolve at runtime from
``OPERATIONAL_RANKS`` — no table involved. So every officer, and every member
carrying a rank, holds ``storefront.view`` regardless of this migration. The
members who cannot open the store are the ones with **no operational rank**:
administrative, social and support members, plus anyone whose rank was simply
never set. They hold only the stale stored ``member`` position, and
``ProtectedRoute`` sends them away from a store the navigation still shows.

Mirrors the grants in ``app/core/permissions.py`` exactly, and follows the
precedent of ``20260816_0005`` (medical supplies) and ``20260824_2140``
(compliance.view).

Scoped to ``is_system = True``: a department's own customized position is
theirs, and a quartermaster who deliberately withheld the store from a
position should not have it handed back by an upgrade.

Idempotent — a position already carrying a grant, or a wildcard that covers
it, is left untouched.

Revision ID: a4f8c1b92d17
Revises: e3b7c25f9a41
Create Date: 2026-08-25 15:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a4f8c1b92d17"
down_revision = "e3b7c25f9a41"
branch_labels = None
depends_on = None


_VIEW_ORDER = ("storefront.view", "storefront.order")
_FULL = _VIEW_ORDER + ("storefront.manage",)

# slug -> grants to add. Mirrors DEFAULT_POSITIONS in app/core/permissions.py.
# ``it_manager`` is absent on purpose: it seeds with the "*" wildcard, which
# already covers every storefront permission.
_BACKFILL: dict[str, tuple[str, ...]] = {
    # Every member of the department can browse and order.
    "member": _VIEW_ORDER,
    # Rank-mirroring system positions (see permissions.py — DEFAULT_POSITIONS
    # aliases OPERATIONAL_RANKS for these, so onboarding stores a copy).
    "firefighter": _VIEW_ORDER,
    "engineer": _VIEW_ORDER,
    "lieutenant": _VIEW_ORDER,
    "captain": _VIEW_ORDER,
    "fire_chief": _FULL,
    "deputy_chief": _FULL,
    "assistant_chief": _FULL,
    # Corporate positions.
    "president": _FULL,
    "vice_president": _VIEW_ORDER,
    "quartermaster": _FULL,
    "apparatus_officer": _FULL,
    "facilities_manager": _FULL,
    "safety_officer": _VIEW_ORDER,
}


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _covered(permissions: list, grant: str) -> bool:
    """True if *permissions* already grants *grant*, wildcard included."""
    if "*" in permissions or grant in permissions:
        return True
    module = grant.split(".", 1)[0]
    return f"{module}.*" in permissions


def upgrade() -> None:
    bind = op.get_bind()
    # ``positions`` is one of the tables only ``create_all()`` builds, so a
    # database that has never started the app does not have it yet.
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    for slug, grants in _BACKFILL.items():
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = 1"
            ),
            {"slug": slug},
        ).fetchall()

        for row in rows:
            permissions = _load_permissions(row[1])
            missing = [g for g in grants if not _covered(permissions, g)]
            if not missing:
                continue
            bind.execute(
                sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
                {"perms": json.dumps(permissions + missing), "id": row[0]},
            )


def downgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    for slug, grants in _BACKFILL.items():
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = 1"
            ),
            {"slug": slug},
        ).fetchall()

        for row in rows:
            permissions = _load_permissions(row[1])
            remaining = [p for p in permissions if p not in grants]
            if len(remaining) == len(permissions):
                continue
            bind.execute(
                sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
                {"perms": json.dumps(remaining), "id": row[0]},
            )
