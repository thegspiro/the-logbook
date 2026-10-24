"""Let a training waiver have no end date, as the model already does.

Revision ID: f938324f8081
Revises: f7535f478280
Create Date: 2026-10-23 14:27:00

``20260218_0600_add_training_waivers`` created ``training_waivers.end_date``
``NOT NULL``. The model was later relaxed so a NULL end date means a permanent
waiver, and both ``POST /training/waivers`` and an open-ended leave of absence
(which creates a linked waiver) store exactly that. No migration followed, so
on every upgraded database those requests fail at flush with MySQL error 1048
and come back as a 500, while a fresh install (``create_all``) accepts them.

The upgrade relaxes the column. No row changes. A database already nullable (a
fresh install) is left as it is.

The downgrade restores ``NOT NULL`` only when no row holds a NULL. A NULL there
is a permanent waiver granted after the upgrade, and the only ways back to
``NOT NULL`` would be deleting it or inventing an end date for it. When such
rows exist the column stays nullable, which every earlier revision's code
already tolerates: the model has declared it nullable throughout.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f938324f8081"
down_revision: Union[str, None] = "f7535f478280"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "training_waivers"
_COLUMN = "end_date"


def _column_nullable() -> bool | None:
    """The column's nullability, or None when the table or column is absent."""
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(_TABLE):
        return None
    for col in inspector.get_columns(_TABLE):
        if col["name"] == _COLUMN:
            return bool(col["nullable"])
    return None


def upgrade() -> None:
    if _column_nullable() is False:
        op.alter_column(_TABLE, _COLUMN, existing_type=sa.Date(), nullable=True)


def downgrade() -> None:
    """Restore NOT NULL only where no permanent waiver exists; see the docstring."""
    if not _column_nullable():
        return
    permanent = (
        op.get_bind()
        .execute(sa.text(f"SELECT COUNT(*) FROM `{_TABLE}` WHERE `{_COLUMN}` IS NULL"))
        .scalar()
    )
    if not permanent:
        op.alter_column(_TABLE, _COLUMN, existing_type=sa.Date(), nullable=False)
