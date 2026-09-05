"""Revoke the wizard's over-grants whatever else the row now holds.

Three migrations have chased this defect. The old onboarding position editor
replaced each seeded row with a module-category heuristic's output, and
``dependencies.py`` unions every assigned position's stored permissions, so the
difference became live grants (CLAUDE.md pitfall #23).

``c9a5e21f7b04`` and ``d1c7f4a92e63`` removed the residue. Both were then put
behind a "wizard fingerprint" gate — the row still carrying one of
``integrations.view``, ``medical_supplies.view``, ``mobile.view`` or
``prospective_members.view`` — so that a department which had deliberately
granted one of these to its own Member position kept it. That gate rested on the
claim that every unrepaired wizard row still carries all four markers.

**It does not, and that is why this migration exists.**
``expand_module_checkboxes`` (``app/api/v1/onboarding.py``) emits
``{module}.view`` for each ticked box, and the editor's own handler
(``frontend/src/modules/onboarding/pages/RoleSetup.tsx``) lets an administrator
untick each module independently before the first Continue. A department running
no integrations, medical-supplies, mobile or prospective-members module unticks
exactly those four and leaves Reports at the heuristic's default — a wizard row
holding ``reports.view`` and not one marker. The gate skips it, and the whole
department keeps reading every member's aggregated hours, training and roster
data.

So the revocations run unconditionally again. No signal in the row separates
"the wizard wrote this" from "an administrator chose this", and when the two
cannot be told apart, a grant that discloses other members' data fails closed.

**The cost is real and is accepted.** A department that deliberately gave its
members Reports loses it here, and an administrator has to re-add it on the
positions screen. That is a minute of work set against a standing disclosure.

**Restorations are deliberately not repeated.** ``storefront.order`` and
``inventory.check_submit`` stay marker-gated in ``d1c7f4a92e63``. Adding is the
direction where an unconditional write overrides a department's deliberate
removal, the grant discloses nothing, and a marker-less row cannot be recognised
as the wizard's in any case. A member on such a row keeps missing the store-order
grant until somebody re-adds it.

**Why a new revision rather than editing those two.** They are merged and may
have been pulled; a migration has to keep transforming rows the way it did the
day it ran (pitfall #20). A new revision is also the only thing that reaches an
installation which already stamped either version — the unconditional bodies or
the gated ones — so every installation converges here regardless of which it ran.
It is a no-op for a row already repaired.

**Every stored form of an over-granted module, not just ``.view``.**
``expand_module_checkboxes`` writes ``{module}.view`` for a ticked View box and
both ``{module}.manage`` and ``{module}.*`` for a ticked Manage box. An
administrator who ticked Manage on one of these modules during setup therefore
stored a wildcard, and ``permission_matches`` treats ``reports.*`` as satisfying
``reports.view`` — so removing the ``.view`` string alone would leave the
department-wide reports open through the wildcard. All three forms go.
``apparatus.manage`` is removed from engineer for the same reason: the wildcard
narrowing below would otherwise be undone by a literal manage grant sitting
beside it.

A Manage tick on a module these slugs *are* seeded to view — apparatus for a
member, say — is a different question and is left alone: the module is theirs to
see, and only the over-granted modules named here are this migration's business.

**``emt`` is covered, and the note in ``d1c7f4a92e63`` saying otherwise is
wrong.** That reasoning ran: ``DEFAULT_POSITIONS`` has no ``emt`` entry, so
onboarding writes no system row under that slug. The wizard has its own list.
``emt`` is in ``DISCIPLINE_POSITION_IDS`` (and is the whole roster for an
``ems_only`` agency), and because no seeded row exists to update,
``save_session_roles`` takes its create branch — storing
``expand_module_checkboxes`` output verbatim, with ``is_system=not is_custom``,
which is ``True`` for a position the wizard offered. So an EMT row holds the
heuristic's output with nothing merged from the registry, and
``_collect_user_permissions`` unions it into every EMT's grants.
``e4f5a6b7c8d9`` already listed ``emt`` for exactly this reason.

An EMT's intended grants are the line-member set
(``OPERATIONAL_RANKS["emt"]["default_permissions"]``), the same list Firefighter
holds, so it takes the same revocations. Its missing *restorations* are not
repaired here — see the note on restorations above.

Scoped to ``is_system = True``: a position a department created for itself is
theirs, and is not what the wizard overwrote.

Guarded on the table existing: ``positions`` is one of the tables no migration
creates — it appears when ``main.py`` calls ``create_all()``, and CI runs
``alembic upgrade head`` against an empty database, so reflecting it unguarded
would fail the whole upgrade rather than this one step (pitfall #26).

Revision ID: f3b8d0c26a17
Revises: 9d2b4492faba
Create Date: 2026-09-04 20:50:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "f3b8d0c26a17"
down_revision = "9d2b4492faba"
branch_labels = None
depends_on = None

# Frozen copies rather than imports from app.core.permissions: a migration has
# to keep transforming rows the way it did the day it ran (pitfall #20). The
# accompanying test cross-checks them against the registry so drift is reported
# rather than silently applied.
# Modules the heuristic granted to these slugs and the registry seeds to none of
# them. Frozen rather than imported from app.core.permissions: a migration has to
# keep transforming rows the way it did the day it ran (pitfall #20). The
# accompanying test cross-checks them against the registry so drift is reported
# rather than silently applied.
_OVER_GRANTED_MODULES = (
    "integrations",
    "medical_supplies",
    "mobile",
    "prospective_members",
    "reports",
)

# The heuristic treated engineer as a leader and handed it these two as well.
_ENGINEER_EXTRA_MODULES = ("positions", "settings")


def _stored_forms(module):
    """Every string the editor could have stored for one module's checkboxes."""
    return (f"{module}.view", f"{module}.manage", f"{module}.*")


def _revocations(modules, extra=()):
    return tuple(
        permission for module in modules for permission in _stored_forms(module)
    ) + tuple(extra)


_MEMBER_REVOCATIONS = _revocations(_OVER_GRANTED_MODULES)

_REVOKE = {
    "member": _MEMBER_REVOCATIONS,
    "firefighter": _MEMBER_REVOCATIONS,
    # An EMT's intended grants are the line-member set, the same list Firefighter
    # holds, so the same revocations apply.
    "emt": _MEMBER_REVOCATIONS,
    # Engineer is a driver/operator, not an officer: the settings screen and the
    # position roster are outside that, as is department-wide reporting.
    # apparatus.manage goes with the wildcard narrowing below.
    "engineer": _revocations(
        _OVER_GRANTED_MODULES + _ENGINEER_EXTRA_MODULES,
        extra=("apparatus.manage",),
    ),
}

# slug -> ((wildcard, replacements), ...), applied as one substitution.
#
# ``apparatus.*`` carries apparatus.manage and apparatus.approve_driver_exception,
# neither of which the registry seeds to an engineer, and it masks the two grants
# it does seed. Replacing it is strictly a reduction — the wildcard already
# matched both — but the removal and the additions have to happen together:
# dropping the wildcard alone would take apparatus access away from every
# engineer in the department.
_WILDCARD_NARROWING = {
    "engineer": (("apparatus.*", ("apparatus.view", "apparatus.maintenance")),),
}

_SLUGS = tuple(sorted(_REVOKE))


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def revoke(slug, permissions):
    """Return the rewritten list, or None when the row needs no write."""
    original = list(permissions)
    held = set(original)

    remove = set(_REVOKE.get(slug, ()))
    additions = []

    for wildcard, replacements in _WILDCARD_NARROWING.get(slug, ()):
        if wildcard in held:
            remove.add(wildcard)
            additions.extend(replacements)

    rewritten = [item for item in original if item not in remove]
    present = set(rewritten)
    for item in additions:
        if item not in present:
            rewritten.append(item)
            present.add(item)

    return rewritten if rewritten != original else None


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
            rewritten = revoke(slug, _load_permissions(row.permissions))
            if rewritten is None:
                continue
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(rewritten), "id": row.id},
            )


def downgrade() -> None:
    # Deliberately empty. Reversing this would re-grant department-wide
    # reporting to every member, and an apparatus wildcard plus the settings
    # screen to every engineer — the defect, not a prior state worth restoring.
    pass
