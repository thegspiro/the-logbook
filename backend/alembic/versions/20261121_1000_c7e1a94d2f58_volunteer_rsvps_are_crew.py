"""Events: a volunteer's RSVP is marked, and does not take an attendee seat

Revision ID: c7e1a94d2f58
Revises: 3daf47506e9e
Create Date: 2026-11-21 10:00:00.000000

Owner decision, 2026-11-21: a member who claims a role on an outreach event's
signup sheet is crew, not audience. Their RSVP still says they are going (so
they appear in Attendance and at the head of check-in), but it no longer counts
toward ``max_attendees``; the sheet's own role counts cap the crew. Adds
``event_rsvps.is_volunteer`` (BOOLEAN NOT NULL, server default false).

Existing rows: the column is added with a server default, so every existing
row reads false — an audience RSVP, exactly as it counted before. Then the
volunteer RSVPs the 2026-11-20 sync already created are found and marked: a
``going`` RSVP whose member holds a live seat (not cancelled or declined) on
the signup sheet that staffs the event — the event's own sheet, or the sheet
of the request it was scheduled from. A member who RSVP'd as audience and then
claimed a role is marked too, which is what the sync now does for them.

Safe to run twice: the column is added only when missing, and the backfill
sets a value that a second pass sets again. A table only ``create_all`` builds
(CLAUDE.md pitfall #26) is skipped; it is built from the model.

The downgrade drops the column; volunteer RSVPs then count as seats again, as
they did before this revision.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7e1a94d2f58"
down_revision: Union[str, None] = "3daf47506e9e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "event_rsvps"
COLUMN = "is_volunteer"
EVENTS = "events"
ASSIGNMENTS = "shift_assignments"
REQUESTS = "event_requests"

# A member holds a seat unless the row was cancelled or declined — the same
# statuses as ``released_seat_statuses`` in the service, frozen here because a
# migration must keep doing what it did the day it ran (pitfall #20).
_LIVE_SEAT = "a.assignment_status NOT IN ('cancelled', 'declined')"


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _mark_volunteers(owner: str) -> None:
    """Mark going RSVPs whose member holds a live seat on ``owner``'s sheet.

    ``owner`` is the events table (its own sheet, joined on the event's id) or
    the requests table (the sheet of the request scheduled onto the event).
    """
    on = "o.id = r.event_id" if owner == EVENTS else "o.event_id = r.event_id"
    op.execute(f"""
        UPDATE `{TABLE}` r
        JOIN `{owner}` o
          ON {on} AND o.organization_id = r.organization_id
        JOIN `{ASSIGNMENTS}` a
          ON a.shift_id = o.staffing_shift_id
         AND a.user_id = r.user_id
         AND a.organization_id = r.organization_id
        SET r.{COLUMN} = 1
        WHERE r.status = 'going' AND {_LIVE_SEAT}
        """)


def upgrade() -> None:
    tables = _tables()
    if TABLE not in tables:
        return
    if COLUMN not in _columns(TABLE):
        op.add_column(
            TABLE,
            sa.Column(COLUMN, sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    # Without the sheets there are no volunteer RSVPs to mark.
    if ASSIGNMENTS not in tables:
        return
    for owner in (EVENTS, REQUESTS):
        if owner in tables and "staffing_shift_id" in _columns(owner):
            _mark_volunteers(owner)


def downgrade() -> None:
    if TABLE in _tables() and COLUMN in _columns(TABLE):
        op.drop_column(TABLE, COLUMN)
