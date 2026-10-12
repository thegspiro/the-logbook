"""Budget amendments wait for a second officer's confirmation

An amendment (or a reversal) is now entered ``pending`` and moves nothing; a
``finance.budget_review`` or ``finance.manage`` holder other than the member
who entered it confirms it, which applies the amount, or rejects it.

* ``budget_amendments.status`` — ``pending``, ``confirmed`` or ``rejected``.
  Every existing row is ``confirmed``: amendments entered before this revision
  were applied when they were entered, and the line's amount already includes
  them.
* ``budget_amendments.decided_by`` (``SET NULL``), ``decided_at``,
  ``decision_note`` — the second officer's decision. Existing rows keep NULLs;
  nobody confirmed them, and nobody is named.

``budget_amendments`` may be built by ``create_all`` rather than a migration,
so each step is skipped when the table is absent; ``create_all`` then builds
it from the model, columns included.

The downgrade drops the columns. Pending and rejected rows are deleted first:
the previous revision's code treats every row as applied, so keeping them
would count money that never moved into the line's original budget. Their
entry and decision remain in the audit log.

Revision ID: 0a55dae43a0a
Revises: 7e1a3c94d2b6
Create Date: 2026-10-09 17:27:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0a55dae43a0a"
down_revision: Union[str, None] = "7e1a3c94d2b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AMENDMENTS = "budget_amendments"
USERS = "users"
STATUSES = ("pending", "confirmed", "rejected")
FK_DECIDED_BY = "fk_budget_amendments_decided_by_users"
COLUMNS = ("status", "decided_by", "decided_at", "decision_note")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def upgrade() -> None:
    if not _has_table(AMENDMENTS):
        return
    existing = _columns(AMENDMENTS)
    if "status" not in existing:
        # The server default fills every existing row as confirmed; the
        # application always sets the status itself on new rows.
        op.add_column(
            AMENDMENTS,
            sa.Column(
                "status",
                sa.Enum(*STATUSES, name="budgetamendmentstatus"),
                nullable=False,
                server_default="confirmed",
            ),
        )
    added = (
        sa.Column("decided_by", sa.String(36), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
    )
    for column in added:
        if column.name not in existing:
            op.add_column(AMENDMENTS, column)
    if _has_table(USERS) and not _has_fk(AMENDMENTS, FK_DECIDED_BY):
        op.create_foreign_key(
            FK_DECIDED_BY,
            AMENDMENTS,
            USERS,
            ["decided_by"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if not _has_table(AMENDMENTS):
        return
    existing = _columns(AMENDMENTS)
    if "status" in existing:
        op.execute(
            sa.text(
                "DELETE FROM budget_amendments WHERE status IN ('pending', 'rejected')"
            )
        )
    if _has_fk(AMENDMENTS, FK_DECIDED_BY):
        op.drop_constraint(FK_DECIDED_BY, AMENDMENTS, type_="foreignkey")
    for name in COLUMNS:
        if name in existing:
            op.drop_column(AMENDMENTS, name)
