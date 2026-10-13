"""Fundraising campaigns can be restricted funds, and payments can spend them

A campaign whose donors gave for a stated purpose — new turnout gear, a
specific apparatus — can be marked restricted, and a purchase request, check
request or expense line can be charged to it:

* ``fundraising_campaigns.is_restricted`` and ``restriction_purpose``.
* ``fund_campaign_id`` (``SET NULL`` to ``fundraising_campaigns``) on
  ``purchase_requests``, ``check_requests`` and ``expense_line_items``.

Nothing is backfilled: every existing campaign starts unrestricted and no
existing payment is charged to a fund, so no balance changes. Any of these
tables may be built by ``create_all`` rather than a migration, so each step is
skipped when its table is absent; ``create_all`` then builds it from the
model, columns included.

The downgrade drops the columns, and which campaigns were restricted and which
payments were charged to them are lost with them.

Revision ID: 3decd3ff6ce5
Revises: 4d8807bdd737
Create Date: 2026-10-13 11:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3decd3ff6ce5"
down_revision: Union[str, None] = "4d8807bdd737"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CAMPAIGNS = "fundraising_campaigns"
# Each charged table, and the names the models' naming convention gives its
# key and index, so the downgrade finds them however the table was built.
CHARGED = {
    "purchase_requests": (
        "fk_purchase_requests_fund_campaign_id_fundraising_campaigns",
        "ix_purchase_requests_fund_campaign_id",
    ),
    "check_requests": (
        "fk_check_requests_fund_campaign_id_fundraising_campaigns",
        "ix_check_requests_fund_campaign_id",
    ),
    "expense_line_items": (
        "fk_expense_line_items_fund_campaign_id_fundraising_campaigns",
        "ix_expense_line_items_fund_campaign_id",
    ),
}


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
    if _has_table(CAMPAIGNS):
        existing = _columns(CAMPAIGNS)
        if "is_restricted" not in existing:
            op.add_column(
                CAMPAIGNS,
                sa.Column(
                    "is_restricted",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text("0"),
                ),
            )
        if "restriction_purpose" not in existing:
            op.add_column(
                CAMPAIGNS, sa.Column("restriction_purpose", sa.Text(), nullable=True)
            )

    for table, (fk, index) in CHARGED.items():
        if not _has_table(table):
            continue
        if "fund_campaign_id" not in _columns(table):
            op.add_column(
                table, sa.Column("fund_campaign_id", sa.String(36), nullable=True)
            )
        if not _has_index(table, index):
            op.create_index(index, table, ["fund_campaign_id"])
        if _has_table(CAMPAIGNS) and not _has_fk(table, fk):
            op.create_foreign_key(
                fk,
                table,
                CAMPAIGNS,
                ["fund_campaign_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    for table, (fk, index) in CHARGED.items():
        if not _has_table(table):
            continue
        if _has_fk(table, fk):
            op.drop_constraint(fk, table, type_="foreignkey")
        if _has_index(table, index):
            op.drop_index(index, table_name=table)
        if "fund_campaign_id" in _columns(table):
            op.drop_column(table, "fund_campaign_id")

    if _has_table(CAMPAIGNS):
        existing = _columns(CAMPAIGNS)
        for name in ("restriction_purpose", "is_restricted"):
            if name in existing:
                op.drop_column(CAMPAIGNS, name)
