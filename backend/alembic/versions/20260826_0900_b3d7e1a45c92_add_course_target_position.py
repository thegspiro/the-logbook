"""Add training_courses.target_position — the credential-side seat grant.

``TrainingProgram.target_position`` already answers "completing this pipeline
qualifies you to fill this seat". Nothing answered the same question for a
*certification*, so a shift seat could only ever be earned by rank, by a held
position, or by finishing a program — and none of those three expire.

That is what let a lapsed credential keep conferring a seat. A member who
completed a paramedic program in 2019 stayed eligible for a paramedic seat
forever unless an admin had switched ``recert_enabled`` on for that program
(it defaults to false), because ``ProgramEnrollment.status`` sticks at
COMPLETED and nothing else was consulted.

``TrainingRecord`` already carries the department's real record of clearance —
``expiration_date``, ``certification_number``, ``issuing_agency`` — and
``ShiftEligibilityService`` never read it. This column is the missing join:
``TrainingRecord -> TrainingCourse.target_position`` gives the seat, and the
record's own ``expiration_date`` decides whether it still counts, on the same
"null or not yet past" test ``cert_alert_service`` and ``admin_hub_service``
already use.

Nullable with no backfill, deliberately: which courses confer which seat is a
department's own call, and guessing it from a course name would hand out seats
nobody granted. Until a training officer sets it, certifications confer
nothing and eligibility behaves exactly as it did before.

Revision ID: b3d7e1a45c92
Revises: b3e8d1f45a27
Create Date: 2026-08-26 09:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "b3d7e1a45c92"
down_revision = "b3e8d1f45a27"
branch_labels = None
depends_on = None

_TABLE = "training_courses"
_COLUMN = "target_position"
_INDEX = "ix_training_courses_target_position"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def _has_index(table: str, index: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return index in {i["name"] for i in inspector.get_indexes(table)}


def upgrade() -> None:
    # Guarded on the table as well as the column: 39 of this schema's tables
    # are built only by create_all(), and reflecting one that is absent raises
    # NoSuchTableError, which kills the whole upgrade rather than this step.
    # training_courses is migration-created today, but the guard costs nothing
    # and keeps the invariant exception-free.
    if not _has_table(_TABLE):
        return

    if not _has_column(_TABLE, _COLUMN):
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.String(100), nullable=True))

    if not _has_index(_TABLE, _INDEX):
        op.create_index(_INDEX, _TABLE, [_COLUMN])


def downgrade() -> None:
    if not _has_table(_TABLE):
        return

    if _has_index(_TABLE, _INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)

    if _has_column(_TABLE, _COLUMN):
        op.drop_column(_TABLE, _COLUMN)
