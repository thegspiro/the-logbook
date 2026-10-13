"""Classify expenses as program, management & general, or fundraising

A nonprofit reports its expenses by function (IRS Form 990 Part IX): what
they were for, not what they bought. A department now records that:

* ``budget_categories.functional_class`` — the default for payments against
  the category's lines; null inherits the parent category's.
* ``purchase_requests.functional_class``, ``check_requests.functional_class``,
  ``expense_line_items.functional_class`` — an override for one payment; null
  uses the category's.

Values are ``program``, ``management_general`` and ``fundraising``. Nothing is
backfilled: an unclassified payment is reported as unclassified until the
department sets its categories, so no existing figure is guessed at. Any of
these tables may be built by ``create_all`` rather than a migration, so each
step is skipped when its table is absent; ``create_all`` then builds it from
the model, column included.

The downgrade drops the columns and, with them, every classification set.

Revision ID: 390fa30d0200
Revises: afaca8c1f812
Create Date: 2026-10-13 00:53:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "390fa30d0200"
down_revision: Union[str, None] = "afaca8c1f812"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = (
    "budget_categories",
    "purchase_requests",
    "check_requests",
    "expense_line_items",
)
VALUES = ("program", "management_general", "fundraising")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    for table in TABLES:
        if _has_table(table) and "functional_class" not in _columns(table):
            op.add_column(
                table,
                sa.Column(
                    "functional_class",
                    sa.Enum(*VALUES, name="functionalclass"),
                    nullable=True,
                ),
            )


def downgrade() -> None:
    for table in TABLES:
        if _has_table(table) and "functional_class" in _columns(table):
            op.drop_column(table, "functional_class")
