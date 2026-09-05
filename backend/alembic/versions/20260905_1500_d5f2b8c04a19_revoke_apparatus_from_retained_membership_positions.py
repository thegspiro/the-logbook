"""Revoke apparatus.view from the membership positions ``c3d4e5f6a7b8`` kept.

``b6e4a0d17c93`` took the fleet record off ``member``, ``firefighter`` and
``emt``. It missed the rows a department accumulated under the old role setup,
which offered Probationary, Junior, Life, Administrative, Social and Exempt as
*positions*.

``c3d4e5f6a7b8`` recovered that standing onto the member record and
**deliberately kept those position rows** — each carries the ``member`` or
``probationary`` template it was created from, and a member whose only position
is ``life_member`` would otherwise lose everything it grants. So on any
installation that used them, those rows still hold the member template's
``apparatus.view``, and a member holding one still passes the apparatus gate.
Revoking from ``member`` alone left exactly the disclosure ``b6e4a0d17c93``
exists to close, under a different slug.

**Why a new revision rather than widening that one.** ``b6e4a0d17c93`` merged
with #2248 and is reachable on main. Alembic records a revision as applied by
id, so a database that has upgraded since would never execute a widened body —
and the rows left unrevoked there are precisely the ones this reaches. That is
the reasoning ``c9447a4845`` sets out for ``b4d1c8e37f52``, and resting delivery
on "probably nothing has stamped it yet" would repeat the mistake it corrected.
The two compose on a fresh database: the predecessor clears the three baseline
slugs, this clears the six membership ones, and neither revisits the other's.

**Every stored form**, for the reason ``b6e4a0d17c93`` gives: the position
editor writes ``{module}.manage`` and ``{module}.*`` for a ticked Manage box,
and ``permission_matches`` treats ``apparatus.*`` as satisfying
``apparatus.view``, so removing the ``.view`` string alone would leave the fleet
record open behind the wildcard.

**Unconditional, scoped to ``is_system = True``**, on the same terms as its
predecessor: nothing in a row distinguishes a grant the seed wrote from one an
administrator chose, and a revocation that closes a disclosure is the direction
pitfall #23 takes unconditionally. When that is wrong — a department
deliberately gave one of these standings the fleet roster — an administrator
re-adds it on the positions screen. A position the department created for
itself is untouched.

**No table guard, deliberately.** ``positions`` looks create_all-only — no
migration ``create_table``s it under that name — but pitfall #26 names this
exact table as the trap in that reasoning: ``20260805_0008`` renames ``roles``,
which the initial schema creates outright, and is a required ancestor here.
Verified rather than reasoned: ``alembic upgrade head`` against a freshly
created empty database leaves ``positions`` present with no ``create_all``
involved. An absent table therefore means a broken schema, and a guard would
turn that into a silent skip — Alembic would stamp this revision, and a revision
runs once, so the grants would survive permanently once the table came back.

Revision ID: d5f2b8c04a19
Revises: b6e4a0d17c93
Create Date: 2026-09-05 15:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "d5f2b8c04a19"
down_revision = "b6e4a0d17c93"
branch_labels = None
depends_on = None

# Frozen rather than imported: a migration has to keep transforming rows the way
# it did the day it ran (pitfall #20). The accompanying test cross-checks this
# list against ``c3d4e5f6a7b8``'s own map so drift is reported, not applied.
_RETAINED_MEMBERSHIP_SLUGS = (
    "administrative_member",
    "exempt_member",
    "junior_member",
    "life_member",
    "probationary_member",
    "social_member",
)

_APPARATUS_FORMS = ("apparatus.view", "apparatus.manage", "apparatus.*")

_REVOKE = {slug: _APPARATUS_FORMS for slug in _RETAINED_MEMBERSHIP_SLUGS}

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
    # driver-qualification record to every member holding one of these
    # standings — the defect, not a prior state worth restoring.
    pass
