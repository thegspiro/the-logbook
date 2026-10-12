"""screening record self recorded flag

MS-7 (owner decision 2026-10-05): a ``medical_screening.manage`` holder may
record their own screening, but the result is flagged rather than trusted
silently. ``screening_records.self_recorded`` is true when the record's status
was last set by the member it is about; the compliance views show it.

Backfill, best effort from what was already stored:

- ``reviewed_by = user_id`` — the subject saved a passed/failed/waived status
  on their own record, which is the self-clearance MS-7 describes.
- otherwise, with no reviewer recorded, a ``medical_screening.record_created``
  audit event written by the subject for that record id (the id has been on
  the event since MS-8). Older events without the id cannot be matched, and an
  update to a non-decisive status left no reviewer, so a few rows may read as
  not self-recorded when they were. Nothing is marked that the stored data
  does not show.

The downgrade drops the column; nothing before this revision read it.

Revision ID: 9c1445489666
Revises: 15802f3df5c4
Create Date: 2026-10-05 23:37:48.124330

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9c1445489666"
down_revision: Union[str, None] = "15802f3df5c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "screening_records"
_COLUMN = "self_recorded"


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns() -> set:
    if _TABLE not in _tables():
        return set()
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    # No table: create_all builds it later from the model, column included.
    if not columns or _COLUMN in columns:
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN,
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
            comment="Status last set by the record's own subject (MS-7).",
        ),
    )
    op.execute(
        sa.text(
            f"UPDATE {_TABLE} SET {_COLUMN} = 1 "
            "WHERE user_id IS NOT NULL AND reviewed_by = user_id"
        )
    )
    if "audit_logs" in _tables():
        # Both sides converted to one character set: JSON_UNQUOTE yields a
        # binary-collated string, and comparing it with the id column's own
        # collation can be refused as an illegal mix.
        op.execute(
            sa.text(
                f"UPDATE {_TABLE} sr "
                "JOIN audit_logs al "
                "ON al.event_type = 'medical_screening.record_created' "
                "AND al.user_id = sr.user_id "
                "AND CONVERT(JSON_UNQUOTE(JSON_EXTRACT(al.event_data, "
                "'$.record_id')) USING utf8mb4) = CONVERT(sr.id USING utf8mb4) "
                f"SET sr.{_COLUMN} = 1 "
                "WHERE sr.reviewed_by IS NULL AND sr.user_id IS NOT NULL"
            )
        )


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)
