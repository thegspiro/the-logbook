"""Dues payments can be sent to QuickBooks

* ``dues_schedules.qb_income_account`` and ``qb_deposit_account`` — the
  QuickBooks accounts a schedule's payments post to. Null takes the
  department's default (organization settings, ``finance.qb_dues_*``).
* ``dues_payments.qb_exported_at`` and ``qb_export_log_id`` (``SET NULL`` to
  ``finance_export_logs``) — when a complete export carried the payment, so the
  next one leaves it out, as purchase, check and expense exports already do.

Nothing is backfilled: no dues payment has been exported before, so every one
already recorded goes out with the first export covering its date. The
UPGRADING note says so, for a department that entered its dues in QuickBooks by
hand. Any of these tables may be built by ``create_all`` rather than a
migration, so each step is skipped when its table is absent.

The downgrade drops the columns; which payments were sent, and the schedules'
accounts, are lost with them.

Revision ID: 0d32069fea4d
Revises: 70070d86ff27
Create Date: 2026-10-14 00:52:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0d32069fea4d"
down_revision: Union[str, None] = "70070d86ff27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEDULES = "dues_schedules"
PAYMENTS = "dues_payments"
LOGS = "finance_export_logs"
# The name the models' naming convention gives this key, so the downgrade finds
# them however the table was built.
LOG_FK = "fk_dues_payments_qb_export_log_id_finance_export_logs"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def upgrade() -> None:
    if _has_table(SCHEDULES):
        existing = _columns(SCHEDULES)
        for name in ("qb_income_account", "qb_deposit_account"):
            if name not in existing:
                op.add_column(SCHEDULES, sa.Column(name, sa.String(200), nullable=True))

    if _has_table(PAYMENTS):
        existing = _columns(PAYMENTS)
        if "qb_exported_at" not in existing:
            op.add_column(
                PAYMENTS,
                sa.Column("qb_exported_at", sa.DateTime(timezone=True), nullable=True),
            )
        if "qb_export_log_id" not in existing:
            op.add_column(
                PAYMENTS, sa.Column("qb_export_log_id", sa.String(36), nullable=True)
            )
        if _has_table(LOGS) and not _has_fk(PAYMENTS, LOG_FK):
            op.create_foreign_key(
                LOG_FK,
                PAYMENTS,
                LOGS,
                ["qb_export_log_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    if _has_table(PAYMENTS):
        if _has_fk(PAYMENTS, LOG_FK):
            op.drop_constraint(LOG_FK, PAYMENTS, type_="foreignkey")
        existing = _columns(PAYMENTS)
        for name in ("qb_export_log_id", "qb_exported_at"):
            if name in existing:
                op.drop_column(PAYMENTS, name)

    if _has_table(SCHEDULES):
        existing = _columns(SCHEDULES)
        for name in ("qb_deposit_account", "qb_income_account"):
            if name in existing:
                op.drop_column(SCHEDULES, name)
