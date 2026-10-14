"""Cash advances under the accountable plan

* ``check_requests.is_advance`` — the check is cash advanced to the requesting
  member ahead of an expense, not a payment for one. Existing checks are not
  advances (server default ``0``).
* ``expense_reports.advance_id`` (``SET NULL`` to ``check_requests``) and
  ``advance_applied`` — the advance a report accounts for, and how much of the
  report it covers.
* ``advance_returns`` — unspent cash a member handed back, with when a
  QuickBooks export carried it.

Nothing is backfilled: no check has been an advance before. Any of the altered
tables may be built by ``create_all`` rather than a migration, so each step is
skipped when its table is absent; ``advance_returns`` is created only when
``check_requests`` exists, since its keys point there.

The downgrade drops the table and the columns. Which checks were advances, the
reports that accounted for them and the returns recorded are lost with them,
and an issued advance then reads as an ordinary check with no budget line.

Revision ID: a39a1999776f
Revises: 0d32069fea4d
Create Date: 2026-10-14 11:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a39a1999776f"
down_revision: Union[str, None] = "0d32069fea4d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECKS = "check_requests"
REPORTS = "expense_reports"
RETURNS = "advance_returns"
LOGS = "finance_export_logs"
# The names the models' naming convention gives these, so the downgrade finds
# them however the table was built.
REPORT_FK = "fk_expense_reports_advance_id_check_requests"
REPORT_IX = "ix_expense_reports_advance_id"


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
    if _has_table(CHECKS) and "is_advance" not in _columns(CHECKS):
        op.add_column(
            CHECKS,
            sa.Column(
                "is_advance", sa.Boolean(), nullable=False, server_default=sa.text("0")
            ),
        )

    if _has_table(REPORTS):
        existing = _columns(REPORTS)
        if "advance_id" not in existing:
            op.add_column(
                REPORTS, sa.Column("advance_id", sa.String(36), nullable=True)
            )
        if "advance_applied" not in existing:
            op.add_column(
                REPORTS,
                sa.Column("advance_applied", sa.Numeric(12, 2), nullable=True),
            )
        if not _has_index(REPORTS, REPORT_IX):
            op.create_index(REPORT_IX, REPORTS, ["advance_id"])
        if _has_table(CHECKS) and not _has_fk(REPORTS, REPORT_FK):
            op.create_foreign_key(
                REPORT_FK,
                REPORTS,
                CHECKS,
                ["advance_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if _has_table(CHECKS) and not _has_table(RETURNS):
        op.create_table(
            RETURNS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "advance_id",
                sa.String(36),
                sa.ForeignKey("check_requests.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("returned_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("payment_method", sa.String(50), nullable=True),
            sa.Column("reference", sa.String(200), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "recorded_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("qb_exported_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "qb_export_log_id",
                sa.String(36),
                sa.ForeignKey(f"{LOGS}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Index("ix_advance_returns_advance", "advance_id"),
            sa.Index(
                "ix_advance_returns_org_returned", "organization_id", "returned_at"
            ),
            mysql_charset="utf8mb4",
            mysql_collate="utf8mb4_unicode_ci",
        )


def downgrade() -> None:
    if _has_table(RETURNS):
        op.drop_table(RETURNS)

    if _has_table(REPORTS):
        if _has_fk(REPORTS, REPORT_FK):
            op.drop_constraint(REPORT_FK, REPORTS, type_="foreignkey")
        if _has_index(REPORTS, REPORT_IX):
            op.drop_index(REPORT_IX, table_name=REPORTS)
        existing = _columns(REPORTS)
        for name in ("advance_applied", "advance_id"):
            if name in existing:
                op.drop_column(REPORTS, name)

    if _has_table(CHECKS) and "is_advance" in _columns(CHECKS):
        op.drop_column(CHECKS, "is_advance")
