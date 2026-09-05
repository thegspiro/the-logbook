"""Mark pre-existing count-only shift reports as carrying org call-type slugs.

Revision ID: a3d7e2f18c45
Revises: c8f4a1e6b309

``ShiftCompletionReport.call_types`` holds two different things. Under
per-incident (detailed) tracking it holds the incident text an officer typed;
under count-only tracking it holds the organization's own type slugs, copied
from the shift's tally. Only the second may be resolved through the
department's label list — relabelling the first rewrites an officer's words the
day a type whose slug happens to match gets renamed.

The application now records which, in ``data_sources["call_types"]``. Every row
written before it did says ``shift_calls``, because that was the only value the
old code wrote, for both paths. Left alone, those rows read as the officer's
own wording, which costs them two things: their labels (they render the raw
slug), and their standing as a reason not to delete a type — a report naming
``brush`` would stop locking that type once its last ``OrgCall`` was gone,
and deleting it would leave the report unlabelled for good.

The distinguishing fact is still on the database: a count-only shift has no
``shift_calls`` rows. This rewrites the marker for exactly those.

**Irreversible in the strict sense.** The downgrade restores ``shift_calls``
for the rows it set, which is the value they held — but a row that legitimately
gains that marker between upgrade and downgrade is indistinguishable from one
this migration touched, so the downgrade is written to be narrow rather than
exact: it only reverts rows whose shift still has no incident rows.
"""

import sqlalchemy as sa
from alembic import op

revision = "a3d7e2f18c45"
down_revision = "c8f4a1e6b309"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    """Whether the table exists yet.

    Not every table in this schema is created by a migration, and CI runs
    ``alembic upgrade head`` against an empty database before the application
    ever calls ``create_all``. Touching a table that is not there takes the
    whole upgrade down, and skipping is correct rather than merely safe: a
    table built later is built from the models, and a database with no shift
    reports in it has nothing to backfill.
    """
    return table in sa.inspect(op.get_bind()).get_table_names()


def _rewrite(from_value: str, to_value: str) -> None:
    """Repoint the call-type marker for reports whose shift logged no calls."""
    op.execute(sa.text("""
            UPDATE shift_completion_reports r
               SET r.data_sources = JSON_SET(
                       r.data_sources, '$.call_types', :to_value
                   )
             WHERE r.shift_id IS NOT NULL
               AND r.data_sources IS NOT NULL
               AND JSON_UNQUOTE(
                       JSON_EXTRACT(r.data_sources, '$.call_types')
                   ) = :from_value
               AND NOT EXISTS (
                       SELECT 1 FROM shift_calls c WHERE c.shift_id = r.shift_id
                   )
            """).bindparams(from_value=from_value, to_value=to_value))


def upgrade() -> None:
    if not (_has_table("shift_completion_reports") and _has_table("shift_calls")):
        return
    _rewrite("shift_calls", "org_calls")


def downgrade() -> None:
    if not (_has_table("shift_completion_reports") and _has_table("shift_calls")):
        return
    _rewrite("org_calls", "shift_calls")
