"""Historical import: training

Adds ``historical_imports.training_settings``, a nullable JSON column holding
how a historical import's training rows become training records: which columns
give the subject and instructor, which flag says the member taught the class,
how each subject maps to a course, and what to do with rows a training provider
may already have synced.

Existing imports have none and read it as empty. No other table is touched.
The downgrade drops the column, losing only those settings; training records an
import already wrote are kept.

Revision ID: 514dca8e6de3
Revises: 8da91e9d28d6
Create Date: 2026-11-04 14:37:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "514dca8e6de3"
down_revision: Union[str, None] = "8da91e9d28d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

IMPORTS = "historical_imports"
COLUMN = "training_settings"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if IMPORTS not in inspector.get_table_names():
        return False
    return COLUMN in {c["name"] for c in inspector.get_columns(IMPORTS)}


def _has_table() -> bool:
    return IMPORTS in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table() and not _has_column():
        op.add_column(IMPORTS, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_column():
        op.drop_column(IMPORTS, COLUMN)
