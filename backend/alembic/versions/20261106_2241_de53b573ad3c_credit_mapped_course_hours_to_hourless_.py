"""Credit a mapped course's hours to imports the provider reported as zero

Target Solutions reports a policy acknowledgment with zero hours, and an
import credited exactly what the provider reported, so a completion mapped to
a library course the department counts as an hour landed on the member's
record as 0. Imports now take the mapped course's hours when the provider
reports none (Credit Hours, or the course's duration when Credit Hours is
blank), and mapping a course updates the records already imported from it.

This backfills the records imported before that change. A record is updated
only when all of these hold:

* its staged import reported no hours (``credit_hours`` and
  ``duration_minutes`` both null or zero) — hours a provider did report are
  what the course was accredited for, and stand;
* it is still linked to the library course its provider course is mapped to —
  a record an officer linked to another course by hand is left alone;
* it holds zero hours — hours an officer typed in are left alone;
* the course credits some hours.

``hours_completed`` and ``credit_hours`` both take the course's hours. Every
condition is re-checked on a second run, which then finds nothing to change.

The downgrade returns to zero the records that match the same conditions and
hold exactly the course's hours, which is what the code before this revision
would have written for them; ``credit_hours`` goes back to what the staged
import reported. A record whose officer set it to the course's hours by hand
cannot be told apart and is returned to zero with the rest.

Any of these tables may be built by ``create_all`` rather than a migration on
a database that has not started the app, so the step is skipped when one is
absent; such a database has no imported records to correct.

Revision ID: de53b573ad3c
Revises: ee9ff4596ce7
Create Date: 2026-11-06 22:41:23.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "de53b573ad3c"
down_revision: Union[str, None] = "ee9ff4596ce7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = (
    "training_records",
    "external_training_imports",
    "external_course_mappings",
    "training_courses",
)

# Credit Hours when the officer filled it in, otherwise the duration — how a
# session of the course reads it (app.services.external_course_mapping).
_COURSE_HOURS = "ROUND(COALESCE(tc.credit_hours, tc.duration_hours), 2)"

_JOINS = """
    training_records tr
    JOIN external_training_imports eti
      ON eti.training_record_id = tr.id
     AND eti.organization_id = tr.organization_id
    JOIN external_course_mappings ecm
      ON ecm.provider_id = eti.provider_id
     AND ecm.organization_id = eti.organization_id
     AND ecm.external_course_id = eti.external_course_id
    JOIN training_courses tc
      ON tc.id = ecm.internal_course_id
     AND tc.organization_id = ecm.organization_id
"""

_CONDITIONS = f"""
    COALESCE(eti.credit_hours, 0) <= 0
    AND COALESCE(eti.duration_minutes, 0) <= 0
    AND tr.course_id = ecm.internal_course_id
    AND {_COURSE_HOURS} > 0
"""


UPGRADE_SQL = f"""
    UPDATE {_JOINS}
    SET tr.hours_completed = {_COURSE_HOURS},
        tr.credit_hours = {_COURSE_HOURS}
    WHERE {_CONDITIONS}
      AND tr.hours_completed <= 0
"""

# Hours are single-precision FLOAT, so "holds the course's hours" needs a
# tolerance; every value the upgrade wrote is rounded to two places.
DOWNGRADE_SQL = f"""
    UPDATE {_JOINS}
    SET tr.hours_completed = 0,
        tr.credit_hours = eti.credit_hours
    WHERE {_CONDITIONS}
      AND ABS(tr.hours_completed - {_COURSE_HOURS}) < 0.005
"""


def _tables_present() -> bool:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    return all(table in existing for table in TABLES)


def upgrade() -> None:
    if not _tables_present():
        return
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    if not _tables_present():
        return
    op.execute(DOWNGRADE_SQL)
