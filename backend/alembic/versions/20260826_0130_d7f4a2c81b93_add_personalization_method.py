"""Add the personalization method (embroidery vs engraving) to products and orders

Personalization was modelled as one process and it is two. A cloth item is
**embroidered** and the thread has a colour; a metal item is **engraved** and
there is no thread at all. With only a thread colour on the model, every
personalized line carried one — so an engraved challenge coin reached the
vendor purchase order and the CSV export reading "Gold", an instruction the
engraver cannot follow and has to phone about.

Two columns, for the two jobs the thread colour already has:

* store_products.personalization_method is the quartermaster's setting —
  what this product's personalization actually is.
* store_order_items.personalization_method is a snapshot taken when the
  order is placed, beside the thread colour, product name and unit price
  already frozen on the line. Re-sourcing a patch as an engraved plate next
  season must not restate what the vendor was told about an order already
  placed.

Both are NULL-able and NULL means embroidery — the behaviour every existing
product already had, since the preview stitched every name in gold. No backfill
is wanted: writing "embroidery" onto every row would claim a decision no
quartermaster has made yet, and the resolver reads NULL the same way.

Revision ID: d7f4a2c81b93
Revises: a1f7c34e9b02
Create Date: 2026-08-26 01:30:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d7f4a2c81b93"
down_revision = "a1f7c34e9b02"
branch_labels = None
depends_on = None


_COLUMN = "personalization_method"
_TABLES = ("store_products", "store_order_items")


def _has_column(inspector, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    for table in _TABLES:
        # Guarded on the table as well as the column: CI runs
        # ``alembic upgrade head`` against an empty database, and a table that
        # only ``create_all()`` builds is not there yet (CLAUDE.md pitfall 26).
        # Skipping is correct — ``create_all`` builds it from the models, which
        # already declare the column.
        if table in tables and not _has_column(inspector, table, _COLUMN):
            op.add_column(table, sa.Column(_COLUMN, sa.String(20), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    for table in _TABLES:
        if table in tables and _has_column(inspector, table, _COLUMN):
            op.drop_column(table, _COLUMN)
