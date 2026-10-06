"""prospects: reset in-progress rows left ahead of an applicant's current stage

Before regress_prospect was fixed, moving an applicant back a stage left the
stage they vacated marked ``in_progress`` instead of returning it to
``pending``. Those rows survive in long-lived databases, and the applicant
drawer draws one chip per non-pending row, so an applicant could show chips
for stages they have not reached. Owner decision: settle the stored rows.

A row changes only when all of these hold: it is ``in_progress``; its step is
in the same pipeline as the prospect's current step; and that step sorts
*after* the current one. Such a row can only be the old regress residue,
because nothing else marks a stage ahead of the applicant as live. It is set
back to ``pending`` with no completion stamp, exactly what regress_prospect
writes today. The current stage and every stage behind it are untouched.

Irreversible by design: the old value was the defect, and which rows held it
is not kept, so the downgrade does nothing. Idempotent.

Revision ID: 99b16109d44c
Revises: b3e8d5a1c947
Create Date: 2026-10-05 04:00:00

"""

import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "99b16109d44c"
down_revision: Union[str, None] = "b3e8d5a1c947"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

_TABLES = ("prospect_step_progress", "membership_pipeline_steps", "prospective_members")


def upgrade() -> None:
    bind = op.get_bind()
    present = set(sa.inspect(bind).get_table_names())
    # All three come from create_all on some installations (pitfall #26); a
    # database without them has no stale rows to settle.
    if not all(table in present for table in _TABLES):
        return

    rows = bind.execute(
        sa.text(
            "SELECT progress.id"
            " FROM prospect_step_progress AS progress"
            " JOIN membership_pipeline_steps AS step"
            "   ON step.id = progress.step_id"
            " JOIN prospective_members AS prospect"
            "   ON prospect.id = progress.prospect_id"
            " JOIN membership_pipeline_steps AS current_step"
            "   ON current_step.id = prospect.current_step_id"
            " WHERE progress.status = 'in_progress'"
            "   AND step.pipeline_id = current_step.pipeline_id"
            "   AND step.sort_order > current_step.sort_order"
        )
    ).all()
    ids = [row[0] for row in rows]
    if not ids:
        return

    logger.warning(
        "Prospects: %d progress row(s) ahead of the applicant's current stage "
        "were still in_progress and are now pending",
        len(ids),
    )
    progress = sa.table(
        "prospect_step_progress",
        sa.column("id"),
        sa.column("status"),
        sa.column("completed_at"),
        sa.column("completed_by"),
    )
    bind.execute(
        sa.update(progress)
        .where(progress.c.id.in_(ids))
        .values(status="pending", completed_at=sa.null(), completed_by=sa.null())
    )


def downgrade() -> None:
    # Which rows held the stale value is not kept; see the docstring.
    pass
