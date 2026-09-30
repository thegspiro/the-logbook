"""add election closed_at closed_by

``elections.end_date`` is the *scheduled* end and survives an early manual
close unchanged, so the certified PDF, the report and every card dated the
close to a moment that never happened, and the ``election_closed`` audit row
carried no actor (W50-14). ``close_election`` now stamps the actual instant
and the closing officer; these are the columns it writes.

Both are nullable: every election closed before this revision keeps NULLs
(its scheduled end is then the best record), and a lifecycle (automatic)
close has no officer. ``closed_by`` is SET NULL on user deletion so removing
a member never blocks on a closed election.

Idempotent: each column is added only when absent, and the whole step is
skipped when ``elections`` does not exist yet (CI upgrades an empty
database).

Revision ID: ac06a2998013
Revises: 6394fbf42581
Create Date: 2026-09-30 08:53:19.339716

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ac06a2998013"
down_revision: Union[str, None] = "6394fbf42581"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "elections"
FK_NAME = "fk_elections_closed_by_users"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return name in {fk["name"] for fk in inspector.get_foreign_keys(table)}


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    if not _has_column(TABLE, "closed_at"):
        op.add_column(
            TABLE, sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True)
        )
    if not _has_column(TABLE, "closed_by"):
        op.add_column(TABLE, sa.Column("closed_by", sa.String(36), nullable=True))
    if _has_table("users") and not _has_fk(TABLE, FK_NAME):
        op.create_foreign_key(
            FK_NAME, TABLE, "users", ["closed_by"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    if _has_fk(TABLE, FK_NAME):
        op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
    if _has_column(TABLE, "closed_by"):
        op.drop_column(TABLE, "closed_by")
    if _has_column(TABLE, "closed_at"):
        op.drop_column(TABLE, "closed_at")
