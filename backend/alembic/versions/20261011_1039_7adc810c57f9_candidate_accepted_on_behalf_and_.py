"""candidate accepted-on-behalf label and elections.nominations_closed_at

W50-38 (owner decision 2026-10-08): an election manager may accept a
nomination on the nominee's behalf before nominations close, and that
acceptance is labelled "accepted by manager" — persisted, so the label
survives a reload and the nominee can be told — and the slate freezes when
nominations close.

- ``candidates.accepted_on_behalf_by`` (FK users, ON DELETE SET NULL) and
  ``candidates.accepted_on_behalf_at`` record the manager and the time.
- ``elections.nominations_closed_at`` is stamped by Close Nominations and is
  what freezes the slate.

All three are nullable with no backfill: no stored acceptance can be known
to have been a manager's (the audit trail has ``candidate_updated`` rows
but they do not distinguish an on-behalf accept from any other toggle), and
an election whose nominations closed before this revision keeps NULL and
the old, unfrozen behaviour rather than being frozen retroactively.

Idempotent and guarded: each column and constraint is added only when
absent, and each table is skipped when it does not exist yet (CI upgrades
an empty database; ``create_all`` builds the columns from the models).

Revision ID: 7adc810c57f9
Revises: edb445ae5806
Create Date: 2026-10-11 10:39:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7adc810c57f9"
down_revision: Union[str, None] = "edb445ae5806"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CANDIDATES = "candidates"
ELECTIONS = "elections"
FK_NAME = "fk_candidates_accepted_on_behalf_by_users"


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
    if _has_table(CANDIDATES):
        if not _has_column(CANDIDATES, "accepted_on_behalf_by"):
            op.add_column(
                CANDIDATES,
                sa.Column("accepted_on_behalf_by", sa.String(36), nullable=True),
            )
        if not _has_column(CANDIDATES, "accepted_on_behalf_at"):
            op.add_column(
                CANDIDATES,
                sa.Column(
                    "accepted_on_behalf_at", sa.DateTime(timezone=True), nullable=True
                ),
            )
        if (
            _alters_constraints()
            and _has_table("users")
            and FK_NAME not in _fk_names(CANDIDATES)
        ):
            op.create_foreign_key(
                FK_NAME,
                CANDIDATES,
                "users",
                ["accepted_on_behalf_by"],
                ["id"],
                ondelete="SET NULL",
            )
    if _has_table(ELECTIONS) and not _has_column(ELECTIONS, "nominations_closed_at"):
        op.add_column(
            ELECTIONS,
            sa.Column(
                "nominations_closed_at", sa.DateTime(timezone=True), nullable=True
            ),
        )


def downgrade() -> None:
    if _has_table(ELECTIONS) and _has_column(ELECTIONS, "nominations_closed_at"):
        op.drop_column(ELECTIONS, "nominations_closed_at")
    if _has_table(CANDIDATES):
        if _alters_constraints() and FK_NAME in _fk_names(CANDIDATES):
            op.drop_constraint(FK_NAME, CANDIDATES, type_="foreignkey")
        for column in ("accepted_on_behalf_at", "accepted_on_behalf_by"):
            if _has_column(CANDIDATES, column):
                op.drop_column(CANDIDATES, column)
