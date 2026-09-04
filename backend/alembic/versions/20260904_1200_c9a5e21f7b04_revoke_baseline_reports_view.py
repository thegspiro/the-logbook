"""Revoke reports.view from the baseline member and firefighter positions.

``reports.view`` is a leadership grant — it lives in
``_LEADERSHIP_VIEW_PERMISSIONS`` and reaches the baseline set through neither
``DEFAULT_POSITIONS["member"]`` nor the Firefighter rank. It opens
Administration → Reports: the report catalog (``GET /reports/available``),
report generation (``POST /reports/generate``) and every saved report
(``GET /reports/saved``, ``POST /reports/saved/{id}/run``). Those aggregate
across the whole department rather than scoping to the holder, which is the
same argument that removed ``compliance.view`` in ``31e2816df7c3``.

It is also enough on its own to open the Administration section:
``ADMIN_NAVIGATION_PERMISSIONS`` lists it, so a member carrying it sees an
admin area rather than a single stray link.

The registry has always been right. The grant reached departments through the
onboarding position editor, which derived its checkbox defaults from a "a
member views every module whose category is not System" heuristic instead of
from ``DEFAULT_POSITIONS``, and saved that over the seeded rows on the first
Continue. Reports is its own ``PermissionCategory.REPORTS``, so the heuristic
ticked it. ``dependencies.py`` unions every assigned position's stored
permissions, so it is a live grant (CLAUDE.md pitfall #23).

**Why ``f7b3c8d2e569`` did not already fix this.** That migration was written
for this exact overwrite and does drop ``reports.view`` from ``member`` and
``firefighter`` — but only on a row matching the heuristic's output *in full*,
because the old save was a replacement and an edited row is the department's
own. Four earlier migrations mutate those same rows before it runs
(``31e2816df7c3`` strips ``compliance.view``, ``a1f7c34e9b02``
``notifications.view``, ``a4f8c1b92d17`` adds the storefront grants,
``e4f5a6b7c8d9`` strips ``facilities.view``), while its ``old`` list still
carries ``facilities.view`` and ``notifications.view``. So it matches only a
department that onboarded *after* those ran and before the editor was fixed.
One that onboarded earlier holds the heuristic output minus those revocations
— one permission off, so the row is skipped and the grant survives.

Removing the single permission, whatever else the row holds, is immune to that
ordering. It is the shape ``31e2816df7c3`` and ``a1f7c34e9b02`` already use.

Both slugs need rewriting. ``operational_ranks`` genuinely has no permissions
column — rank defaults resolve at runtime from ``OPERATIONAL_RANKS`` — but
``DEFAULT_POSITIONS["firefighter"]["permissions"]`` *is*
``OPERATIONAL_RANKS["firefighter"]["default_permissions"]``, the same list
object, so onboarding also writes a system position with slug ``firefighter``
carrying a copy. A member holding it would keep the grant if only ``member``
were rewritten.

Scoped to ``is_system = True``: a department that has customized a position of
its own keeps whatever it put there.

Guarded on the table existing: ``positions`` is one of the tables no migration
creates — it comes into being when ``main.py`` calls ``create_all()``, and CI
runs ``alembic upgrade head`` against an empty database, so reflecting it
unguarded would fail the whole upgrade rather than this one step (CLAUDE.md
pitfall #26).

Revision ID: c9a5e21f7b04
Revises: bbdaca0844df
Create Date: 2026-09-04 12:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "c9a5e21f7b04"
down_revision = "bbdaca0844df"
branch_labels = None
depends_on = None

_PERMISSION = "reports.view"
_SLUGS = ("member", "firefighter")


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


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
            permissions = _load_permissions(row.permissions)
            if _PERMISSION not in permissions:
                continue
            permissions = [item for item in permissions if item != _PERMISSION]
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(permissions), "id": row.id},
            )


def downgrade() -> None:
    # Deliberately empty. Restoring the grant would reopen department-wide
    # reporting — every member's aggregated hours, training and roster data —
    # to the whole department, which is the defect rather than a prior state
    # worth returning to.
    pass
