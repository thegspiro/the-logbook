"""Backfill the storefront grants onto positions seeded before the module.

The storefront module's tables arrived in ``20260801_0020``. Its permissions
were added to the position registry at the same time, but nothing rewrote the
``positions`` rows an existing department had already been seeded with — and
positions are written once, at onboarding. So a department that onboarded
before the store shipped carries a ``member`` position with no storefront
grant at all, and ``/store`` (which requires ``storefront.view``) answers
Access Denied.

Ranks hid the gap rather than closing it. ``_collect_user_permissions``
unions each assigned position's stored permissions with the *runtime*
defaults of the user's operational rank, and every rank in
``OPERATIONAL_RANKS`` carries the storefront grants. Anyone holding a rank
therefore reached the store fine; a member with no rank recorded — a new
volunteer, an administrative member — did not. That is the account this was
reported from.

Scoped to ``is_system = True`` and to the grants a fresh install would seed
today, so a department's own customized position is left alone.

``storefront.manage`` is deliberately NOT backfilled. It is an administrative
power (catalog, pricing, other members' orders) rather than baseline access,
and unlike view/order its absence on a row cannot be told apart from an
administrator having removed it. Chiefs reach the admin console through their
rank defaults regardless; a department that wants its Quartermaster back in
there grants it explicitly.

Revision ID: c4f8a2e70d19
Revises: e3b7c25f9a41
Create Date: 2026-08-25 16:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "c4f8a2e70d19"
down_revision = "e3b7c25f9a41"
branch_labels = None
depends_on = None

_PERMISSIONS = ("storefront.view", "storefront.order")

# Every seeded slug whose registry entry carries these grants today. The rank
# names are here for the reason Pitfall #23 in CLAUDE.md gives: onboarding
# writes rank-mirroring *positions* holding a copy of the rank's list, and a
# member can hold the Firefighter position with no rank recorded on their
# user row, which is exactly the case the runtime rank union does not cover.
_SLUGS = (
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "captain",
    "lieutenant",
    "engineer",
    "firefighter",
    "president",
    "vice_president",
    "quartermaster",
    "apparatus_officer",
    "safety_officer",
    "facilities_manager",
    "member",
)

# A wildcard already covers the grants; adding them would only clutter the row.
_COVERING = ("*", "storefront.*")


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _apply(add: bool) -> None:
    bind = op.get_bind()
    # `positions` is one of the tables no migration creates — create_all()
    # builds it on first boot (Pitfall #26). A database that has not started
    # the app yet has nothing to rewrite, and the rows create_all() writes
    # later come from the registry, which already carries these grants.
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
            if any(covering in permissions for covering in _COVERING):
                continue
            if add:
                missing = [p for p in _PERMISSIONS if p not in permissions]
                if not missing:
                    continue
                permissions.extend(missing)
            else:
                if not any(p in permissions for p in _PERMISSIONS):
                    continue
                permissions = [p for p in permissions if p not in _PERMISSIONS]
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(permissions), "id": row.id},
            )


def upgrade() -> None:
    _apply(add=True)


def downgrade() -> None:
    # Lossy in the same way every seed backfill is: a department that already
    # had these grants (onboarded after the store shipped) loses them too,
    # since nothing records which rows this revision actually wrote. Re-running
    # the upgrade restores them.
    _apply(add=False)
