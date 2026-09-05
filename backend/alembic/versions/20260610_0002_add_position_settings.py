"""Add settings JSON to positions for per-position UI preferences

Stores per-position preferences such as the inventory label printer/size a
role uses (so a Quartermaster keeps a Rollo, Training keeps a Dymo, etc.,
independent of which computer is used).

Revision ID: 20260610_0002
Revises: 20260610_0001
Create Date: 2026-06-10 01:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260610_0002"
down_revision = "20260610_0001"
branch_labels = None
depends_on = None

_COLUMN = "settings"


def _positions_table(bind) -> str | None:
    """The table holding position rows at this point in the chain.

    This revision is an ancestor of ``20260805_0008``, which renames ``roles``
    to ``positions``. Until that revision runs the rows live in ``roles``. The
    models were renamed long before the database was, which is why this
    migration was originally written against ``positions`` and then silently
    no-opped on every upgrade path it was supposed to repair.

    A database that has also been started against current code carries an empty
    ``positions`` beside a populated ``roles`` -- the shape ``20260805_0008``
    calls "shape 2" -- so ``roles`` is preferred whenever it is present.
    """
    tables = set(sa.inspect(bind).get_table_names())
    if "roles" in tables:
        return "roles"
    if "positions" in tables:
        return "positions"
    return None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    table = _positions_table(bind)
    if table is None:
        return

    # Idempotent across all three shapes 20260805_0008 documents: a database
    # built by create_all already carries the column from the model, and
    # 20260805_0008 itself adds it if this revision did not.
    if _has_column(bind, table, _COLUMN):
        return

    op.add_column(table, sa.Column(_COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    table = _positions_table(bind)
    if table is None:
        return

    if not _has_column(bind, table, _COLUMN):
        return

    op.drop_column(table, _COLUMN)
