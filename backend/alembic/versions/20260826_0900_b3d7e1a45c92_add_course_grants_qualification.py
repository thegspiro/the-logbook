"""Add training_courses.grants_qualification — the writer for member_qualifications.

``member_qualifications`` records what a member is certified to do and when
that certification lapses, and it is read by shift eligibility. Nothing wrote
to it: a training officer had to record the class that happened *and* grant the
qualification separately, on another screen, and the second entry is the one
that gets forgotten — leaving a member certified on paper and unqualified in
the scheduler.

The course already knows what it certifies. This column names the qualification
code completing it grants, so ``TrainingRecord`` — which already carries the
completion date, the expiry, the certificate number and the issuing agency —
becomes the single place the fact is entered.

Nullable with no backfill, deliberately. Which courses certify what is a
department's own call, and inferring it from a course name would grant
qualifications nobody awarded. Until a training officer sets it, completing a
course grants nothing and eligibility behaves exactly as it does today.

Revision ID: b3d7e1a45c92
Revises: a7b8c9d0e1f2
Create Date: 2026-08-26 09:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "b3d7e1a45c92"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None

_TABLE = "training_courses"
_COLUMN = "grants_qualification"
_INDEX = "ix_training_courses_grants_qualification"


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
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.String(50), nullable=True))

    if not _has_index(_TABLE, _INDEX):
        op.create_index(_INDEX, _TABLE, [_COLUMN])


def downgrade() -> None:
    if not _has_table(_TABLE):
        return

    if _has_index(_TABLE, _INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)

    if _has_column(_TABLE, _COLUMN):
        op.drop_column(_TABLE, _COLUMN)
