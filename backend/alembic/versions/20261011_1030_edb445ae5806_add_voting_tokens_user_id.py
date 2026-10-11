"""add voting_tokens.user_id

A link vote stored the voter hash only, so once a named election closed and
its salt was destroyed, the who-voted roster could no longer name anyone who
voted by emailed link (W50-3). The owner decided (2026-10-08) to record the
recipient on the token at issue: ``send_ballot_emails`` now sets
``voting_tokens.user_id`` on a named election's tokens, and the token routes
copy it to the vote's ``voter_id``. Anonymous elections leave it NULL — a
user id beside the token's voter hash would undo the anonymity the salt
provides.

Nullable, with no backfill: a token issued before this revision cannot be
attributed from the token row (it holds only the hash). The token routes
resolve such a token's voter by matching its hash against the roster at
submit time, while the election is open and its salt still exists.

``ondelete=SET NULL``: deleting a member must not delete the tokens (or
fail on them); the vote keeps its own ``voter_id`` regardless.

Idempotent: the column and the foreign key are each added only when absent,
and the whole step is skipped when ``voting_tokens`` does not exist yet (CI
upgrades an empty database, and ``create_all`` builds the column from the
model).

Revision ID: edb445ae5806
Revises: 4b7e1f0c9a2d
Create Date: 2026-10-11 10:30:05.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "edb445ae5806"
down_revision: Union[str, None] = "4b7e1f0c9a2d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "voting_tokens"
COLUMN = "user_id"
FK_NAME = "fk_voting_tokens_user_id_users"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def _fk_names(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    return {fk.get("name") for fk in inspector.get_foreign_keys(table)}


def _alters_constraints() -> bool:
    # SQLite cannot ALTER a constraint onto an existing table; only the
    # migration test runs there; every deployment is MySQL.
    return op.get_bind().dialect.name != "sqlite"


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    if not _has_column(TABLE, COLUMN):
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(36), nullable=True))
    if (
        _alters_constraints()
        and _has_table("users")
        and FK_NAME not in _fk_names(TABLE)
    ):
        op.create_foreign_key(
            FK_NAME, TABLE, "users", [COLUMN], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    if _alters_constraints() and FK_NAME in _fk_names(TABLE):
        op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
    if _has_column(TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)
