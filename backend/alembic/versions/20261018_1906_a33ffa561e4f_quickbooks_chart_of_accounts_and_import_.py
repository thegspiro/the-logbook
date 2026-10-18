"""QuickBooks chart of accounts and import confirmation

* ``finance_export_logs.imported_at`` / ``imported_by`` (``SET NULL`` to
  ``users``) — when the Treasurer confirmed an export's file was imported into
  QuickBooks, and who did. Existing exports read as not confirmed.
* ``finance_qb_chart_accounts`` — the department's QuickBooks chart of
  accounts as last uploaded. With none on file the export does not check
  account names against it, so nothing changes for a department until it
  uploads one.

``finance_export_logs`` may be built by ``create_all`` rather than a
migration, so its columns are added only when the table exists; a table
``create_all`` builds later comes from the models, which declare them.

The downgrade drops the table and the two columns. The uploaded chart and the
record of which files were confirmed as imported are lost; nothing else reads
them.

Revision ID: a33ffa561e4f
Revises: 89723c04ae94
Create Date: 2026-10-18 19:06:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a33ffa561e4f"
down_revision: Union[str, None] = "89723c04ae94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOGS = "finance_export_logs"
CHART = "finance_qb_chart_accounts"
# The names the models' naming convention gives these, so the downgrade finds
# them however the table was built.
LOGS_FK = "fk_finance_export_logs_imported_by_users"
CHART_IX = "ix_finance_qb_chart_accounts_org_id"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def upgrade() -> None:
    if _has_table(LOGS):
        existing = _columns(LOGS)
        if "imported_at" not in existing:
            op.add_column(
                LOGS,
                sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True),
            )
        if "imported_by" not in existing:
            op.add_column(LOGS, sa.Column("imported_by", sa.String(36), nullable=True))
        if not _has_fk(LOGS, LOGS_FK):
            op.create_foreign_key(
                LOGS_FK, LOGS, "users", ["imported_by"], ["id"], ondelete="SET NULL"
            )

    if not _has_table(CHART):
        op.create_table(
            CHART,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("account_type", sa.String(100), nullable=True),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "uploaded_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(CHART_IX, CHART, ["organization_id"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {CHART}")
    if _has_table(LOGS):
        if _has_fk(LOGS, LOGS_FK):
            op.drop_constraint(LOGS_FK, LOGS, type_="foreignkey")
        existing = _columns(LOGS)
        for column in ("imported_by", "imported_at"):
            if column in existing:
                op.drop_column(LOGS, column)
