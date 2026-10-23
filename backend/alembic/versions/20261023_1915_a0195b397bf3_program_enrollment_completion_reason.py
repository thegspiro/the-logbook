"""Program enrollments record why an officer completed them by hand

``program_enrollments.completion_reason`` (TEXT, nullable) holds the reason an
officer gave when marking a member's whole pipeline complete through
``POST /training/programs/enrollments/{id}/complete``. Until now that reason
lived only in the ``training_enrollment_completed_manually`` audit event. An
automatic completion leaves it NULL, and the column is cleared whenever an
enrollment stops being COMPLETED, so a reason never sits on an active
enrollment.

Nothing is backfilled: the reasons for completions made before this revision
are in the audit log, and the pipeline page shows none for them.

Idempotent. The step is skipped when the column already exists, and when the
table does not exist yet: a table ``create_all`` builds later is built from
the model, which already declares the column (pitfall #26).

The downgrade drops the column, discarding every stored reason. The audit log
keeps each one, in the ``reason`` of its
``training_enrollment_completed_manually`` event.

Revision ID: a0195b397bf3
Revises: 4250eb8b8378
Create Date: 2026-10-23 19:15:47.668983

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a0195b397bf3"
down_revision: Union[str, None] = "4250eb8b8378"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "program_enrollments"
COLUMN = "completion_reason"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    if _has_table(TABLE) and not _has_column(TABLE, COLUMN):
        op.add_column(TABLE, sa.Column(COLUMN, sa.Text(), nullable=True))


def downgrade() -> None:
    if _has_table(TABLE) and _has_column(TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)
