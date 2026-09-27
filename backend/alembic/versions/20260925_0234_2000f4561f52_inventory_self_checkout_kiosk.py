"""NFC phase 4b: self-service checkout kiosk.

Revision ID: 2000f4561f52
Revises: b1eb0458782a

Two columns on ``inventory_categories``, both additive:

* ``allow_self_checkout`` (boolean, default false): members may check items in
  the category out at a kiosk. Every existing category becomes false, so no
  item is self-checkout-able until a quartermaster opts a category in.
* ``self_checkout_loan_days`` (nullable integer): how long a kiosk loan runs
  before it is due back. Null means no due date.

The ``inventory.kiosk`` permission needs no data change: it is granted to no
seeded position, and the ``inventory.*`` wildcard covers it by name.

Each step is guarded, so a database whose table ``create_all`` already built
from the current models is left alone. Downgrade drops both columns; the
opt-ins and loan periods set are lost, which is all they held.
"""

import sqlalchemy as sa
from alembic import op

revision = "2000f4561f52"
down_revision = "b1eb0458782a"
branch_labels = None
depends_on = None

TABLE = "inventory_categories"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    if not _has_column(TABLE, "allow_self_checkout"):
        op.add_column(
            TABLE,
            sa.Column(
                "allow_self_checkout",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    if not _has_column(TABLE, "self_checkout_loan_days"):
        op.add_column(
            TABLE, sa.Column("self_checkout_loan_days", sa.Integer(), nullable=True)
        )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    if _has_column(TABLE, "self_checkout_loan_days"):
        op.drop_column(TABLE, "self_checkout_loan_days")
    if _has_column(TABLE, "allow_self_checkout"):
        op.drop_column(TABLE, "allow_self_checkout")
