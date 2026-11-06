"""Finance: a check request's receipt, and an expense report's commitment

Owner decisions of 2026-11-01 (docs/KNOWN_LIMITATIONS.md, Finance):

* ``check_requests.receipt_document_id`` (``SET NULL`` to ``documents``,
  indexed) -- the invoice or bill a check pays. Issuing a check now needs one,
  except an advance's or a reimbursement check's. Existing rows get NULL: no
  check request has carried a receipt before, so an approved check waiting to
  be issued needs one uploaded first (docs/UPGRADING.md).
* ``expense_reports.budget_committed_at`` (nullable datetime) -- when
  approval encumbered the report's lines on their budget lines. Existing rows
  get NULL, which is what they are: nothing was ever committed for a report
  approved before this, so paying or cancelling one releases nothing. No
  backfill commits them now; that would move live budget lines on upgrade and
  could push a line past its ceiling with no approval to refuse it.

Neither column narrows what a row may hold, so rows already present need no
settling (CLAUDE.md pitfall #35). Both tables are built by ``create_all``
rather than a migration, so each step is skipped when its table is absent; a
table built later comes from the models, which already declare the columns.

The downgrade drops both. A check request's receipt link is lost with it (the
document itself stays under Finance > Receipts), and an approved report's
commitment marker is lost while its encumbrance stays on the budget line: an
older release paying that report would spend its lines without releasing the
commitment, leaving the line over-encumbered until corrected by hand.

Revision ID: 100121b59d94
Revises: 0961ffc2cdf1
Create Date: 2026-11-06 04:33:20.529046

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "100121b59d94"
down_revision: Union[str, None] = "0961ffc2cdf1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECKS = "check_requests"
REPORTS = "expense_reports"
# The names the models' naming convention gives these, so the downgrade finds
# them however the table was built.
RECEIPT_FK = "fk_check_requests_receipt_document_id_documents"
RECEIPT_IX = "ix_check_requests_receipt_document_id"


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


def upgrade() -> None:
    if _has_table(CHECKS):
        if "receipt_document_id" not in _columns(CHECKS):
            op.add_column(
                CHECKS,
                sa.Column("receipt_document_id", sa.String(36), nullable=True),
            )
        if not _has_index(CHECKS, RECEIPT_IX):
            op.create_index(RECEIPT_IX, CHECKS, ["receipt_document_id"])
        if _has_table("documents") and not _has_fk(CHECKS, RECEIPT_FK):
            op.create_foreign_key(
                RECEIPT_FK,
                CHECKS,
                "documents",
                ["receipt_document_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if _has_table(REPORTS) and "budget_committed_at" not in _columns(REPORTS):
        op.add_column(
            REPORTS,
            sa.Column("budget_committed_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _has_table(REPORTS) and "budget_committed_at" in _columns(REPORTS):
        op.drop_column(REPORTS, "budget_committed_at")

    if _has_table(CHECKS):
        if _has_fk(CHECKS, RECEIPT_FK):
            op.drop_constraint(RECEIPT_FK, CHECKS, type_="foreignkey")
        if _has_index(CHECKS, RECEIPT_IX):
            op.drop_index(RECEIPT_IX, table_name=CHECKS)
        if "receipt_document_id" in _columns(CHECKS):
            op.drop_column(CHECKS, "receipt_document_id")
