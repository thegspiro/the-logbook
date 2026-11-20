"""Record the hours an import took from its mapped course

A completion the provider reports with no hours takes its mapped library
course's hours (revision de53b573ad3c). Re-mapping the course moves those
hours to the new course, but must tell them from hours an officer entered,
and it did so by comparing a record with the previous course's settings as
they are now. A course's hours can be edited after crediting; against the new
figure the hour it gave read as an officer's and was left behind, and an
officer's value that happened to equal the new figure was overwritten.

``external_training_imports.course_hours_credited`` (nullable FLOAT) records
the hours each import's record took from its course, so the comparison is
against what was actually given. NULL means it took none.

Existing rows are backfilled. A row is set to its course's hours when its
provider reported none, its record is still linked to the course its provider
course is mapped to, and the record holds that course's hours in both
``hours_completed`` and ``credit_hours`` — the pair the earlier code wrote.
Every other row stays NULL, which re-mapping reads as "took nothing", so a
record whose hours an officer changed is left alone as before. A record whose
course has been edited since it was credited no longer matches its course and
also stays NULL: what it was given is not recorded anywhere, so it is treated
as an officer's, which is how the code before this revision treated it too.
The backfill re-checks its conditions, so a second run changes nothing.

The downgrade drops the column; nothing before this revision reads it.

``external_training_imports`` and the tables the backfill joins may be built
by ``create_all`` rather than a migration on a database that has not started
the app, so each step is skipped when a table is absent or the column already
exists; ``create_all`` then builds the table from the model, column included.

Revision ID: bbeb4867d393
Revises: 053d3e96b4fa
Create Date: 2026-11-16 17:36:52.833345

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bbeb4867d393"
down_revision: Union[str, None] = "053d3e96b4fa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "external_training_imports"
COLUMN = "course_hours_credited"
JOINED = ("training_records", "external_course_mappings", "training_courses")

# Credit Hours when the officer filled it in, otherwise the duration — how
# app.services.external_course_mapping.course_hours reads a course.
_COURSE_HOURS = "ROUND(COALESCE(tc.credit_hours, tc.duration_hours), 2)"

# Hours are single-precision FLOAT, so matching a value needs a tolerance;
# every value written is rounded to two places.
BACKFILL_SQL = f"""
    UPDATE external_training_imports eti
    JOIN training_records tr
      ON tr.id = eti.training_record_id
     AND tr.organization_id = eti.organization_id
    JOIN external_course_mappings ecm
      ON ecm.provider_id = eti.provider_id
     AND ecm.organization_id = eti.organization_id
     AND ecm.external_course_id = eti.external_course_id
    JOIN training_courses tc
      ON tc.id = ecm.internal_course_id
     AND tc.organization_id = ecm.organization_id
    SET eti.course_hours_credited = {_COURSE_HOURS}
    WHERE eti.course_hours_credited IS NULL
      AND COALESCE(eti.credit_hours, 0) <= 0
      AND COALESCE(eti.duration_minutes, 0) <= 0
      AND tr.course_id = ecm.internal_course_id
      AND {_COURSE_HOURS} > 0
      AND ABS(tr.hours_completed - {_COURSE_HOURS}) < 0.005
      AND ABS(COALESCE(tr.credit_hours, 0) - {_COURSE_HOURS}) < 0.005
"""


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _has_column() -> bool:
    columns = sa.inspect(op.get_bind()).get_columns(TABLE)
    return any(c["name"] == COLUMN for c in columns)


def upgrade() -> None:
    tables = _tables()
    if TABLE not in tables:
        return
    if not _has_column():
        op.add_column(TABLE, sa.Column(COLUMN, sa.Float(), nullable=True))
    if all(table in tables for table in JOINED):
        op.execute(BACKFILL_SQL)


def downgrade() -> None:
    if TABLE in _tables() and _has_column():
        op.drop_column(TABLE, COLUMN)
