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

``emt`` is absent here, and **that was a mistake** — corrected in
``f3b8d0c26a17``, which covers it. The reasoning was: ``DEFAULT_POSITIONS`` has
no ``emt`` entry, so onboarding writes no ``is_system`` row under that slug. But
the wizard keeps its own roster: ``emt`` is one of its discipline positions, and
because no seeded row exists to update, ``save_session_roles`` takes its *create*
branch and stores the heuristic's output verbatim with ``is_system=True``.
``e4f5a6b7c8d9`` listed ``emt`` for exactly that reason, not defensively.

Every change here is gated on the row being recognizably unrepaired wizard
output — it carries one of ``_HEURISTIC_MARKERS``, four grants the registry
seeds to none of these slugs, that the heuristic added to all of them, and that
nothing else in the system grants or removes.

That gate is the point, not a precaution. ``is_system = True`` does **not** mean
"untouched default": ``RoleService.update_role``
(``app/services/role_service.py:283-311``) lets an organization edit a built-in
position's permissions in place and leaves the flag set. Acting on every system
row would silently undo a department's own decisions on upgrade. Matching the
heuristic's output as a whole list instead — the obvious alternative — is
exactly what left ``f7b3c8d2e569`` unable to recognise these rows, so the
recognizer has to be robust to the row having moved on.

Marker presence is computed **before** anything else, because the revokes
remove the markers themselves. That ordering is also what makes the migration
idempotent: a second run finds no markers and leaves the row byte-identical.

Within a gated row, three groups of change:

1. **Revokes** — the four markers, plus ``positions.view``, ``reports.view`` and
   ``settings.view`` on engineer. Per-permission rather than whole-list, which
   is what makes this immune to the ordering problem above.

2. **Narrowing engineer's ``apparatus.*``.** The wildcard grants
   ``apparatus.manage`` and ``apparatus.approve_driver_exception``, which the
   registry does not seed to a driver/operator, and it *masks* the two apparatus
   grants the row is missing. It is replaced by ``apparatus.view`` and
   ``apparatus.maintenance`` — strictly a reduction, since the wildcard already
   matched both — and the removal and the two additions happen together.
   Dropping the wildcard on its own would take apparatus access away from every
   engineer in the department.

3. **Restorations** — ``storefront.order`` and ``inventory.check_submit``, which
   the registry seeds and the heuristic's replacement dropped.

Scoped to ``is_system = True`` as well: a position a department built for itself
is theirs outright.

The tables below are frozen copies rather than imports from
``app.core.permissions``. A migration has to keep transforming rows the way it
did the day it ran, and ``DEFAULT_POSITIONS`` is free to change (CLAUDE.md
pitfall #20). ``tests/test_wizard_overwritten_grant_repair.py`` cross-checks
them against the registry so a drift is reported rather than silently applied.

Guarded on the table existing, defensively rather than out of necessity:
``positions`` IS created by the migration chain — the initial schema builds
``roles`` and 20260805_0008 renames it, which makes that a required ancestor of
this revision, so the table is present by the time this runs. An earlier
version of this paragraph claimed the opposite, which is the false positive
CLAUDE.md pitfall #26 records being reverted after an empirical ``alembic
upgrade head`` against an empty database. The guard is kept because it costs
one reflection and cannot be wrong, but it is not load-bearing, and it is not
the pattern to copy for a genuinely create_all-only table.

**Partly superseded by ``f3b8d0c26a17``.** The fingerprint gate below misses a
wizard row whose four marker modules were unticked at onboarding, so that
revision repeats every revocation here unconditionally. Only the restorations —
``storefront.order`` and ``inventory.check_submit`` — remain this migration's
alone: adding is the direction where an unconditional write would override a
department's deliberate removal. This body is left as it ran (pitfall #20).

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

    # Tested before anything else: the revokes below remove the markers, so a
    # repaired row must not be recognised a second time.
    if not any(marker in held for marker in _HEURISTIC_MARKERS):
        # Either never overwritten, or already repaired. Whatever it holds now
        # is the department's, not the wizard's.
        return None

    remove = set(_REVOKE.get(slug, ()))
    additions = list(_ADD.get(slug, ()))

    for wildcard, replacements in _WILDCARD_NARROWING.get(slug, ()):
        if wildcard in held:
            remove.add(wildcard)
            additions.extend(replacements)

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
