"""Revoke the EMT over-grants from rows written after ``f3b8d0c26a17`` ran.

``f3b8d0c26a17`` already revokes these from ``emt``. This repeats that one slug,
and the reason is release ordering rather than anything wrong with it.

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

Scoped to ``emt`` alone: the other slugs were seeded throughout, so no row was
being created from the heuristic for them during the window, and ``f3b8d0c26a17``
already settled the rows that existed.

A no-op for a row that is already correct, and for an installation where the
window never opened.

Guarded on the table existing: ``positions`` is one of the tables no migration
creates — it appears when ``main.py`` calls ``create_all()``, and CI runs
``alembic upgrade head`` against an empty database (CLAUDE.md pitfall #26).

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

# The same set ``f3b8d0c26a17`` revokes from this slug, in every form the
# editor could have stored — ``{module}.view`` for a ticked View box, and
# ``{module}.manage`` plus ``{module}.*`` for a ticked Manage box. Frozen
# rather than imported (CLAUDE.md pitfall #20); the accompanying test asserts
# it still matches that revision and the registry.
_OVER_GRANTED_MODULES = (
    "integrations",
    "medical_supplies",
    "mobile",
    "prospective_members",
    "reports",
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
