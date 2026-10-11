"""QuickBooks export: remember what was sent, and reverse voided checks

The QuickBooks export chose transactions by date range alone, so exporting
overlapping periods put the same payments into QuickBooks twice, and a check
voided after it was exported stayed in QuickBooks as an expense.

* ``purchase_requests``, ``expense_reports``, ``check_requests``:
  ``qb_exported_at`` and ``qb_export_log_id`` (``SET NULL`` to
  ``finance_export_logs``) — when a complete export file last carried the
  payment, and which one. The export leaves stamped payments out unless asked
  to send them again.
* ``check_requests.voided_at`` — when the check was voided, the date its
  reversing entry carries.
* ``check_requests.qb_export_account`` / ``qb_export_offset_account`` — the
  accounts the export posted the check to, so a reversal cancels exactly that
  entry.
* ``check_requests.qb_void_exported_at`` / ``qb_void_export_log_id`` — when the
  reversing entry for a void was exported.

**Backfill.** Payments the export already sent are stamped from the export log,
so the first export after the upgrade does not send them again. For each
successful transactions export, oldest first, every payment it would have
carried — paid (or, for a check, issued) within its date range and no later
than the export itself — is stamped with that export. A check voided since is
stamped only if it was voided after that export, since one voided before was
not in the file; its reversing entry then goes out with the next export that
covers the void date. ``voided_at`` is filled from ``updated_at`` for checks
already voided: nothing changes a check after it is voided, so that is when it
happened. Partial and failed exports stamp nothing — which of their rows
reached the file is not recorded. Stored accounts stay empty on backfilled
checks; their reversals use the category's current accounts.

Any of these tables may be built by ``create_all`` rather than a migration, so
each step is skipped when its table is absent; ``create_all`` then builds it
from the model, columns included.

The downgrade drops the columns. What was sent, and the void dates, are lost
with them; the export logs themselves are untouched.

Revision ID: 3f3bd6f3c7e4
Revises: 4b7e1f0c9a2d
Create Date: 2026-10-11 10:54:17.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3f3bd6f3c7e4"
down_revision: Union[str, None] = "4b7e1f0c9a2d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOGS = "finance_export_logs"
PURCHASES = "purchase_requests"
REPORTS = "expense_reports"
CHECKS = "check_requests"


def _stamp_columns() -> list[sa.Column]:
    return [
        sa.Column("qb_exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("qb_export_log_id", sa.String(36), nullable=True),
    ]


def _check_columns() -> list[sa.Column]:
    return [
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("qb_export_account", sa.String(200), nullable=True),
        sa.Column("qb_export_offset_account", sa.String(200), nullable=True),
        sa.Column("qb_void_exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("qb_void_export_log_id", sa.String(36), nullable=True),
    ]


# (table, column, constraint name). The names are the ones the models'
# naming convention gives these keys, so the downgrade finds them however the
# table was built.
FOREIGN_KEYS = (
    (
        PURCHASES,
        "qb_export_log_id",
        "fk_purchase_requests_qb_export_log_id_finance_export_logs",
    ),
    (
        REPORTS,
        "qb_export_log_id",
        "fk_expense_reports_qb_export_log_id_finance_export_logs",
    ),
    (
        CHECKS,
        "qb_export_log_id",
        "fk_check_requests_qb_export_log_id_finance_export_logs",
    ),
    (
        CHECKS,
        "qb_void_export_log_id",
        "fk_check_requests_qb_void_export_log_id_finance_export_logs",
    ),
)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def _add_columns(table: str, columns: list[sa.Column]) -> None:
    existing = _columns(table)
    for column in columns:
        if column.name not in existing:
            op.add_column(table, column)


def _backfill() -> None:
    bind = op.get_bind()
    if _has_table(CHECKS):
        bind.execute(
            sa.text(
                "UPDATE check_requests SET voided_at = updated_at "
                "WHERE status = 'voided' AND voided_at IS NULL"
            )
        )
    if not _has_table(LOGS):
        return
    logs = bind.execute(
        sa.text(
            "SELECT id, organization_id, date_range_start, date_range_end, "
            "exported_at, completed_at FROM finance_export_logs "
            "WHERE export_type = 'transactions' AND status = 'successful' "
            "ORDER BY exported_at, id"
        )
    ).fetchall()
    # The statements are inlined rather than built from the models: a
    # migration must keep doing what it did the day it ran.
    statements = []
    if _has_table(PURCHASES):
        statements.append(
            "UPDATE purchase_requests SET qb_exported_at = :stamp, "
            "qb_export_log_id = :log_id "
            "WHERE organization_id = :org AND status = 'paid' "
            "AND qb_exported_at IS NULL "
            "AND paid_at BETWEEN :start AND :end AND paid_at <= :at"
        )
    if _has_table(REPORTS):
        statements.append(
            "UPDATE expense_reports SET qb_exported_at = :stamp, "
            "qb_export_log_id = :log_id "
            "WHERE organization_id = :org AND status = 'paid' "
            "AND qb_exported_at IS NULL "
            "AND paid_at BETWEEN :start AND :end AND paid_at <= :at"
        )
    if _has_table(CHECKS):
        statements.append(
            "UPDATE check_requests SET qb_exported_at = :stamp, "
            "qb_export_log_id = :log_id "
            "WHERE organization_id = :org AND qb_exported_at IS NULL "
            "AND check_date BETWEEN :start AND :end AND check_date <= :at "
            "AND (status = 'issued' OR (status = 'voided' AND voided_at > :at))"
        )
    for log in logs:
        params = {
            "stamp": log.completed_at or log.exported_at,
            "log_id": log.id,
            "org": log.organization_id,
            "start": log.date_range_start,
            "end": log.date_range_end,
            "at": log.exported_at,
        }
        for statement in statements:
            bind.execute(sa.text(statement), params)


def upgrade() -> None:
    for table in (PURCHASES, REPORTS):
        if _has_table(table):
            _add_columns(table, _stamp_columns())
    if _has_table(CHECKS):
        _add_columns(CHECKS, _stamp_columns() + _check_columns())
    if _has_table(LOGS):
        for table, column, name in FOREIGN_KEYS:
            if _has_table(table) and not _has_fk(table, name):
                op.create_foreign_key(
                    name, table, LOGS, [column], ["id"], ondelete="SET NULL"
                )
    _backfill()


def downgrade() -> None:
    for table, _column, name in FOREIGN_KEYS:
        if _has_table(table) and _has_fk(table, name):
            op.drop_constraint(name, table, type_="foreignkey")
    for table, columns in (
        (PURCHASES, _stamp_columns()),
        (REPORTS, _stamp_columns()),
        (CHECKS, _stamp_columns() + _check_columns()),
    ):
        if not _has_table(table):
            continue
        existing = _columns(table)
        for column in columns:
            if column.name in existing:
                op.drop_column(table, column.name)
