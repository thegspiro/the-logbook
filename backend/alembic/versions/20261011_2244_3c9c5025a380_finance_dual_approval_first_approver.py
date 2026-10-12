"""Finance requests record a first approval held for a second approver

A department can set a dual-approval threshold (organization settings,
``finance.dual_approval_threshold``): a purchase request, check request or
expense report of that amount or more is approved only once two different
people have approved it. An approval given outside an approval chain that does
not complete the request is recorded on the request itself:

* ``purchase_requests``, ``expense_reports``, ``check_requests``:
  ``first_approved_by`` (``SET NULL`` to ``users``) and ``first_approved_at``.

Nothing is backfilled: the threshold is off until a department sets it, so no
existing request is held. Any of these tables may be built by ``create_all``
rather than a migration, so each step is skipped when its table is absent;
``create_all`` then builds it from the model, columns included.

The downgrade drops the columns. A request held for its second approver at
that moment stays waiting for approval; the previous revision's code lets any
approver approve it on its own.

Revision ID: 3c9c5025a380
Revises: e1a5bfe7a2ed
Create Date: 2026-10-11 22:44:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3c9c5025a380"
down_revision: Union[str, None] = "e1a5bfe7a2ed"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USERS = "users"
# (table, foreign key name). The names are the ones the models' naming
# convention gives these keys, so the downgrade finds them however the table
# was built.
TABLES = (
    ("purchase_requests", "fk_purchase_requests_first_approved_by_users"),
    ("expense_reports", "fk_expense_reports_first_approved_by_users"),
    ("check_requests", "fk_check_requests_first_approved_by_users"),
)
COLUMNS = ("first_approved_by", "first_approved_at")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def upgrade() -> None:
    for table, fk_name in TABLES:
        if not _has_table(table):
            continue
        existing = _columns(table)
        if "first_approved_by" not in existing:
            op.add_column(
                table, sa.Column("first_approved_by", sa.String(36), nullable=True)
            )
        if "first_approved_at" not in existing:
            op.add_column(
                table,
                sa.Column(
                    "first_approved_at", sa.DateTime(timezone=True), nullable=True
                ),
            )
        if _has_table(USERS) and not _has_fk(table, fk_name):
            op.create_foreign_key(
                fk_name,
                table,
                USERS,
                ["first_approved_by"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    for table, fk_name in TABLES:
        if not _has_table(table):
            continue
        if _has_fk(table, fk_name):
            op.drop_constraint(fk_name, table, type_="foreignkey")
        existing = _columns(table)
        for name in COLUMNS:
            if name in existing:
                op.drop_column(table, name)
