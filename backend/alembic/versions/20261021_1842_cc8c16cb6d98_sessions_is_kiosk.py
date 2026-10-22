"""Mark a session as a station kiosk

``sessions.is_kiosk`` records that the session's owner asked for the longer
kiosk idle timeout and absolute lifetime (``POST /auth/session/kiosk``). The
flag alone grants nothing: the limits only apply while the user still holds
``security.kiosk_session``, checked on every request.

Additive, NOT NULL with a server default of 0, so every existing session reads
as a normal one. The downgrade drops the column; a kiosk session then falls
back to the standard limits.

Revision ID: cc8c16cb6d98
Revises: e5f9bb066e07
Create Date: 2026-10-21 18:42:11.204118

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cc8c16cb6d98"
down_revision: Union[str, None] = "e5f9bb066e07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "sessions"
_COLUMN = "is_kiosk"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    # A table only create_all builds is built from the model, which already
    # declares the column, so an absent table is skipped rather than an error.
    cols = _columns()
    if cols and _COLUMN not in cols:
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)
