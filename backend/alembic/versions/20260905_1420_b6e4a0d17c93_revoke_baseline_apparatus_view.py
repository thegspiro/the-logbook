"""Revoke apparatus.view from the seeded rank-and-file positions.

The apparatus pages are a maintenance and compliance workspace — inspection
expirations, out-of-service status, deficiency flags, driver qualifications —
and until now every seeded volunteer could open them.
``_LINE_MEMBER_PERMISSIONS`` and ``DEFAULT_POSITIONS["member"]["permissions"]``
no longer carry ``apparatus.view``; this takes it off the rows that already do.

**The registry edit alone would revoke nothing (CLAUDE.md pitfall #23).**
``DEFAULT_POSITIONS["firefighter"]["permissions"]`` *is*
``OPERATIONAL_RANKS["firefighter"]["default_permissions"]`` — the same list
object — so onboarding wrote a system *position* with slug ``firefighter``
carrying a copy of it, and the ``member`` position holds its own copy.
``_collect_user_permissions`` unions every assigned position's **stored**
permissions, so both keep the grant live on every existing installation until
this rewrites them.

**``emt`` is covered.** It has no ``DEFAULT_POSITIONS`` entry, so
``save_session_roles`` takes its create branch and stores
``expand_module_checkboxes`` output verbatim with ``is_system=True`` — the
reasoning ``f3b8d0c26a17`` sets out at length. An EMT's intended grants are the
line-member set (``OPERATIONAL_RANKS["emt"]["default_permissions"]`` is the same
list object Firefighter holds), so it takes the same revocation.

**``engineer`` is deliberately absent from the slug list.** Engineer is the
driver/operator rank, seeded ``apparatus.view`` beside ``apparatus.maintenance``;
``d1c7f4a92e63`` and ``f3b8d0c26a17`` both narrow a stored ``apparatus.*`` on an
engineer row *to* exactly those two. Nothing here may undo that.

**Every stored form, not just ``.view``.** ``expand_module_checkboxes`` writes
``{module}.manage`` and ``{module}.*`` for a ticked Manage box, and
``permission_matches`` treats ``apparatus.*`` as satisfying ``apparatus.view``
— so removing the ``.view`` string alone would leave the fleet record open
through the wildcard. ``f3b8d0c26a17`` explicitly left a member's
``apparatus.manage`` tick alone, on the grounds that "the module is theirs to
see". It no longer is, so all three forms go now.

**Unconditional, and the cost is accepted.** Nothing in a row distinguishes a
grant the seed wrote from one an administrator chose — ``RoleService.update_role``
edits a system position's permissions in place and leaves ``is_system`` set. A
fingerprint gate was tried three times upstream of this file and failed each
time (see ``f3b8d0c26a17``), and it would in any case leave the grant live on
the overwhelming majority of installations, which is the whole point of the
change. So this runs unconditionally, in the direction pitfall #23 names as
unconditional: revoking a grant that discloses a department's compliance
record. **When that is wrong** — a department deliberately gave its Member
position the fleet roster — it costs an administrator one visit to the
positions screen to re-add it. A missed revocation costs a standing disclosure.

Scoped to ``is_system = True``: a position a department created for itself keeps
whatever it was given.

Guarded on the table existing: ``positions`` is one of the tables no migration
creates — it appears when ``main.py`` calls ``create_all()``, and CI runs
``alembic upgrade head`` against an empty database, so reflecting it unguarded
would fail the whole upgrade rather than this one step (pitfall #26).

Revision ID: b6e4a0d17c93
Revises: f3b8d0c26a17
Create Date: 2026-09-05 14:20:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "b6e4a0d17c93"
down_revision = "f3b8d0c26a17"
branch_labels = None
depends_on = None

# Frozen rather than imported from app.core.permissions: a migration has to keep
# transforming rows the way it did the day it ran (pitfall #20). The accompanying
# test cross-checks these against the registry so drift is reported rather than
# silently applied.
_REVOKED_MODULE = "apparatus"


def _stored_forms(module):
    """Every string the editor could have stored for one module's checkboxes."""
    return (f"{module}.view", f"{module}.manage", f"{module}.*")


_APPARATUS_FORMS = _stored_forms(_REVOKED_MODULE)

_REVOKE = {
    "member": _APPARATUS_FORMS,
    "firefighter": _APPARATUS_FORMS,
    # An EMT's intended grants are the line-member set, the same list object
    # Firefighter holds, so the same revocation applies.
    "emt": _APPARATUS_FORMS,
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
    remove = set(_REVOKE.get(slug, ()))
    rewritten = [item for item in original if item not in remove]
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
    # Deliberately empty. Reversing this would re-open the fleet maintenance and
    # driver-qualification record to every member of every department — the
    # defect, not a prior state worth restoring.
    pass
