"""Remove pre-existing SkillTestViewer grants naming a test's own examiner.

SKT3-1 (skills-testing security-review pass 3) added a write-time check in
``add_test_viewer`` rejecting new viewer-grant requests naming the test's own
examiner — the examiner already holds FULL disclosure on their own scoring
(``resolve_result_view`` short-circuits on ``examiner_id`` before any viewer
grant is consulted), so a grant naming them is a no-op the officer could not
tell had done nothing, same reasoning as the pre-existing candidate check.

That guard is write-time only. On an installation upgraded from the previous
release, a direct API caller may already have inserted a ``skill_test_viewers``
row whose ``user_id`` equals that test's ``examiner_id`` before the guard
existed — nothing about POST-time validation touches a row already committed.
Left in place, ``GET /tests/{id}/viewers`` still reports the examiner as an
additional viewer, and the stored grant remains available to any future
disclosure-rule change that stops short-circuiting on ``examiner_id`` first —
the exact persistence risk SKT3-1 was written to eliminate. This migration is
the one-time cleanup: it deletes exactly those rows.

Idempotent: the ``JOIN ... WHERE stv.user_id = st.examiner_id`` condition
matches nothing once the offending rows are gone, so re-running this upgrade
after a clean database (or a second `alembic upgrade head`) is a no-op rather
than an error.

Guarded on the table existing, defensively rather than out of necessity:
``skill_test_viewers`` IS created by the migration chain — 20260807_0009
creates it outright, which makes that a required ancestor of this revision, so
the table is present by the time this runs. An earlier version of this
paragraph claimed the opposite, which is the false positive CLAUDE.md pitfall
#26 records being reverted after an empirical ``alembic upgrade head`` against
an empty database. The guard is kept because it costs one reflection and cannot
be wrong, but it is not load-bearing, and it is not the pattern to copy for a
genuinely create_all-only table.

**This migration is not reversible.** The rows it removes should never have
been creatable in the first place (that is what SKT3-1 enforces going
forward) — there is no correct state to restore them to, so ``downgrade()`` is
a deliberate no-op, matching ``bbdaca0844df``'s handling of a cleanup with the
same shape.

Revision ID: 9d2b4492faba
Revises: c9f2a4b71d38
Create Date: 2026-09-04 18:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "9d2b4492faba"
down_revision = "c9f2a4b71d38"
branch_labels = None
depends_on = None

# MySQL/MariaDB multi-table DELETE syntax — both are in the CI matrix, and
# both support it. A same-table `DELETE ... WHERE id IN (SELECT ...)` on
# `skill_test_viewers` would need the double-subquery workaround for MySQL
# error 1093 (can't select from the table you're deleting from); the JOIN
# form sidesteps that entirely.
_CLEANUP_STATEMENT = sa.text(
    "DELETE stv FROM skill_test_viewers stv "
    "JOIN skill_tests st ON stv.test_id = st.id "
    "WHERE stv.user_id = st.examiner_id"
)


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "skill_tests" not in tables or "skill_test_viewers" not in tables:
        return

    bind.execute(_CLEANUP_STATEMENT)


def downgrade() -> None:
    # Irreversible by design: the removed rows named a test's own examiner as
    # an additional viewer, which SKT3-1 established should never be
    # creatable — there is nothing correct to restore them to.
    pass
