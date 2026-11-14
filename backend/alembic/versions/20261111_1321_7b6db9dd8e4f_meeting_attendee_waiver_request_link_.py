"""Meeting attendee waiver request link and one row per member per meeting

Revision ID: 7b6db9dd8e4f
Revises: 09f0171ccf5e
Create Date: 2026-11-11 13:21:00.000000

Two changes to ``meeting_attendees`` for the business-meeting waiver workflow
(owner decisions, 2026-11-10):

1. ``waiver_request_id``, a nullable foreign key to
   ``attendance_waiver_requests`` (SET NULL, so nullable per CLAUDE.md pitfall
   #2): the approved member request a waiver came from. Existing rows get
   NULL, which is right: every waiver stored today was granted by hand.

2. A unique index on ``(meeting_id, user_id)``. Nothing stopped a member
   being entered twice on one meeting, and a second row could make them both
   present and waived, or count twice. **The rows that already break it are
   settled first (pitfall #35), and that step is destructive and cannot be
   reversed** (owner-approved, 2026-11-10). For each (meeting, member) with
   more than one row, one row is kept:

   - a row carrying a waiver, if any does (the most recent of them);
   - otherwise the most recent row (``created_at``, then ``id``).

   The kept row also takes ``present`` and ``excused`` from the others when
   any of them was true, so a check-in recorded only on a removed row is not
   lost (check-in wins, owner decision 2026-11-10). Every other row of the
   group is deleted, and each deletion is logged by its ids (meeting, member,
   removed row, kept row) to the migration log; no free text is logged. The
   deleted rows are not recoverable from the database: the downgrade drops
   the index and the column, but cannot bring them back. Restore the backup
   ``docs/UPGRADING.md`` asks for to recover them.

Both tables are created by migrations (``20260212_0300`` and
``8b1cf6f55425``), but the steps are still guarded on the table and on the
column or index already being there, so a database ``create_all`` built from
the current models, or a second run, changes nothing.
"""

import logging
from typing import Dict, List, Sequence, Tuple, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7b6db9dd8e4f"
down_revision: Union[str, None] = "09f0171ccf5e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

# Named so the migration's test can point it at scratch copies.
ATTENDEES = "meeting_attendees"
REQUESTS = "attendance_waiver_requests"

COLUMN = "waiver_request_id"
FK_NAME = "fk_meeting_attendees_waiver_request"
IX_REQUEST = "idx_meeting_attendees_waiver_request"
UQ_MEETING_USER = "uq_meeting_attendees_meeting_user"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _has_index(table: str, name: str) -> bool:
    return name in {i["name"] for i in _inspector().get_indexes(table)}


def _column_fks(table: str, column: str) -> List[str]:
    """The names of the foreign keys on ``column``, whatever they are called:
    ``create_all`` names its own."""
    return [
        fk["name"]
        for fk in _inspector().get_foreign_keys(table)
        if fk["constrained_columns"] == [column]
    ]


def _keep(rows: List[sa.Row]) -> sa.Row:
    """The row to keep of one (meeting, member) group."""

    def recency(row) -> Tuple:
        # NULL created_at sorts oldest; the id breaks a tie deterministically.
        return (row.created_at is not None, row.created_at or 0, row.id)

    waived = [r for r in rows if r.waiver_reason]
    return max(waived or rows, key=recency)


def _settle_duplicates() -> int:
    """Delete all but one row of each (meeting, member); return how many."""
    conn = op.get_bind()
    table = sa.table(
        ATTENDEES,
        sa.column("id"),
        sa.column("meeting_id"),
        sa.column("user_id"),
        sa.column("present"),
        sa.column("excused"),
        sa.column("waiver_reason"),
        sa.column("created_at"),
    )
    groups = conn.execute(
        sa.select(table.c.meeting_id, table.c.user_id)
        .group_by(table.c.meeting_id, table.c.user_id)
        .having(sa.func.count() > 1)
    ).all()
    removed = 0
    for meeting_id, user_id in groups:
        rows = conn.execute(
            sa.select(table).where(
                table.c.meeting_id == meeting_id, table.c.user_id == user_id
            )
        ).all()
        kept = _keep(rows)
        others = [r for r in rows if r.id != kept.id]
        merged: Dict[str, bool] = {}
        if not kept.present and any(r.present for r in others):
            merged["present"] = True
        if not kept.excused and any(r.excused for r in others):
            merged["excused"] = True
        if merged:
            conn.execute(sa.update(table).where(table.c.id == kept.id).values(**merged))
        for row in others:
            logger.info(
                "meeting_attendees: removed duplicate row %s (meeting %s, member "
                "%s); kept row %s",
                row.id,
                meeting_id,
                user_id,
                kept.id,
            )
        conn.execute(sa.delete(table).where(table.c.id.in_([r.id for r in others])))
        removed += len(others)
    if removed:
        logger.info(
            "meeting_attendees: removed %d duplicate row(s) across %d "
            "(meeting, member) pair(s)",
            removed,
            len(groups),
        )
    return removed


def upgrade() -> None:
    if not _has_table(ATTENDEES):
        return
    if not _has_column(ATTENDEES, COLUMN):
        op.add_column(ATTENDEES, sa.Column(COLUMN, sa.String(36), nullable=True))
    if not _has_index(ATTENDEES, IX_REQUEST):
        op.create_index(IX_REQUEST, ATTENDEES, [COLUMN])
    if _has_table(REQUESTS) and not _column_fks(ATTENDEES, COLUMN):
        op.create_foreign_key(
            FK_NAME, ATTENDEES, REQUESTS, [COLUMN], ["id"], ondelete="SET NULL"
        )
    if not _has_index(ATTENDEES, UQ_MEETING_USER):
        _settle_duplicates()
        op.create_index(
            UQ_MEETING_USER, ATTENDEES, ["meeting_id", "user_id"], unique=True
        )


def downgrade() -> None:
    """Drop the index, the key and the column. The duplicate rows the upgrade
    deleted are not restored: they are gone (see the module docstring)."""
    if not _has_table(ATTENDEES):
        return
    if _has_index(ATTENDEES, UQ_MEETING_USER):
        op.drop_index(UQ_MEETING_USER, table_name=ATTENDEES)
    for name in _column_fks(ATTENDEES, COLUMN):
        op.drop_constraint(name, ATTENDEES, type_="foreignkey")
    if _has_index(ATTENDEES, IX_REQUEST):
        op.drop_index(IX_REQUEST, table_name=ATTENDEES)
    if _has_column(ATTENDEES, COLUMN):
        op.drop_column(ATTENDEES, COLUMN)
