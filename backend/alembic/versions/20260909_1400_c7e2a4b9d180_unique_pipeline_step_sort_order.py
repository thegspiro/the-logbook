"""Make (pipeline_id, sort_order) unique on membership_pipeline_steps

`sort_order` is not display order alone: "the next stage" is an index into a
pipeline's steps sorted by it, so two stages sharing a value make both the
board's column order and the destination of an advance depend on how the sort
happened to break the tie — differently from one page load to the next.

`a3f61c8d27b4` densified the existing rows and the service stopped producing
collisions, but nothing stopped one: the pair carried a plain index. This makes
the database the authority, so a writer that races past the row lock in
`add_step` gets an error rather than a pipeline nobody can order.

Two steps, in this order and not the other:

1. Renumber densely per pipeline, ordering by `(sort_order, created_at, id)` so
   the order coordinators currently see is preserved and a tie breaks toward
   the stage created first. This repeats `a3f61c8d27b4` deliberately — that
   migration ran before the service was hardened, and any drift since would
   otherwise turn this upgrade into a failed deploy.
2. Swap the index for a unique one. MySQL cannot alter an index's uniqueness in
   place, so it is dropped and recreated under the same name.

The renumber walks in ascending order and only ever compacts downward, so it
cannot collide with itself — and it runs while the index is still permissive,
which is why the DDL is last.

Revision ID: c7e2a4b9d180
Revises: f1565c64b658
Create Date: 2026-09-09 14:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7e2a4b9d180"
down_revision: Union[str, None] = "f1565c64b658"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "membership_pipeline_steps"
_INDEX = "idx_pipeline_step_order"
_COLUMNS = ["pipeline_id", "sort_order"]


def _index_exists(connection, table_name: str, index_name: str) -> bool:
    insp = sa.inspect(connection)
    return any(idx["name"] == index_name for idx in insp.get_indexes(table_name))


def _renumber_densely(connection) -> None:
    """Give every pipeline's steps 0..n-1, preserving their current order."""
    rows = connection.execute(
        sa.text(
            f"SELECT id, pipeline_id, sort_order FROM {_TABLE} "
            "ORDER BY pipeline_id, sort_order, created_at, id"
        )
    ).fetchall()

    position: dict = {}
    for row in rows:
        index = position.get(row.pipeline_id, 0)
        position[row.pipeline_id] = index + 1
        if row.sort_order == index:
            continue
        connection.execute(
            sa.text(f"UPDATE {_TABLE} SET sort_order = :order WHERE id = :id"),
            {"order": index, "id": row.id},
        )


def upgrade() -> None:
    connection = op.get_bind()

    # CI upgrades an empty database, and 40 of this schema's tables exist only
    # once create_all() has run. This one is built by a migration, but the
    # guard costs nothing and keeps the whole upgrade from dying on a
    # NoSuchTableError if that ever stops being true.
    if not sa.inspect(connection).has_table(_TABLE):
        return

    _renumber_densely(connection)

    if _index_exists(connection, _TABLE, _INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)
    op.create_index(_INDEX, _TABLE, _COLUMNS, unique=True)


def downgrade() -> None:
    """Return the index to its permissive form.

    The data is left dense: the duplicates this replaced carried no
    information, and a dense ordering is readable by every prior version.
    """
    connection = op.get_bind()

    if not sa.inspect(connection).has_table(_TABLE):
        return

    if _index_exists(connection, _TABLE, _INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)
    op.create_index(_INDEX, _TABLE, _COLUMNS)
