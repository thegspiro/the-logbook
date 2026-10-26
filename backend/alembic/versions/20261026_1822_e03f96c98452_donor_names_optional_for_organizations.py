"""donor names optional for organizations

W69-6: a business, foundation or government donor may be recorded by its
organization name alone, so ``donors.first_name`` and ``donors.last_name``
become nullable. FundraisingService still requires both for an individual.

Widening a column to nullable settles every existing row as it is: each one
already holds both names. ``donors`` is built by ``create_all`` and by no
migration, so the step is skipped on a database that has not started the app
yet; ``create_all`` then builds the table from the model, which already
declares the columns nullable.

Downgrade writes an empty string into any name an organization donor left
blank, then restores NOT NULL. Those rows keep their ``company_name``, which
is what identified them, but read with blank names afterwards.

Revision ID: e03f96c98452
Revises: 1ad0b594f3fb
Create Date: 2026-10-26 18:22:41.341827

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e03f96c98452"
down_revision: Union[str, None] = "1ad0b594f3fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ("first_name", "last_name")


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("donors"):
        return
    for column in _COLUMNS:
        op.alter_column(
            "donors",
            column,
            existing_type=sa.String(length=100),
            nullable=True,
        )


def downgrade() -> None:
    if not _has_table("donors"):
        return
    for column in _COLUMNS:
        op.execute(sa.text(f"UPDATE donors SET {column} = '' WHERE {column} IS NULL"))
        op.alter_column(
            "donors",
            column,
            existing_type=sa.String(length=100),
            nullable=False,
        )
