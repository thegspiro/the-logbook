"""Add the configurable embroidery thread color to store products and orders

The storefront preview stitched every member's name in gold, hardcoded in the
product card. A department that embroiders its job shirts in white saw a
preview that lied about the goods it was selling.

Two columns, for two different jobs:

* ``store_products.personalization_thread_color`` is the quartermaster's
  setting — what this product is embroidered in.
* ``store_order_items.personalization_thread_color`` is a snapshot taken when
  the order is placed, alongside the product name and unit price that are
  already frozen on the line. Switching a product to white next season must
  not rewrite what the vendor was told to stitch on an order placed in gold.

Both are NULL-able and NULL means gold — the historical hardcoded value — so
an existing catalog renders exactly as it did before the setting existed. No
backfill is needed or wanted: writing "gold" onto every existing row would
claim a decision no quartermaster actually made.

Revision ID: b5e2d9a37c48
Revises: a4f8c1b92d17
Create Date: 2026-08-25 15:10:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b5e2d9a37c48"
down_revision = "a4f8c1b92d17"
branch_labels = None
depends_on = None


_COLUMN = "personalization_thread_color"
_TABLES = ("store_products", "store_order_items")


def _has_column(inspector, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    for table in _TABLES:
        # Guarded on the table as well as the column: CI runs
        # ``alembic upgrade head`` against an empty database, and a table that
        # only ``create_all()`` builds is not there yet. Skipping is correct —
        # ``create_all`` builds it from the models, which declare the column.
        if table in tables and not _has_column(inspector, table, _COLUMN):
            op.add_column(table, sa.Column(_COLUMN, sa.String(30), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    for table in _TABLES:
        if table in tables and _has_column(inspector, table, _COLUMN):
            op.drop_column(table, _COLUMN)
