"""add public_show_future_stages to membership_pipelines

Lets a department choose whether an applicant's public status page lists the
stages still ahead of them, or only the stages they have completed.

Defaults to true, which is what the status page did before this column existed,
so no existing pipeline changes behaviour on upgrade.

Idempotent in both directions: ``repair_schema.py`` adds model-declared columns
at startup, so the column can already exist when this runs.

Revision ID: 1b52ea3a079e
Revises: 5a70c5dcd138
Create Date: 2026-09-24 15:30:57.994140

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1b52ea3a079e"
down_revision: Union[str, None] = "5a70c5dcd138"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "membership_pipelines"
_COLUMN = "public_show_future_stages"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if _has_table(_TABLE) and not _has_column(_TABLE, _COLUMN):
        op.add_column(
            _TABLE,
            sa.Column(
                _COLUMN,
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )


def downgrade() -> None:
    if _has_table(_TABLE) and _has_column(_TABLE, _COLUMN):
        op.drop_column(_TABLE, _COLUMN)
