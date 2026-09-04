"""Finish repairing the baseline position rows the onboarding wizard overwrote.

The old onboarding position editor derived its checkbox defaults from a "a
member views every module whose category is not System" heuristic instead of
from ``DEFAULT_POSITIONS``, and its first Continue saved that over the seeded
rows wholesale. ``dependencies.py`` unions every assigned position's stored
permissions, so the difference is live grants on every department that onboarded
under that code (CLAUDE.md pitfall #23).

``20260901_1320_f7b3c8d2e569`` was written to undo it and holds the correct
target list for each slug, but it only rewrites a row matching the heuristic's
output *in full* — deliberately, since the old save was a replacement and an
edited row is the department's own. Four migrations mutate these same rows
before it runs (``31e2816df7c3`` strips ``compliance.view``, ``a1f7c34e9b02``
``notifications.view``, ``a4f8c1b92d17`` adds the storefront grants,
``e4f5a6b7c8d9`` strips ``facilities.view``), while its ``old`` list still
carries ``facilities.view`` and ``notifications.view``. It therefore matches
only a department that onboarded inside a narrow window in late August; one
that onboarded earlier is a permission or two off, so its row is skipped and
every remaining discrepancy survives.

Four of those discrepancies already have per-permission migrations that catch a
row whatever else it holds (``compliance.view``, ``facilities.view``,
``notifications.view``, and ``reports.view`` for member/firefighter in
``c9a5e21f7b04``). This settles the rest, for the three slugs the heuristic
reached: ``member``, ``firefighter`` and ``engineer``.

``emt`` is deliberately absent. ``DEFAULT_POSITIONS`` has no ``emt`` entry — the
rank exists but no position mirrors it — so onboarding writes no ``is_system``
row under that slug for the wizard to have overwritten. ``e4f5a6b7c8d9`` listed
it defensively; there is nothing for it to match.

Three operations, because they carry different risks and so cannot share one
matching rule:

1. **Unconditional revokes.** Removing a grant never widens access, so it needs
   no gate — and going per-permission rather than per-whole-list is exactly what
   makes this immune to the ordering problem above.

2. **Narrowing engineer's ``apparatus.*``.** The wildcard grants
   ``apparatus.manage`` and ``apparatus.approve_driver_exception``, which the
   registry does not seed to a driver/operator, and it *masks* the two apparatus
   grants the row is missing. Replacing it with ``apparatus.view`` and
   ``apparatus.maintenance`` is strictly a reduction — the wildcard already
   matched both — so it also needs no gate, but the removal and the two
   additions must happen together. Dropping the wildcard on its own would take
   apparatus access away from every engineer in the department, which is why
   this is neither folded into (1) nor gated with (3).

3. **Marker-gated additions.** ``storefront.order`` and
   ``inventory.check_submit`` are grants, so an unconditional add would also
   override a department that removed one on purpose. They are added only to a
   row still carrying one of ``_HEURISTIC_MARKERS`` — permissions the registry
   has never seeded to these slugs and no other code path grants, so their
   presence is proof the row is unrepaired wizard output rather than one
   somebody curated.

Marker presence is therefore computed **before** the revokes are applied, since
the revokes remove the markers. That ordering is also what makes the migration
idempotent: a second run finds no markers, skips the additions, and leaves the
row byte-identical.

Scoped to ``is_system = True``: a position a department built for itself is
theirs.

The tables below are frozen copies rather than imports from
``app.core.permissions``. A migration has to keep transforming rows the way it
did the day it ran, and ``DEFAULT_POSITIONS`` is free to change (CLAUDE.md
pitfall #20). ``tests/test_wizard_overwritten_grant_repair.py`` cross-checks
them against the registry so a drift is reported rather than silently applied.

Guarded on the table existing: ``positions`` is one of the tables no migration
creates — it appears when ``main.py`` calls ``create_all()``, and CI runs
``alembic upgrade head`` against an empty database, so reflecting it unguarded
would fail the whole upgrade rather than this one step (CLAUDE.md pitfall #26).

Revision ID: d1c7f4a92e63
Revises: c9a5e21f7b04
Create Date: 2026-09-04 16:40:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "d1c7f4a92e63"
down_revision = "c9a5e21f7b04"
branch_labels = None
depends_on = None

# The four the heuristic added to every one of these slugs and the registry
# seeds to none of them. They are both the grants to revoke and — because
# nothing else in the system grants them here — the fingerprint that identifies
# an unrepaired wizard row. Same tuple, deliberately: if one is ever legitimised
# it stops being usable as a marker, and the two must not drift apart.
_HEURISTIC_MARKERS = (
    "integrations.view",
    "medical_supplies.view",
    "mobile.view",
    "prospective_members.view",
)

_REVOKE = {
    "member": _HEURISTIC_MARKERS,
    "firefighter": _HEURISTIC_MARKERS,
    # Engineer is a driver/operator, not an officer: department-wide reporting,
    # the settings screen and the position roster are all outside that.
    "engineer": _HEURISTIC_MARKERS
    + (
        "positions.view",
        "reports.view",
        "settings.view",
    ),
}

# slug -> ((wildcard, replacements), ...). Applied as one substitution.
_WILDCARD_NARROWING = {
    "engineer": (("apparatus.*", ("apparatus.view", "apparatus.maintenance")),),
}

# Registry-seeded grants the heuristic's replacement dropped.
_ADD = {
    "member": ("storefront.order", "inventory.check_submit"),
    "firefighter": ("storefront.order",),
    "engineer": ("storefront.order",),
}

_SLUGS = tuple(sorted(_REVOKE))


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def repair(slug, permissions):
    """Return the repaired list, or None when the row needs no write.

    Split out from ``upgrade`` so the transform can be exercised directly.
    """
    original = list(permissions)
    held = set(original)

    # Before the revokes, which remove the markers themselves.
    is_wizard_row = any(marker in held for marker in _HEURISTIC_MARKERS)

    remove = set(_REVOKE.get(slug, ()))
    additions = []

    for wildcard, replacements in _WILDCARD_NARROWING.get(slug, ()):
        if wildcard in held:
            remove.add(wildcard)
            additions.extend(replacements)

    if is_wizard_row:
        additions.extend(_ADD.get(slug, ()))

    repaired = [item for item in original if item not in remove]
    present = set(repaired)
    for item in additions:
        if item not in present:
            repaired.append(item)
            present.add(item)

    return repaired if repaired != original else None


def upgrade() -> None:
    bind = op.get_bind()
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
            repaired = repair(slug, _load_permissions(row.permissions))
            if repaired is None:
                continue
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(repaired), "id": row.id},
            )


def downgrade() -> None:
    # Deliberately empty. Reversing this would re-grant an apparatus wildcard,
    # the settings screen and department-wide reporting to every engineer, and
    # four view grants to every member — which is the defect, not a prior state
    # worth returning to. The additions are the registry's own seeds, so
    # removing them again would only restore a second half of the same bug.
    pass
