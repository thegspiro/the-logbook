"""Re-settle store product variant sort_order into smallest-to-largest size order

``sort_order`` was assigned from whatever row index the admin form happened to
submit, so a product's sizes came back in the order somebody entered them.
That is almost never smallest-to-largest, because sizes are added to a product
long after it is created: a department stocks S/M/L, then adds XS and 3XL a
season later, and both land at the end of the chips a member picks from.

``StorefrontService._ordered_variants`` now settles this on every write. This
settles the rows that are already stored, so an existing catalog does not have
to be re-saved product by product to come out in order.

The ranking is **inlined and frozen** on purpose (see CLAUDE.md pitfall #20):
``app/utils/size_order.py`` is free to grow new spellings, and a migration has
to keep transforming rows the way it did the day it ran.

Only variants whose labels are recognizable sizes are reordered. A product
whose "variants" are colors keeps its entered order, because inventing an
alphabetical order for Navy/Red/Black would scramble a deliberate one.

Reversible in the sense that matters: the previous ``sort_order`` values
carried no information beyond data-entry order, so ``downgrade`` is a no-op
rather than a restore of numbers nobody chose.

Revision ID: c6a3f8b41e29
Revises: b5e2d9a37c48
Create Date: 2026-08-25 15:20:00.000000
"""

import re
from collections import defaultdict

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c6a3f8b41e29"
down_revision = "b5e2d9a37c48"
branch_labels = None
depends_on = None


# --- frozen copy of the size ranking, as of this revision -------------------
_ALPHA_SIZES = {
    "XXXS": 10,
    "3XS": 10,
    "XXS": 20,
    "2XS": 20,
    "XS": 30,
    "XSMALL": 30,
    "EXTRASMALL": 30,
    "S": 40,
    "SM": 40,
    "SML": 40,
    "SMALL": 40,
    "M": 50,
    "MD": 50,
    "MED": 50,
    "MEDIUM": 50,
    "L": 60,
    "LG": 60,
    "LRG": 60,
    "LARGE": 60,
    "XL": 70,
    "XLARGE": 70,
    "EXTRALARGE": 70,
}
_LENGTH_MODIFIERS = {
    "SHORT": -1,
    "S": -1,
    "REGULAR": 0,
    "REG": 0,
    "R": 0,
    "TALL": 1,
    "T": 1,
    "LONG": 1,
    "LT": 1,
}
_X_SIZE_RE = re.compile(r"^(?:(\d+)X|(X{2,}))(L|S)$")
_NUMERIC_RE = re.compile(r"^(\d+(?:\.\d+)?)(?:[x×](\d+(?:\.\d+)?))?$", re.I)


def _alpha_rank(token):
    token = token.replace(".", "") or token
    if token in _ALPHA_SIZES:
        return _ALPHA_SIZES[token]
    match = _X_SIZE_RE.match(token)
    if match:
        count = int(match.group(1)) if match.group(1) else len(match.group(2))
        if match.group(3) == "L":
            return _ALPHA_SIZES["XL"] + (count - 1)
        return _ALPHA_SIZES["XS"] - (count - 1)
    return None


def _size_sort_key(label, fallback):
    if not label or not label.strip():
        return (2, 0.0, fallback)
    head = re.split(r"[/|,]", label.strip(), maxsplit=1)[0]
    token = re.sub(r"[\s\-_]+", "", head).upper()

    rank = _alpha_rank(token)
    if rank is not None:
        return (0, float(rank), fallback)

    for modifier, offset in _LENGTH_MODIFIERS.items():
        if len(token) > len(modifier) and token.endswith(modifier):
            base = _alpha_rank(token[: -len(modifier)])
            if base is not None:
                return (0, base + offset * 0.1, fallback)

    match = _NUMERIC_RE.match(token)
    if match:
        primary = float(match.group(1))
        secondary = float(match.group(2)) if match.group(2) else 0.0
        return (1, primary + secondary / 1000.0, fallback)

    return (2, 0.0, fallback)


# --- end frozen copy -------------------------------------------------------


def upgrade() -> None:
    bind = op.get_bind()
    if "store_product_variants" not in sa.inspect(bind).get_table_names():
        return

    rows = bind.execute(
        sa.text(
            "SELECT id, product_id, label, sort_order "
            "FROM store_product_variants ORDER BY product_id, sort_order, id"
        )
    ).fetchall()

    by_product = defaultdict(list)
    for row in rows:
        by_product[row[1]].append({"id": row[0], "label": row[2], "sort": row[3]})

    for variants in by_product.values():
        ordered = [
            variant
            for _, variant in sorted(
                enumerate(variants),
                key=lambda pair: _size_sort_key(pair[1]["label"], pair[0]),
            )
        ]
        for index, variant in enumerate(ordered):
            if variant["sort"] == index:
                continue
            bind.execute(
                sa.text(
                    "UPDATE store_product_variants SET sort_order = :sort "
                    "WHERE id = :id"
                ),
                {"sort": index, "id": variant["id"]},
            )


def downgrade() -> None:
    """No-op: the replaced values recorded data-entry order, nothing more."""
