"""prospects: place applicants stranded with no pipeline (W23-1)

A guest who signs in at an event kiosk is created as a prospective member
through ``create_prospect``, which assigned the organization's *default*
pipeline and nothing else. A department whose only pipeline was never marked
default therefore collected applicants with ``pipeline_id`` NULL, no current
stage and no progress rows — on no board, so nobody saw them. Owner decision:
fall back to the sole/first active pipeline, and backfill the stranded rows.

This settles open applications (``active`` and ``on_hold``) only; a closed one
(withdrawn, rejected, inactive, transferred, approved) is history, and placing
it on a board would reopen nothing but would show it at a first stage it never
reached. Each is placed the way ``create_prospect`` now places a new one:

- pipeline: the organization's default pipeline; failing that, its first
  active, non-template pipeline by creation time;
- current stage: that pipeline's lowest-``sort_order`` step;
- one ``prospect_step_progress`` row per step: the first ``in_progress``, the
  rest ``pending``.

A department with no usable pipeline keeps its rows as they are. Each placed
applicant gets a ``prospect_activity_log`` row
(``action = 'pipeline_assigned_by_backfill'``) so the change is visible in the
drawer's activity log and so the downgrade can find exactly what this placed.
The selection rule is inlined, not imported: a migration must keep doing what
it did the day it ran. Idempotent — a placed row no longer has a NULL
pipeline.

Revision ID: e1a5bfe7a2ed
Revises: b834afdaffdf
Create Date: 2026-10-11 12:00:00

"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1a5bfe7a2ed"
down_revision: Union[str, None] = "b834afdaffdf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

BACKFILL_ACTION = "pipeline_assigned_by_backfill"
_OPEN_STATUSES = ("active", "on_hold")
_TABLES = (
    "prospective_members",
    "membership_pipelines",
    "membership_pipeline_steps",
    "prospect_step_progress",
    "prospect_activity_log",
)


def _present(bind) -> bool:
    tables = set(sa.inspect(bind).get_table_names())
    # Any of these can come from create_all rather than a migration on some
    # installations (pitfall #26); without them there is nothing to place.
    return all(t in tables for t in _TABLES)


def _pick_pipeline(bind, organization_id):
    default = bind.execute(
        sa.text(
            "SELECT id FROM membership_pipelines"
            " WHERE organization_id = :org AND is_default = 1"
            " ORDER BY created_at, id LIMIT 1"
        ),
        {"org": organization_id},
    ).scalar()
    if default:
        return default
    return bind.execute(
        sa.text(
            "SELECT id FROM membership_pipelines"
            " WHERE organization_id = :org AND is_active = 1"
            " AND (is_template = 0 OR is_template IS NULL)"
            " ORDER BY created_at, id LIMIT 1"
        ),
        {"org": organization_id},
    ).scalar()


def upgrade() -> None:
    bind = op.get_bind()
    if not _present(bind):
        return

    stranded = bind.execute(
        sa.text(
            "SELECT id, organization_id FROM prospective_members"
            " WHERE pipeline_id IS NULL AND status IN :statuses"
        ).bindparams(sa.bindparam("statuses", expanding=True)),
        {"statuses": list(_OPEN_STATUSES)},
    ).all()
    if not stranded:
        return

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    pipelines = {}
    steps_by_pipeline = {}
    placed = 0
    for prospect_id, organization_id in stranded:
        if organization_id not in pipelines:
            pipelines[organization_id] = _pick_pipeline(bind, organization_id)
        pipeline_id = pipelines[organization_id]
        if not pipeline_id:
            continue
        if pipeline_id not in steps_by_pipeline:
            steps_by_pipeline[pipeline_id] = [
                row[0]
                for row in bind.execute(
                    sa.text(
                        "SELECT id FROM membership_pipeline_steps"
                        " WHERE pipeline_id = :pipeline"
                        " ORDER BY sort_order, id"
                    ),
                    {"pipeline": pipeline_id},
                ).all()
            ]
        step_ids = steps_by_pipeline[pipeline_id]
        first_step = step_ids[0] if step_ids else None

        bind.execute(
            sa.text(
                "UPDATE prospective_members"
                " SET pipeline_id = :pipeline, current_step_id = :step"
                " WHERE id = :id AND pipeline_id IS NULL"
            ),
            {"pipeline": pipeline_id, "step": first_step, "id": prospect_id},
        )
        # A stranded applicant never had progress rows, but do not duplicate
        # one a hand repair may have added.
        existing = {
            row[0]
            for row in bind.execute(
                sa.text(
                    "SELECT step_id FROM prospect_step_progress"
                    " WHERE prospect_id = :id"
                ),
                {"id": prospect_id},
            ).all()
        }
        for step_id in step_ids:
            if step_id in existing:
                continue
            bind.execute(
                sa.text(
                    "INSERT INTO prospect_step_progress"
                    " (id, prospect_id, step_id, status, created_at, updated_at)"
                    " VALUES (:id, :prospect, :step, :status, :now, :now)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "prospect": prospect_id,
                    "step": step_id,
                    "status": "in_progress" if step_id == first_step else "pending",
                    "now": now,
                },
            )
        bind.execute(
            sa.text(
                "INSERT INTO prospect_activity_log"
                " (id, prospect_id, action, details, created_at)"
                " VALUES (:id, :prospect, :action, :details, :now)"
            ),
            {
                "id": str(uuid.uuid4()),
                "prospect": prospect_id,
                "action": BACKFILL_ACTION,
                "details": json.dumps(
                    {
                        "pipeline_id": pipeline_id,
                        "step_id": first_step,
                        "reason": "applicant had no pipeline (W23-1)",
                    }
                ),
                "now": now,
            },
        )
        placed += 1

    if placed:
        logger.warning(
            "Prospects: placed %d applicant(s) that had no pipeline onto their "
            "department's pipeline (W23-1)",
            placed,
        )


def downgrade() -> None:
    """Take back exactly what upgrade placed, found by its activity rows.

    Only the progress rows the backfill could have written are removed — those
    still ``pending`` or ``in_progress`` with no completion — so work a
    coordinator has since recorded on the applicant survives. An applicant
    moved to another pipeline since is left where they are.
    """
    bind = op.get_bind()
    if not _present(bind):
        return
    rows = bind.execute(
        sa.text(
            "SELECT prospect_id, details FROM prospect_activity_log"
            " WHERE action = :action"
        ),
        {"action": BACKFILL_ACTION},
    ).all()
    for prospect_id, details in rows:
        if isinstance(details, (bytes, str)):
            try:
                details = json.loads(details)
            except ValueError:
                details = {}
        pipeline_id = (details or {}).get("pipeline_id")
        result = bind.execute(
            sa.text(
                "UPDATE prospective_members"
                " SET pipeline_id = NULL, current_step_id = NULL"
                " WHERE id = :id AND pipeline_id = :pipeline"
            ),
            {"id": prospect_id, "pipeline": pipeline_id},
        )
        if result.rowcount:
            bind.execute(
                sa.text(
                    "DELETE FROM prospect_step_progress"
                    " WHERE prospect_id = :id AND completed_at IS NULL"
                    " AND status IN ('pending', 'in_progress')"
                ),
                {"id": prospect_id},
            )
    bind.execute(
        sa.text("DELETE FROM prospect_activity_log WHERE action = :action"),
        {"action": BACKFILL_ACTION},
    )
