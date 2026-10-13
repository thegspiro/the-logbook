"""Crew-recorded training submissions

A shift officer can now record a drill for the members present, filing one
pending submission per member for the training officer to review. Three
nullable columns on ``training_submissions`` carry that:

* ``recorded_by`` (``SET NULL`` to ``users``) — the officer who filed the
  entry on the member's behalf. Barred from approving it.
* ``crew_batch_id`` (indexed) — shared by every submission filed together, so
  the review queue can approve the crew in one action.
* ``shift_id`` (``SET NULL`` to ``shifts``) — the shift the training ran on,
  when the officer picked one.

No row is backfilled: every existing submission is self-reported and keeps
NULL in all three, which is what a self-report means. ``training_submissions``
and ``shifts`` are created by migrations, but each step still checks for the
table and column so a re-run, or a database ``create_all`` built, is a no-op.

The downgrade drops the three columns. Crew submissions already filed stay in
the queue as ordinary submissions under the member's name; only the record of
who filed them, and their grouping, is lost.

Revision ID: cc91959dbaff
Revises: 390fa30d0200
Create Date: 2026-10-11 22:31:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cc91959dbaff"
down_revision: Union[str, None] = "390fa30d0200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "training_submissions"
FK_RECORDED_BY = "fk_training_submissions_recorded_by"
FK_SHIFT = "fk_training_submissions_shift_id"
IX_BATCH = "ix_training_submissions_crew_batch_id"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _fk_names(table: str) -> set[str]:
    return {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def _index_names(table: str) -> set[str]:
    return {ix.get("name") for ix in _inspector().get_indexes(table)}


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    existing = _columns(TABLE)
    if "recorded_by" not in existing:
        op.add_column(TABLE, sa.Column("recorded_by", sa.String(36), nullable=True))
    if "crew_batch_id" not in existing:
        op.add_column(TABLE, sa.Column("crew_batch_id", sa.String(36), nullable=True))
    if "shift_id" not in existing:
        op.add_column(TABLE, sa.Column("shift_id", sa.String(36), nullable=True))

    if IX_BATCH not in _index_names(TABLE):
        op.create_index(IX_BATCH, TABLE, ["crew_batch_id"])

    fks = _fk_names(TABLE)
    if FK_RECORDED_BY not in fks and _has_table("users"):
        op.create_foreign_key(
            FK_RECORDED_BY,
            TABLE,
            "users",
            ["recorded_by"],
            ["id"],
            ondelete="SET NULL",
        )
    if FK_SHIFT not in fks and _has_table("shifts"):
        op.create_foreign_key(
            FK_SHIFT,
            TABLE,
            "shifts",
            ["shift_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    fks = _fk_names(TABLE)
    if FK_SHIFT in fks:
        op.drop_constraint(FK_SHIFT, TABLE, type_="foreignkey")
    if FK_RECORDED_BY in fks:
        op.drop_constraint(FK_RECORDED_BY, TABLE, type_="foreignkey")
    if IX_BATCH in _index_names(TABLE):
        op.drop_index(IX_BATCH, table_name=TABLE)
    existing = _columns(TABLE)
    for column in ("shift_id", "crew_batch_id", "recorded_by"):
        if column in existing:
            op.drop_column(TABLE, column)
