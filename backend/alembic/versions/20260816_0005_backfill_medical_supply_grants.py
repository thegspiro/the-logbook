"""Backfill the medical-supply position and grants onto existing organizations

``DEFAULT_POSITIONS`` is materialized only when an organization is onboarded,
so a new system position and new grants added to it reach fresh installs and
nobody else. Without this migration an established department upgrades into a
Medical Supplies page that no position can manage, and an Apparatus Officer
whose description promises equipment checks it still cannot open.

Three idempotent passes, each skipping rows that already carry the grant:

1. Create the ``ems_supply_officer`` system position for every organization
   that lacks one, with the permission set from ``DEFAULT_POSITIONS``.
2. Add the medical grants to the positions that seed with them —
   quartermaster, apparatus officer, and the three chief ranks — plus the
   president, matching ``permissions.py``.
3. Add the ``equipment_check.*`` set to apparatus officers, which that role
   has always been described as needing and never actually held.

A wildcard already covering a grant is left alone rather than cluttered.

Revision ID: 20260816_0005
Revises: 20260816_0004
Create Date: 2026-08-16 00:05:00.000000

"""

import json
import uuid

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260816_0005"
down_revision = "20260816_0004"
branch_labels = None
depends_on = None


_MEDICAL_GRANTS = ("inventory.view_medical", "inventory.manage_medical")
_CHECK_GRANTS = (
    "equipment_check.view",
    "equipment_check.manage",
    "equipment_check.submit",
)

# slug -> grants to add. Mirrors DEFAULT_POSITIONS in app/core/permissions.py.
_BACKFILL: dict[str, tuple[str, ...]] = {
    "quartermaster": _MEDICAL_GRANTS,
    "fire_chief": _MEDICAL_GRANTS,
    "deputy_chief": _MEDICAL_GRANTS,
    "assistant_chief": _MEDICAL_GRANTS,
    "president": _MEDICAL_GRANTS,
    "apparatus_officer": _MEDICAL_GRANTS + _CHECK_GRANTS,
}

_EMS_OFFICER = {
    "name": "EMS Supply Officer",
    "slug": "ems_supply_officer",
    "description": (
        "Manages medical supplies, stock lots, and what is aboard each rig "
        "— without access to gear or uniforms"
    ),
    "priority": 55,
    "permissions": [
        "users.view",
        "members.view",
        "positions.view",
        "organization.view",
        "inventory.view_medical",
        "inventory.manage_medical",
        "equipment_check.view",
        "equipment_check.manage",
        "apparatus.view",
        "locations.view",
    ],
}


def _load(raw):
    """Normalize the JSON column across drivers that hand back str vs list."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _covered(permission: str, granted: list[str]) -> bool:
    """Is this grant already implied? Mirrors ``permission_matches``."""
    if "*" in granted or permission in granted:
        return True
    module = permission.split(".")[0]
    return f"{module}.*" in granted


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

    for slug, grants in _BACKFILL.items():
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = 1"
            ),
            {"slug": slug},
        ).fetchall()
        for row in rows:
            granted = _load(row.permissions)
            missing = [g for g in grants if not _covered(g, granted)]
            if not missing:
                continue
            bind.execute(
                sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
                {"perms": json.dumps(granted + missing), "id": row.id},
            )

    # One EMS Supply Officer per organization that has any system position at
    # all — an organization with none has not been onboarded, so seeding will
    # cover it.
    org_rows = bind.execute(
        sa.text("SELECT DISTINCT organization_id FROM positions WHERE is_system = 1")
    ).fetchall()
    for org_row in org_rows:
        exists = bind.execute(
            sa.text(
                "SELECT id FROM positions "
                "WHERE organization_id = :org AND slug = :slug"
            ),
            {"org": org_row.organization_id, "slug": _EMS_OFFICER["slug"]},
        ).fetchone()
        if exists:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO positions "
                "(id, organization_id, name, slug, description, permissions, "
                " is_system, priority) "
                "VALUES (:id, :org, :name, :slug, :description, :permissions, "
                " 1, :priority)"
            ),
            {
                "id": str(uuid.uuid4()),
                "org": org_row.organization_id,
                "name": _EMS_OFFICER["name"],
                "slug": _EMS_OFFICER["slug"],
                "description": _EMS_OFFICER["description"],
                "permissions": json.dumps(_EMS_OFFICER["permissions"]),
                "priority": _EMS_OFFICER["priority"],
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    # Grants are deliberately NOT removed.
    #
    # The upgrade is idempotent by skipping rows that already hold a grant, so
    # nothing records which rows it actually changed. A department may well
    # have granted `equipment_check.*` to its apparatus officer by hand years
    # ago — those permissions long predate this migration — and stripping them
    # here would destroy configuration this migration never created.
    #
    # The two failure modes are not symmetric. A grant left behind is visible
    # in the role editor and removable in a click; a grant silently taken away
    # locks an officer out of a screen they were using, with nothing on screen
    # to explain why. Leaving them is the recoverable direction.

    # The position itself is different: it did not exist before this migration,
    # so removing it reverses something this migration really did do. Dropped
    # only where no member holds it, so a department that already staffed the
    # office does not lose the assignment.
    bind.execute(
        sa.text(
            "DELETE FROM positions WHERE slug = :slug AND is_system = 1 "
            "AND id NOT IN (SELECT position_id FROM user_positions)"
        ),
        {"slug": _EMS_OFFICER["slug"]},
    )
