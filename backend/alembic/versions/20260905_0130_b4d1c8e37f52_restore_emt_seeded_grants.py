"""Restore the seeded EMT grants the setup screen could not express.

The position editor's checkboxes can only produce ``{module}.view``,
``{module}.manage``, ``{module}.*`` and the one entry in
``_VIEW_IMPLIED_PERMISSIONS`` (``storefront`` -> ``storefront.order``). Because
the registry had no ``emt`` entry, ``save_session_roles`` took its **create**
branch and stored that expansion verbatim, so nothing outside it ever reached an
EMT row. Measured against ``DEFAULT_POSITIONS["emt"]`` — which is
``OPERATIONAL_RANKS["emt"]["default_permissions"]``, the list Firefighter holds —
four grants never arrived:

``locations.view``, ``meetings.view``, ``organization.view`` and
``scheduling.swap``.

``organization.view`` is the department's own information; ``scheduling.swap``
gates the swap endpoints in ``endpoints/scheduling.py``. So an EMT-only member
cannot see their department or ask to swap a shift, and ``a2e9f6b04c71`` only
removes over-grants.

**Not the gap the other line slugs have.** ``member``, ``firefighter`` and
``engineer`` were seeded throughout, so their saves went through the *update*
branch, where ``_merge_default_permissions`` keeps an untouched module's seeded
grants. Only the create branch discards them, and ``emt`` is the only slug that
took it.

**Gated, because an addition always is.** CLAUDE.md pitfall #23: a revocation of
a disclosing grant runs unconditionally, an addition needs positive evidence the
row is an unrepaired seed. An earlier draft argued the evidence was categorical —
no seeding path could produce an ``is_system`` EMT row before the registry entry,
so every one came from the create branch — and that is wrong in the way this
whole line of work has been about: knowing where a row *came from* says nothing
about whether it has since been *edited*. ``RoleService.update_role`` edits a
system position's permissions in place and leaves the flag set, so a department
may have removed one of these four on purpose.

**The signal is the absence of all four, not the shape of the whole row.** A
second draft compared the row against a frozen snapshot of the editor's entire
EMT output. That is the strategy pitfall #23 names outright — the same one
``20260901_1320_f7b3c8d2e569`` used — and it fails the same way: the snapshot is
pinned to one build's module list, so a row written by any other build differs by
a permission or two and is skipped, silently, while the code reads as though it
covers the population.

What cannot drift is that **no checkbox in any build emits these four.** The
editor produces ``{module}.view``, ``{module}.manage``, ``{module}.*`` and the
one entry in ``_VIEW_IMPLIED_PERMISSIONS``; none of those is
``organization.view`` or ``scheduling.swap``, whatever modules the registry held
that day. So a row holding *none* of the four never reached a merge or a seed —
and a row holding *any* of them did, or was curated, and is left alone. Adding a
module to the registry cannot move a row across that line.

**What that costs, stated plainly.** A department that deliberately removed all
four at once gets them back. That is the one case this overrides, against a
missing benign grant that discloses nothing and is visible to the member who
tries to use it; removing some of the four, the likelier edit, is respected.
It is also why the revocations above are *not* gated at all: there, skipping a
row leaves a disclosure open.

**Expected to repair nothing today.** No installation is known to have completed
the old setup wizard, so there should be no create-branch EMT row anywhere. It is
kept because the cost of that being wrong is an EMT who cannot see their own
department or ask to swap a shift, and because the gate above is cheap and safe
on a row that does not need it.

Appends the four, preserving the order of what was already stored. A row that
the two revocations above have finished with then equals
``DEFAULT_POSITIONS["emt"]``.

Guarded on the table existing: ``positions`` is one of the tables no migration
creates — it appears when ``main.py`` calls ``create_all()``, and CI runs
``alembic upgrade head`` against an empty database (CLAUDE.md pitfall #26).

Revision ID: b4d1c8e37f52
Revises: a2e9f6b04c71
Create Date: 2026-09-05 01:30:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "b4d1c8e37f52"
down_revision = "a2e9f6b04c71"
branch_labels = None
depends_on = None

_SLUG = "emt"

# The registry's EMT grants that the editor's checkboxes cannot represent.
# Frozen rather than imported (CLAUDE.md pitfall #20); the accompanying test
# derives the same set from the registry and ``expand_module_checkboxes`` and
# fails if the two drift.
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
    # Deliberately empty. Removing these again would take the department's own
    # information and the shift-swap request away from every EMT, which is the
    # defect this repairs rather than a prior state worth returning to.
    pass
