"""Repair the EMT rows ``b4d1c8e37f52`` could not recognize.

``b4d1c8e37f52`` restores the four grants the setup screen's checkboxes cannot
express — ``locations.view``, ``meetings.view``, ``organization.view`` and
``scheduling.swap`` — but it identifies a row to repair by comparing the row's
**whole** stored permission list against a frozen snapshot of the editor's EMT
output.

That is the strategy CLAUDE.md pitfall #23 bans by name, and it fails the way
the pitfall says: the snapshot is pinned to the module list of one build.
``frontend/src/modules/onboarding/config/moduleRegistry.ts`` did not exist
before 2026-08-31, and the module set moves as the product grows, so a row
written by any other build differs by a permission or two and is skipped —
silently, while the code reads as though it covered the population. Its own
docstring conceded this and argued it was merely the conservative direction for
an addition. Conservative it is; correct it is not, because the rows it skips
are the ones most likely to need the repair.

**What cannot drift is that no checkbox in any build emits these four.** The
editor produces ``{module}.view``, ``{module}.manage``, ``{module}.*`` and the
one entry in ``_VIEW_IMPLIED_PERMISSIONS``; none of those is
``organization.view`` or ``scheduling.swap``, whatever modules the registry held
that day. So a row holding *none* of the four never reached a merge or a seed,
and a row holding *any* of them did, or was curated, and is left alone. Adding a
module to the registry cannot move a row across that line.

**Why a new revision rather than an edit to ``b4d1c8e37f52``.** That revision
merged and has been reachable on ``main`` since 2026-09-05 01:44 UTC. Alembic
records a revision as applied by id, so a database that upgraded in the meantime
would never execute a rewritten body — and the rows left unrepaired there are
exactly the older-build rows this widening exists to reach. Editing it would
have made the fix invisible on precisely the installations that need it.
Superseding is also what pitfall #20 asks for: a migration keeps transforming
rows the way it did the day it ran.

On a fresh database both run, and they compose: ``b4d1c8e37f52`` repairs the
rows matching its snapshot, and this one repairs the rest while skipping those
(they now hold all four). ``_RESTORE`` is therefore re-declared here rather than
imported — the two revisions must be free to diverge.

**What this costs, stated plainly.** A department that deliberately removed all
four at once gets them back. That is the one case it overrides, against a
missing benign grant that discloses nothing and is visible to the member who
tries to use it; removing *some* of the four, the likelier edit, is respected.

**Expected to repair nothing today.** No installation is known to have completed
the old setup wizard, so there should be no create-branch EMT row anywhere. It
is kept because the cost of that being wrong is an EMT who cannot see their own
department or ask to swap a shift.

Guarded on the table existing, defensively rather than out of necessity:
``positions`` IS created by the migration chain — the initial schema builds
``roles`` and 20260805_0008 renames it, which makes that a required ancestor of
this revision, so the table is present by the time this runs. An earlier
version of this paragraph claimed the opposite, which is the false positive
CLAUDE.md pitfall #26 records being reverted after an empirical ``alembic
upgrade head`` against an empty database. The guard is kept because it costs
one reflection and cannot be wrong, but it is not load-bearing, and it is not
the pattern to copy for a genuinely create_all-only table.

Revision ID: c7a4e91d3b68
Revises: b4d1c8e37f52
Create Date: 2026-09-05 12:45:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "c7a4e91d3b68"
down_revision = "b4d1c8e37f52"
branch_labels = None
depends_on = None

_SLUG = "emt"

# The registry's EMT grants that the editor's checkboxes cannot represent.
# Frozen rather than imported (CLAUDE.md pitfall #20), and deliberately a second
# copy of ``b4d1c8e37f52``'s tuple rather than a reference to it: each revision
# has to keep behaving as it did the day it ran. The accompanying test derives
# the same set from the registry and ``expand_module_checkboxes``, so a grant
# that becomes reachable through a checkbox fails the build rather than being
# restored wrongly.
_RESTORE = (
    "locations.view",
    "meetings.view",
    "organization.view",
    "scheduling.swap",
)


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def restore(permissions):
    """Return the row with the four grants appended, or None to leave it.

    None for a row holding any of them — it reached a merge or a seed, or an
    administrator curated it, and either way it is not the untouched
    create-branch row this repairs. None too for an empty list, which is a
    position somebody stripped rather than one the wizard built.

    Deliberately *not* a comparison against the whole stored list: see the
    module docstring on why that snapshot cannot survive a registry change.
    """
    original = list(permissions)
    held = set(original)
    if not held:
        return None
    if held & set(_RESTORE):
        return None
    return original + list(_RESTORE)


def upgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    rows = bind.execute(
        sa.text(
            "SELECT id, permissions FROM positions "
            "WHERE slug = :slug AND is_system = :is_system"
        ),
        {"slug": _SLUG, "is_system": True},
    ).fetchall()
    for row in rows:
        restored = restore(_load_permissions(row.permissions))
        if restored is None:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(restored), "id": row.id},
        )


def downgrade() -> None:
    # Deliberately empty, as in b4d1c8e37f52. Removing these again would take the
    # department's own information and the shift-swap request away from every
    # EMT, which is the defect this repairs rather than a prior state worth
    # returning to.
    pass
