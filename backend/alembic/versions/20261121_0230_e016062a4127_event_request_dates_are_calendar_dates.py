"""Event requests: the requested dates are calendar dates

Revision ID: e016062a4127
Revises: 5a41041e328b
Create Date: 2026-11-21 02:30:00.000000

Owner decision, 2026-11-20: a requester's preferred dates are stored as plain
dates and read on the department's calendar. ``event_requests.
preferred_date_start`` and ``preferred_date_end`` change from DATETIME to DATE.

Why: the values were days stored as midnight, and every reader treated them as
UTC instants, so the 15th a requester picked reached the coordinator — and the
requester's own status page — as the evening of the 14th anywhere west of UTC.

Existing rows are settled to the day the requester picked:

* a value at exactly midnight keeps its date. That is every row the public
  form wrote: the JSON endpoint stored the chosen day at UTC midnight, and the
  forms path's "midnight in the department's zone" reached a zoneless DATETIME
  as the same wall-clock midnight;
* any other value is read as UTC and converted to the date on the
  department's calendar (``organizations.timezone``, UTC when that is empty or
  unknown). Only a coordinator-entered request from the branch that preceded
  this revision holds one.

Each such value is first rewritten to midnight on its day, so the type change
truncates nothing (MySQL's strict mode refuses a lossy DATETIME-to-DATE
conversion). Safe to run twice: a column already DATE is left alone. A table
only ``create_all`` builds (CLAUDE.md pitfall #26) is skipped; it is built from
the model, which declares DATE.

The downgrade returns both columns to DATETIME, each date at midnight, which is
how the public form stored them. Nothing is lost either way.
"""

from datetime import datetime, time, timezone
from typing import Sequence, Union
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e016062a4127"
down_revision: Union[str, None] = "5a41041e328b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "event_requests"
ORG_TABLE = "organizations"
COLUMNS = ("preferred_date_start", "preferred_date_end")


def _types() -> dict[str, str]:
    """Column name -> lower-cased SQL type, or empty when the table is absent."""
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return {}
    return {c["name"]: str(c["type"]).lower() for c in inspector.get_columns(TABLE)}


def _zone(name):
    try:
        return ZoneInfo(name) if name else timezone.utc
    except Exception:
        # A hand-typed timezone can be nonsense; UTC is the reading every
        # earlier reader of these values used.
        return timezone.utc


def _requested_day(value: datetime, zone) -> datetime:
    """The day the requester picked, as midnight on that day."""
    if value.time() == time(0, 0):
        return datetime.combine(value.date(), time(0, 0))
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.combine(aware.astimezone(zone).date(), time(0, 0))


def upgrade() -> None:
    types = _types()
    pending = [c for c in COLUMNS if types.get(c, "").startswith("datetime")]
    if not pending:
        return

    bind = op.get_bind()
    columns = ", ".join(f"r.`{c}`" for c in pending)
    rows = bind.execute(
        sa.text(
            f"SELECT r.id, o.timezone, {columns} FROM `{TABLE}` r "
            f"LEFT JOIN `{ORG_TABLE}` o ON o.id = r.organization_id"
        )
    ).fetchall()
    for row in rows:
        zone = _zone(row[1])
        for index, column in enumerate(pending):
            value = row[2 + index]
            if value is None:
                continue
            settled = _requested_day(value, zone)
            if settled != value:
                bind.execute(
                    sa.text(f"UPDATE `{TABLE}` SET `{column}` = :v WHERE id = :id"),
                    {"v": settled, "id": row[0]},
                )

    for column in pending:
        op.alter_column(
            TABLE,
            column,
            existing_type=sa.DateTime(timezone=True),
            type_=sa.Date(),
            existing_nullable=True,
        )


def downgrade() -> None:
    types = _types()
    for column in COLUMNS:
        if types.get(column) == "date":
            op.alter_column(
                TABLE,
                column,
                existing_type=sa.Date(),
                type_=sa.DateTime(timezone=True),
                existing_nullable=True,
            )
