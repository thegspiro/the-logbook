"""Give an inventory item room for every style attribute it actually has.

Revision ID: b8e3f1a97c24
Revises: d7c1b95e2a40
Create Date: 2026-09-06 12:00:00.000000

``inventory_items.style`` holds one ``GarmentStyle`` value, but the ten values
in that enum are four orthogonal descriptors — sleeve, fit, neckline, closure —
so one garment legitimately carries several. A men's long-sleeve polo could not
be recorded at all: variant generation resolved the conflict by creating three
separate items, one per attribute.

``style_attributes`` holds the full canonical list (see
``app/utils/garment_styles.py``). ``style`` stays, carrying the derived primary,
because filters, badges and the requestable catalog all read it.

The backfill is ``[style]``, which is already canonical — one value, one axis —
so unlike the seat-list backfills this migration needs no frozen inline copy of
the normalizer to stay correct as the taxonomy grows.

Reversible: the downgrade drops the column. Only the derived list is lost, and
every row keeps its original ``style``, so a downgraded database is exactly the
database that existed before this revision.
"""

import sqlalchemy as sa
from alembic import op

revision = "b8e3f1a97c24"
down_revision = "d7c1b95e2a40"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # ``inventory_items`` is created by 20260120_0013b, so it is always present
    # here and needs no table guard (CLAUDE.md pitfall #26). The COLUMN guard is
    # load-bearing all the same: application startup runs ``create_all`` plus a
    # missing-column repair, so an installation can reach this revision with the
    # column already built from the model.
    if not _has_column("inventory_items", "style_attributes"):
        op.add_column(
            "inventory_items",
            sa.Column("style_attributes", sa.JSON(), nullable=True),
        )

    # JSON_ARRAY rather than a string literal, so the value is valid JSON on
    # both MySQL 8.0 and MariaDB 10.11.
    #
    # CAST(style AS CHAR) is not decoration: `style` is an ENUM, and an ENUM in
    # a numeric context is its 1-based index rather than its value. The cast
    # settles that question on both engines instead of relying on either one's
    # coercion rules.
    #
    # Idempotent: the IS NULL guard skips rows already backfilled, which matters
    # because the column may predate this step on an installation that built it
    # from the model via startup's column repair.
    op.execute(
        "UPDATE inventory_items "
        "   SET style_attributes = JSON_ARRAY(CAST(style AS CHAR)) "
        " WHERE style IS NOT NULL "
        "   AND style_attributes IS NULL"
    )


def downgrade() -> None:
    if _has_column("inventory_items", "style_attributes"):
        op.drop_column("inventory_items", "style_attributes")
