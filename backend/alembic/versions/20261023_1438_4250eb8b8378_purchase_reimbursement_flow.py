"""Purchase request -> expense report -> reimbursement check

* ``purchase_requests.status`` gains ``reimbursed``: an approved purchase the
  requester bought with their own money and was paid back for through an
  expense report. Existing rows are untouched -- none has been reimbursed this
  way before.
* ``expense_reports.purchase_request_id`` (``SET NULL`` to
  ``purchase_requests``) -- the purchase a report claims back.
* ``check_requests.expense_report_id`` (``SET NULL`` to ``expense_reports``) --
  the report a check reimburses the member for.
* ``check_requests.qb_export_entry`` (JSON) -- a reimbursement check's journal
  entry as QuickBooks received it, so a void reverses exactly that.

Nothing is backfilled: no record has been linked before. ``purchase_requests``,
``expense_reports`` and ``check_requests`` are built by ``create_all`` rather
than a migration, so every step is skipped when its table is absent; a table
built later comes from the models, which already declare these columns.

The downgrade drops the columns and narrows the enum. A ``reimbursed`` request
becomes ``paid`` -- the closest value the older enum has for "this purchase is
settled" -- which makes it count as spent beside the expense report that paid
for it, so the budget line's spent total and the reports double it until the
request is corrected by hand. Which report and check each payment came through
is lost with the columns.

Revision ID: 4250eb8b8378
Revises: f938324f8081
Create Date: 2026-10-23 14:38:27.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4250eb8b8378"
down_revision: Union[str, None] = "f938324f8081"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PURCHASES = "purchase_requests"
REPORTS = "expense_reports"
CHECKS = "check_requests"
# The names the models' naming convention gives these, so the downgrade finds
# them however the table was built.
REPORT_FK = "fk_expense_reports_purchase_request_id_purchase_requests"
REPORT_IX = "ix_expense_reports_purchase_request_id"
CHECK_FK = "fk_check_requests_expense_report_id_expense_reports"
CHECK_IX = "ix_check_requests_expense_report_id"

_OLD_STATUSES = (
    "draft",
    "submitted",
    "pending_approval",
    "approved",
    "denied",
    "ordered",
    "received",
    "paid",
    "cancelled",
)
_NEW_STATUSES = (
    "draft",
    "submitted",
    "pending_approval",
    "approved",
    "denied",
    "ordered",
    "received",
    "paid",
    "reimbursed",
    "cancelled",
)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def _has_index(table: str, name: str) -> bool:
    return name in {ix.get("name") for ix in _inspector().get_indexes(table)}


def _status_type(values: tuple[str, ...]) -> sa.Enum:
    return sa.Enum(*values, name="purchaserequeststatus")


def upgrade() -> None:
    if _has_table(PURCHASES):
        # MySQL requires ALTER COLUMN to change enum values; appending one
        # leaves every stored value as it was.
        op.alter_column(
            PURCHASES,
            "status",
            type_=_status_type(_NEW_STATUSES),
            existing_type=_status_type(_OLD_STATUSES),
            existing_nullable=False,
        )

    if _has_table(REPORTS):
        if "purchase_request_id" not in _columns(REPORTS):
            op.add_column(
                REPORTS,
                sa.Column("purchase_request_id", sa.String(36), nullable=True),
            )
        if not _has_index(REPORTS, REPORT_IX):
            op.create_index(REPORT_IX, REPORTS, ["purchase_request_id"])
        if _has_table(PURCHASES) and not _has_fk(REPORTS, REPORT_FK):
            op.create_foreign_key(
                REPORT_FK,
                REPORTS,
                PURCHASES,
                ["purchase_request_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if _has_table(CHECKS):
        existing = _columns(CHECKS)
        if "expense_report_id" not in existing:
            op.add_column(
                CHECKS,
                sa.Column("expense_report_id", sa.String(36), nullable=True),
            )
        if "qb_export_entry" not in existing:
            op.add_column(
                CHECKS, sa.Column("qb_export_entry", sa.JSON(), nullable=True)
            )
        if not _has_index(CHECKS, CHECK_IX):
            op.create_index(CHECK_IX, CHECKS, ["expense_report_id"])
        if _has_table(REPORTS) and not _has_fk(CHECKS, CHECK_FK):
            op.create_foreign_key(
                CHECK_FK,
                CHECKS,
                REPORTS,
                ["expense_report_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    if _has_table(CHECKS):
        if _has_fk(CHECKS, CHECK_FK):
            op.drop_constraint(CHECK_FK, CHECKS, type_="foreignkey")
        if _has_index(CHECKS, CHECK_IX):
            op.drop_index(CHECK_IX, table_name=CHECKS)
        existing = _columns(CHECKS)
        for name in ("qb_export_entry", "expense_report_id"):
            if name in existing:
                op.drop_column(CHECKS, name)

    if _has_table(REPORTS):
        if _has_fk(REPORTS, REPORT_FK):
            op.drop_constraint(REPORT_FK, REPORTS, type_="foreignkey")
        if _has_index(REPORTS, REPORT_IX):
            op.drop_index(REPORT_IX, table_name=REPORTS)
        if "purchase_request_id" in _columns(REPORTS):
            op.drop_column(REPORTS, "purchase_request_id")

    if _has_table(PURCHASES):
        # Narrowing the enum with a ``reimbursed`` row present would fail or
        # truncate it; see the module docstring for why ``paid``.
        op.execute(
            sa.text(
                "UPDATE purchase_requests SET status = 'paid', "
                "paid_at = COALESCE(paid_at, updated_at) "
                "WHERE status = 'reimbursed'"
            )
        )
        op.alter_column(
            PURCHASES,
            "status",
            type_=_status_type(_OLD_STATUSES),
            existing_type=_status_type(_NEW_STATUSES),
            existing_nullable=False,
        )
