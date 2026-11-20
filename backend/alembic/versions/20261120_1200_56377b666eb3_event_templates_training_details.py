"""Event templates: add training details

Revision ID: 56377b666eb3
Revises: bc58d756a179
Create Date: 2026-11-20 12:00:00.000000

Adds ``event_templates.training_details`` (JSON, nullable): the training
details a Training template fills in when it is picked — the course (a library
course, a one-off name and code, or none), the training type, credit hours and
their source, the lead instructor, and the certification settings. Owner
decision of 2026-11-20. Only a Training template may carry it, and the
application writes one canonical shape (``EventTemplateTrainingDetails``).

Existing rows: the column is nullable with no default, so every existing
template gets NULL, which means "no saved training details" — the training
form opens on its defaults, exactly as before. No row is rewritten.

Safe to run twice: the column is added only when the table exists and the
column does not. The downgrade drops the column, which loses any training
details saved on templates; events already created from a template are
unaffected, because their training details live in ``training_sessions``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "56377b666eb3"
down_revision: Union[str, None] = "bc58d756a179"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "event_templates"
COLUMN = "training_details"


def _table_and_column() -> tuple[bool, bool]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return False, False
    return True, COLUMN in {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    has_table, has_column = _table_and_column()
    if has_table and not has_column:
        op.add_column(TABLE, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    has_table, has_column = _table_and_column()
    if has_table and has_column:
        op.drop_column(TABLE, COLUMN)
