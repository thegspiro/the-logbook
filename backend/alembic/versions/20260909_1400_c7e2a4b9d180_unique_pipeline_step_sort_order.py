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
2. Create the unique index under its own name, *then* drop the old one.

Step 2's ordering is not stylistic. Reversing it back into the obvious
drop-then-create breaks MySQL 8.0 outright:

    (1553, "Cannot drop index 'idx_pipeline_step_order':
            needed in a foreign key constraint")

`membership_pipeline_steps.pipeline_id` is a foreign key to
`membership_pipelines.id` and carries no index of its own, so InnoDB leans on
`idx_pipeline_step_order` — the only index with `pipeline_id` leftmost — to
enforce it. Dropping that index first leaves the constraint unsupported and
MySQL refuses. MariaDB quietly substitutes another index and allows it, which
is why the first draft passed on MariaDB, locally and in half of CI, while
failing every MySQL 8.0 job. Creating `uq_pipeline_step_order` first gives the
foreign key a replacement with `pipeline_id` leftmost, so the drop is then
legal on both engines.

The name changes along with the uniqueness because this repository spells
unique indexes `uq_` and plain ones `idx_` (`uq_prospect_org_active_email` is
in the same model file); an index called `idx_` that rejects duplicates is a
trap for whoever reads the schema next.

That ordering also decides what a *failed* upgrade leaves behind. `alembic
upgrade head` runs before the backend restarts on the documented traditional
deployment (`docs/DEPLOYMENT.md`), so the old code — the code that still emits
colliding `sort_order` values — is live while this runs, and a write landing
between the renumber and the DDL makes `CREATE UNIQUE INDEX` fail with error
1062. Because DDL commits implicitly, no lock can span the renumber and the
index swap: this migration cannot be made atomic against a live writer.
Creating before dropping makes the failure *safe* instead — nothing has been
dropped, the schema is exactly as it started, the revision has not moved, and
the operator retries with the backend stopped. Drop-first left a database with
no ordering index at all, still on the old revision.

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
_OLD_INDEX = "idx_pipeline_step_order"
_NEW_INDEX = "uq_pipeline_step_order"
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

    # Create before drop; see the module docstring. Both halves are guarded so
    # that a retry after a failed upgrade — the exact case this ordering exists
    # to make survivable — is a no-op rather than a second error.
    if not _index_exists(connection, _TABLE, _NEW_INDEX):
        op.create_index(_NEW_INDEX, _TABLE, _COLUMNS, unique=True)
    if _index_exists(connection, _TABLE, _OLD_INDEX):
        op.drop_index(_OLD_INDEX, table_name=_TABLE)


def downgrade() -> None:
    """Return the ordering index to its permissive form.

    Create before drop here too, and for the same reason: dropping
    ``uq_pipeline_step_order`` while it is the only index supporting the
    ``pipeline_id`` foreign key fails with error 1553 on MySQL 8.0.

    The data is left dense: the duplicates this replaced carried no
    information, and a dense ordering is readable by every prior version.
    """
    connection = op.get_bind()

    if not sa.inspect(connection).has_table(_TABLE):
        return

    if not _index_exists(connection, _TABLE, _OLD_INDEX):
        op.create_index(_OLD_INDEX, _TABLE, _COLUMNS)
    if _index_exists(connection, _TABLE, _NEW_INDEX):
        op.drop_index(_NEW_INDEX, table_name=_TABLE)
