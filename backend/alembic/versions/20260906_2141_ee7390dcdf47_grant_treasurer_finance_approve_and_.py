"""Grant the Treasurer ``finance.approve`` and ``finance.configure_approvals``.

Both permissions are defined, both gate real endpoints, and **no seeded
position held either**. Only ``it_manager`` could reach them, and only through
its ``*`` wildcard — the IT administrator, not a finance role.

What that cost a department. With no chain configured,
``submit_purchase_request`` takes the ``if chain and chain.steps:`` branch and
skips approval entirely, so requests quietly bypass the workflow rather than
failing visibly. Grant ``finance.configure_approvals`` to somebody and build a
chain *without* also granting ``finance.approve``, and every submitted request
lands in ``PENDING_APPROVAL`` with nobody able to action it. The half-configured
state is the one that strands records, and the settings screen that produces it
was itself unreachable.

Granting approve does not let the treasurer wave through their own spending:
``FinanceService.approve_step`` calls ``assert_different_person`` (SEC FIN-4)
and refuses self-approval whoever holds the permission. Denial is left
unguarded there on purpose — withdrawing your own request is not a conflict.

**Direction: this is an addition, so it is gated.** Pitfall #23 asks for
positive evidence a row is an unrepaired seed, because an unconditional add
overrides a department's own decision while a missing benign grant discloses
nothing. The gate is the row's **finance** grants being exactly
``{finance.view, finance.manage}`` — what the registry seeded before this
change. A row holding either new grant already, or any other finance shape, is
left alone.

Scoped to the finance subset rather than the whole permission list on purpose.
``20260901_1320_f7b3c8d2e569`` matched a whole row and every later migration
that touched those rows moved them out of the match; a whole-row snapshot is
pinned to the build that produced it. Adding a module anywhere else in the
registry cannot move a row across this test.

**What it costs when it is wrong, stated plainly.** An administrator who
deliberately curated the Treasurer to exactly ``finance.view`` +
``finance.manage`` — meaning "no approval powers" — gets the two grants added.
Nothing in the row distinguishes that from the seed it is identical to. The
cost of the opposite choice is a department whose approval chain silently
strands every request, which is the defect this exists to repair, and the
grant is visible and removable on the positions screen.

Guarded on ``positions`` existing. That guard is defensive rather than
load-bearing: ``positions`` **is** created by the chain (the initial schema
builds ``roles``; ``20260805_0008`` renames it, making that a required ancestor
here), so the table is present by the time this runs — the false positive
CLAUDE.md pitfall #26 records being reverted after an empirical
``alembic upgrade head`` against an empty database. Kept because it costs one
reflection and cannot be wrong.

Revision ID: ee7390dcdf47
Revises: d7c1b95e2a40
Create Date: 2026-09-06 21:41:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "ee7390dcdf47"
down_revision = "d7c1b95e2a40"
branch_labels = None
depends_on = None

_SLUG = "treasurer"

# Frozen rather than imported: a migration keeps transforming rows the way it
# did the day it ran (CLAUDE.md pitfall #20).
_ADD = ("finance.approve", "finance.configure_approvals")

# The finance grants the registry seeded for this position before this change.
_SEEDED_FINANCE = frozenset({"finance.view", "finance.manage"})

_FINANCE_PREFIX = "finance."


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _finance_grants(permissions):
    return {p for p in permissions if str(p).startswith(_FINANCE_PREFIX)}


def grant(permissions):
    """Return the row with the two grants appended, or None to leave it.

    None unless the row's finance grants are exactly what the registry seeded.
    A row that already holds either new grant, that has lost ``finance.view``
    or ``finance.manage``, or that carries some other finance permission, was
    curated by somebody and is theirs.
    """
    original = list(permissions)
    if _finance_grants(original) != set(_SEEDED_FINANCE):
        return None
    return original + list(_ADD)


def revoke(permissions):
    """Inverse of :func:`grant`, and only for the shape it produces.

    None unless the row's finance grants are exactly what an upgraded row
    holds, so a downgrade cannot strip a grant an administrator added
    independently.
    """
    original = list(permissions)
    if _finance_grants(original) != set(_SEEDED_FINANCE) | set(_ADD):
        return None
    return [p for p in original if p not in set(_ADD)]


def _rewrite(transform) -> None:
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
        updated = transform(_load_permissions(row.permissions))
        if updated is None:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(updated), "id": row.id},
        )


def upgrade() -> None:
    _rewrite(grant)


def downgrade() -> None:
    _rewrite(revoke)
