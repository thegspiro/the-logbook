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

**Why this add is unconditional, when the rule for this work is that additions
are gated.** A revocation of a disclosing grant runs unconditionally; an
addition is gated on positive evidence the row is an unrepaired seed, because an
unconditional add overrides a department that removed the grant on purpose. For
``emt`` that evidence is categorical rather than heuristic: until the registry
gained its entry no seeding path could produce an ``is_system`` EMT row at all,
so every one of them came from the create branch. There is no curated seeded row
here to protect.

The residual cost is a department that deliberately removed, say,
``organization.view`` from EMT getting it back. That is benign, visible on the
positions screen and removable again in a moment — set against EMTs who cannot
read their own department or request a swap.

Appends only what a row is missing, so a row already holding all four is left
byte-identical, and the order of what is already there is untouched.

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
    """Return the row with the missing grants appended, or None if complete."""
    original = list(permissions)
    held = set(original)
    missing = [item for item in _RESTORE if item not in held]
    if not missing:
        return None
    return original + missing


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
