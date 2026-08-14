"""Backfill facilities.view_sensitive on existing organizations' positions

PR #1358 gated sensitive facility data (access keys/codes, utility
accounts, capital projects, insurance policies, occupants, lease terms)
behind facilities.view_sensitive/edit/manage and added the new
permission to DEFAULT_POSITIONS — but positions are seeded at org
creation, so only newly created organizations receive the grant. On
existing organizations the captain / vice president / treasurer
positions would lose access to data they could read before the deploy.

Two grant rules, applied idempotently:

1. The system positions DEFAULT_POSITIONS now grants the permission to
   (captain, vice_president, treasurer, and the chief positions, whose
   rank permission lists carry it for the rank grant ceiling), matched
   the same way seeding matches them: slug + is_system.
2. Any position already holding facilities.manage — those holders can
   already edit the sensitive data, so viewing it must not regress if a
   later change checks the read grant specifically.

Positions whose grants already cover the permission ("*",
"facilities.*", or the permission itself) are left untouched. Downgrade
is a documented no-op — see downgrade().

Revision ID: 20260813_0008
Revises: 20260813_0007
Create Date: 2026-08-13 00:01:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260813_0008"
down_revision = "20260813_0007"
branch_labels = None
depends_on = None

_PERMISSION = "facilities.view_sensitive"

# Mirrors the DEFAULT_POSITIONS slugs that carry the permission at this
# revision. Hardcoded rather than imported: a data migration must apply
# the registry as it stood when the migration was written, not as it
# reads at some future upgrade time.
_GRANTED_SLUGS = (
    "captain",
    "vice_president",
    "treasurer",
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
)


def _load_permissions(raw):
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def upgrade() -> None:
    bind = op.get_bind()
    # positions is a model-only table (materialized by startup create_all,
    # which runs AFTER migrations on fresh installs) — skip when absent;
    # brand-new orgs seed the permission from DEFAULT_POSITIONS anyway.
    if "positions" not in sa.inspect(bind).get_table_names():
        return
    rows = bind.execute(
        sa.text("SELECT id, slug, is_system, permissions FROM positions")
    ).fetchall()
    for row in rows:
        perms = _load_permissions(row.permissions)
        # A wildcard grant already covers the read; don't clutter the list.
        if _PERMISSION in perms or "*" in perms or "facilities.*" in perms:
            continue
        is_default_holder = bool(row.is_system) and row.slug in _GRANTED_SLUGS
        holds_manage = "facilities.manage" in perms
        if not (is_default_holder or holds_manage):
            continue
        perms.append(_PERMISSION)
        bind.execute(
            sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
            {"perms": json.dumps(perms), "id": row.id},
        )


def downgrade() -> None:
    # No-op, deliberately. This revision changes no schema — it only ADDS a
    # permission string to some positions.permissions lists — so nothing has
    # to be undone to restore the prior structure.
    #
    # Removing the permission is not safe: this migration records nothing
    # about which rows it touched, so a grant here is indistinguishable from
    # one that predates the upgrade (which the upgrade skipped on purpose) or
    # one an administrator granted afterwards through the position editor.
    # A blanket DELETE of facilities.view_sensitive would therefore revoke
    # tenant-managed facility access that this migration never created —
    # silently, and only noticed when someone loses data they should see.
    #
    # Erring toward leaving a READ grant in place is the conservative side:
    # the permission is read-only (writes still require facilities.edit /
    # facilities.manage), and re-running the upgrade is idempotent.
    pass
