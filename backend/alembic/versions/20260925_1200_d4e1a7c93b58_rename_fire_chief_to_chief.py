"""Rename the seeded "Fire Chief" position and rank to "Chief".

The top operational officer is now seeded as plain "Chief" for every agency
type: in most departments, and especially volunteer ones, that is the title of
the highest operational leader, and a department that also runs a Fire Chief
and an EMS Chief adds those beneath it. ``DEFAULT_POSITIONS`` and
``DEFAULT_RANKS`` only reach departments onboarded after this deploy, so this
carries the new wording to the rows already stored.

**Only the display name changes.** The code stays ``fire_chief``: it is stored
on ``users.rank``, keys the permission registry and the office catalog, and is
referenced by approval and eligibility config, so renaming it would orphan all
of those. No permission list is touched.

**Only rows still carrying the seeded wording are renamed** — a system
``positions`` row with slug ``fire_chief`` named exactly "Fire Chief", and an
``operational_ranks`` row with code ``fire_chief`` displayed exactly as "Fire
Chief". A department that already renamed either one chose that title, and
keeps it. EMS-only departments were already seeded "Chief" and match nothing.

Idempotent: a second run finds no "Fire Chief" rows to rename.

The downgrade restores "Fire Chief" on the same rows for every agency except an
EMS-only one, which was seeded "Chief" before this revision. It cannot tell a
row this upgrade renamed from one a fire department renamed to "Chief" by hand,
so the latter is reverted too; that is the unavoidable cost of reversing a
rename nothing distinguishes from the seed.

Revision ID: d4e1a7c93b58
Revises: b1eb0458782a
Create Date: 2026-09-25 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "d4e1a7c93b58"
down_revision = "b1eb0458782a"
branch_labels = None
depends_on = None

# Frozen at this revision, not imported: a migration must keep targeting the
# rows it was written for after the registry moves on.
_CODE = "fire_chief"
_OLD_NAME = "Fire Chief"
_NEW_NAME = "Chief"
_EMS_ONLY = "ems_only"


def _existing_tables(bind) -> set[str]:
    inspector = sa.inspect(bind)
    return {t for t in ("positions", "operational_ranks") if inspector.has_table(t)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = _existing_tables(bind)
    params = {"code": _CODE, "old": _OLD_NAME, "new": _NEW_NAME}

    if "positions" in tables:
        bind.execute(
            sa.text(
                "UPDATE positions SET name = :new "
                "WHERE slug = :code AND name = :old AND is_system = :is_system"
            ),
            {**params, "is_system": True},
        )
    if "operational_ranks" in tables:
        bind.execute(
            sa.text(
                "UPDATE operational_ranks SET display_name = :new "
                "WHERE rank_code = :code AND display_name = :old"
            ),
            params,
        )


def downgrade() -> None:
    bind = op.get_bind()
    tables = _existing_tables(bind)
    # Rename back to the pre-revision wording, so old = the current "Chief".
    params = {"code": _CODE, "old": _NEW_NAME, "new": _OLD_NAME, "ems": _EMS_ONLY}

    if "positions" in tables:
        bind.execute(
            sa.text(
                "UPDATE positions SET name = :new "
                "WHERE slug = :code AND name = :old AND is_system = :is_system "
                "AND organization_id IN ("
                "SELECT id FROM organizations WHERE organization_type <> :ems)"
            ),
            {**params, "is_system": True},
        )
    if "operational_ranks" in tables:
        bind.execute(
            sa.text(
                "UPDATE operational_ranks SET display_name = :new "
                "WHERE rank_code = :code AND display_name = :old "
                "AND organization_id IN ("
                "SELECT id FROM organizations WHERE organization_type <> :ems)"
            ),
            params,
        )
