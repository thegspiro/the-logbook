"""Give every membership pipeline step a unique sort_order

`sort_order` is not only display order on the applicant board: "the next
stage" is an index into the pipeline's steps sorted by it, so two steps
sharing a value make both the column order and the destination of an advance
depend on how the sort happened to break the tie.

Two paths produced ties. The stage builder numbered a new stage from the
*count* of existing stages, and `delete_step` removed a stage without closing
the gap it left — so once any middle stage had been deleted, the next stage
added landed on a number a survivor already held. Both are fixed in
`MembershipPipelineService`; this renumbers the pipelines that already drifted.

Steps are renumbered densely from 0 within each pipeline, ordered by
`(sort_order, created_at, id)`, so the order a coordinator currently sees is
preserved and a tie breaks toward the stage that was created first. Nothing is
added, dropped or deleted, and re-running is a no-op once a pipeline is dense.
`is_final_step` is deliberately untouched: `reorder_steps` owns that
normalization and inferring it here could invent an auto-transfer trigger
nobody configured.

Revision ID: a3f61c8d27b4
Revises: 1603bd9c59e7
Create Date: 2026-09-08 18:30:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3f61c8d27b4"
down_revision: Union[str, None] = "1603bd9c59e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "membership_pipeline_steps"


def upgrade() -> None:
    connection = op.get_bind()

    # CI upgrades an empty database, and 40 of this schema's tables exist only
    # once create_all() has run. This one is built by a migration, but the
    # guard costs nothing and keeps the whole upgrade from dying on a
    # NoSuchTableError if that ever stops being true.
    if not sa.inspect(connection).has_table(_TABLE):
        return

    rows = connection.execute(
        sa.text(
            f"SELECT id, pipeline_id, sort_order FROM {_TABLE} "
            "ORDER BY pipeline_id, sort_order, created_at, id"
        )
    ).fetchall()

    position: dict[str, int] = {}
    for row in rows:
        pipeline_id = row.pipeline_id
        index = position.get(pipeline_id, 0)
        position[pipeline_id] = index + 1
        if row.sort_order == index:
            continue
        connection.execute(
            sa.text(f"UPDATE {_TABLE} SET sort_order = :order WHERE id = :id"),
            {"order": index, "id": row.id},
        )


def downgrade() -> None:
    """No-op: the duplicate sort_order values this replaced carried no
    information. Their only effect was to make column order and the target of
    an advance arbitrary, and a dense ordering is readable by every prior
    application version."""
