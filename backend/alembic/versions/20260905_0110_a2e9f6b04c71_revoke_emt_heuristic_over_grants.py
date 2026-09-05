"""Revoke the heuristic's over-grants from every seeded EMT row.

Two distinct gaps, both ending on the same rows.

**Release ordering.** ``f3b8d0c26a17`` revokes most of these from ``emt``
already, and this repeats that one slug because a migration runs once.

Until the registry gained an ``emt`` entry, the onboarding wizard offered EMT to
every agency type with nothing seeded behind it, so ``save_session_roles`` took
its create branch and stored the position editor's checkbox expansion — a
role-type heuristic's output, ``reports.view`` included — as an ``is_system``
row. A department that completed onboarding **after** ``f3b8d0c26a17`` was
stamped therefore has a fresh EMT row holding grants that migration was written
to remove, and migrations run once: the revision that would have caught it has
already been applied and will not revisit anything.

The registry entry shipping alongside this closes the source, so the window is
bounded — it opens when ``f3b8d0c26a17`` is deployed and closes when that entry
is. This covers whatever fell inside it, which makes the fix independent of
whether the two land in the same release.

**Two modules no revision ever revoked from this slug.** The heuristic ticked
View for every non-System module, so an EMT row also holds ``facilities.view``
and ``notifications.view``, neither of which the line-member set grants.

* ``notifications.view`` — ``a1f7c34e9b02`` lists ``member``, ``firefighter``
  and ``engineer`` and **not** ``emt``, so *every* wizard-written EMT row still
  carries it, window or not. It opens ``GET /notifications/logs``, the org-wide
  Send Log, which ``NotificationsService.get_logs`` filters on
  ``organization_id`` alone — the recipient, subject and body of every
  notification the department has sent anyone.
* ``facilities.view`` — ``e4f5a6b7c8d9`` does list ``emt``, so the rows that
  existed when it ran were cleaned; every EMT row created since keeps it.

Both are revoked here, in the same three stored forms.

Scoped to ``emt`` alone: the other slugs were seeded throughout, so no row was
being created from the heuristic for them, and the revisions above already
settled the rows that existed for those slugs.

A no-op for a row that is already correct, and for an installation where the
window never opened.

Guarded on the table existing, defensively rather than out of necessity:
``positions`` IS created by the migration chain — the initial schema builds
``roles`` and 20260805_0008 renames it, which makes that a required ancestor of
this revision, so the table is present by the time this runs. An earlier
version of this paragraph claimed the opposite, which is the false positive
CLAUDE.md pitfall #26 records being reverted after an empirical ``alembic
upgrade head`` against an empty database. The guard is kept because it costs
one reflection and cannot be wrong, but it is not load-bearing, and it is not
the pattern to copy for a genuinely create_all-only table.

Revision ID: a2e9f6b04c71
Revises: f3b8d0c26a17
Create Date: 2026-09-05 01:10:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "a2e9f6b04c71"
down_revision = "f3b8d0c26a17"
branch_labels = None
depends_on = None

_SLUG = "emt"

# Every module the heuristic granted this slug and the registry seeds it none
# of, in every form the editor could have stored — ``{module}.view`` for a ticked View box, and
# ``{module}.manage`` plus ``{module}.*`` for a ticked Manage box. Frozen
# rather than imported (CLAUDE.md pitfall #20); the accompanying test asserts
# it against the registry and against what ``f3b8d0c26a17`` revokes.
_OVER_GRANTED_MODULES = (
    # Repeated from f3b8d0c26a17 for this slug.
    "integrations",
    "medical_supplies",
    "mobile",
    "prospective_members",
    "reports",
    # Never revoked from ``emt`` by any revision — see the docstring.
    "facilities",
    "notifications",
)

_REVOKE = tuple(
    f"{module}.{form}"
    for module in _OVER_GRANTED_MODULES
    for form in ("view", "manage", "*")
)


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


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
        permissions = _load_permissions(row.permissions)
        remaining = [item for item in permissions if item not in _REVOKE]
        if remaining == permissions:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(remaining), "id": row.id},
        )


def downgrade() -> None:
    # Deliberately empty, as in f3b8d0c26a17: reversing this would re-grant
    # department-wide reporting to every EMT.
    pass
