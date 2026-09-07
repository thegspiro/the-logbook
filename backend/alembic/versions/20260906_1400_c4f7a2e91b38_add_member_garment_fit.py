"""Give a member's fit preference a column that something reads.

Revision ID: c4f7a2e91b38
Revises: b8e3f1a97c24
Create Date: 2026-09-06 14:00:00.000000

``member_size_preferences.shirt_style`` held one value drawn from all ten
GarmentStyle values, which span four orthogonal axes. A member could say
"Women's" or "Long Sleeve" but not both, and choosing either silently answered
"no preference" to the other. Worse, nothing ever read the column: the member
picked a value, saw it save, and it changed nothing about what they were
offered — while ``boot_width`` beside it in the same form was read and folded
into "10 (wide)".

``garment_fit`` holds the one axis that is a property of the *person* rather
than of what the department stocks, and the requestable catalog reads it to
preselect the right variant.

Backfill: ``shirt_style`` where it holds a fit value. A stored ``long_sleeve``
is not a fit and is deliberately left behind — there is nowhere truthful to put
it, and inventing one would be the same conflation this revision removes.

The three fit literals are inlined rather than imported from
``app/utils/garment_styles``. A migration must keep transforming rows the way
it did the day it ran (CLAUDE.md pitfall #20), and the fit axis is free to grow.

``shirt_style`` is deliberately NOT dropped: it still holds values this backfill
does not move, and removing it from the response schema would be a breaking
change. That is its own revision, after a deprecation window.

Reversible: the downgrade drops ``garment_fit``. Nothing else is touched, so a
downgraded database is exactly the one that existed before this revision.
"""

import sqlalchemy as sa
from alembic import op

revision = "c4f7a2e91b38"
down_revision = "b8e3f1a97c24"
branch_labels = None
depends_on = None

_FIT_VALUES = ("mens", "womens", "unisex")


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # `member_size_preferences` is created by 20260307_0100, so it is always
    # present and needs no table guard (CLAUDE.md pitfall #26). The COLUMN guard
    # is load-bearing: application startup runs create_all plus a missing-column
    # repair, so the column can already exist when this revision runs.
    if not _has_column("member_size_preferences", "garment_fit"):
        op.add_column(
            "member_size_preferences",
            sa.Column("garment_fit", sa.String(20), nullable=True),
        )

    # Idempotent: the IS NULL guard leaves a fit an administrator or the member
    # has already set alone, so a re-run cannot overwrite a newer answer with an
    # older one.
    op.execute(
        sa.text(
            "UPDATE member_size_preferences "
            "   SET garment_fit = shirt_style "
            " WHERE garment_fit IS NULL "
            "   AND shirt_style IN :fits"
        ).bindparams(sa.bindparam("fits", value=_FIT_VALUES, expanding=True))
    )


def downgrade() -> None:
    if _has_column("member_size_preferences", "garment_fit"):
        op.drop_column("member_size_preferences", "garment_fit")
