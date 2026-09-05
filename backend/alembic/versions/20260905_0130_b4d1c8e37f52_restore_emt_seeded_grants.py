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
row is an unrepaired seed. An earlier draft of this migration argued the
evidence was categorical — no seeding path could produce an ``is_system`` EMT row
before the registry entry, so every one came from the create branch — and that
argument is wrong in the way this whole line of work has been about: knowing
where a row *came from* says nothing about whether it has since been *edited*.
``RoleService.update_role`` edits a system position's permissions in place and
leaves the flag set, so a department may have removed one of these four on
purpose.

So the row must still look exactly like an untouched wizard row at this point in
the chain: ``_UNEDITED_SHAPE`` is the editor's output for the EMT checkboxes,
less everything ``f3b8d0c26a17`` and ``a2e9f6b04c71`` take off it. A row that
differs by so much as one permission has been edited since, and is left alone.

**What that costs, stated plainly.** A row written by an older build of the
editor — whose module list differed — will not match, and keeps missing these
four. That is the conservative direction for an addition and the one pitfall #23
asks for: a missing benign grant discloses nothing and is visible to the member
who tries to use it, whereas re-granting over an administrator's deliberate
removal is silent. It is also why the revocations above are *not* gated this way:
there, missing a row leaves a disclosure open.

Appends only what a matching row is missing, after which it equals
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

# What an untouched wizard EMT row holds by the time this runs: the editor's
# output for the EMT checkboxes, less everything ``f3b8d0c26a17`` and
# ``a2e9f6b04c71`` revoke from this slug. Only a row matching this exactly is
# taken as unedited, and so as safe to add to. Frozen, and asserted against both
# sources in the accompanying test.
_UNEDITED_SHAPE = frozenset(
    {
        "apparatus.view",
        "documents.view",
        "elections.view",
        "events.view",
        "forms.view",
        "inventory.view",
        "members.view",
        "minutes.view",
        "scheduling.view",
        "storefront.order",
        "storefront.view",
        "training.view",
    }
)


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def restore(permissions):
    """Return the row with the missing grants appended, or None to leave it.

    None for a row that is already complete, and for one that no longer looks
    like the editor's untouched output — see the docstring on why an addition
    has to be that careful when a revocation does not.
    """
    original = list(permissions)
    held = set(original)
    if held != _UNEDITED_SHAPE:
        return None
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
