"""Record the size a member asked for on an equipment request.

Revision ID: a1c7e93b2d54
Revises: e8a1c04f6b27

A member can need a size the department does not stock, and that request is
how the quartermaster finds out. In that case ``item_id`` is NULL because no
catalog row matches, so this column is the only record of what was wanted.
"""

import sqlalchemy as sa
from alembic import op

revision = "a1c7e93b2d54"
down_revision = "e8a1c04f6b27"
branch_labels = None
depends_on = None


_TABLE = "equipment_requests"
_COLUMN = "requested_size"


def _has_column(inspector, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # Guarded on the column already existing, for the same reason
    # ``8fb3757b80ec`` is: an installation that starts the app on this code
    # before running the upgrade gets the column from ``create_all()`` /
    # ``repair_schema.py`` because the model declares it, while Alembic is
    # still on the previous revision. An unguarded ADD COLUMN then fails with
    # "Duplicate column name" and takes the whole upgrade with it.
    inspector = sa.inspect(op.get_bind())
    if _has_column(inspector, _TABLE, _COLUMN):
        return

    op.add_column(_TABLE, sa.Column(_COLUMN, sa.String(50), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not _has_column(inspector, _TABLE, _COLUMN):
        return
    op.drop_column(_TABLE, _COLUMN)
