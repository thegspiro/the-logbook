"""Store: let the PayPal button use the connected PayPal account

Revision ID: 053d3e96b4fa
Revises: 7a3c9e1d5b42
Create Date: 2026-11-14 15:16:11.919506

Adds ``store_settings.paypal_use_connected``. When true, the store's PayPal
button uses the PayPal.Me link and email entered on the connected PayPal
integration, and falls back to the store's own ``paypal_me_url`` and
``paypal_email`` when that integration is disconnected or has neither.

Existing rows: the column is NOT NULL with a server default of false, so every
store already configured keeps exactly the behaviour it had (its own link and
email). No row is rewritten.

Safe to run twice: the column is added only when the table exists and the
column does not. The downgrade drops the column; the store's own PayPal fields
are untouched, so a store that had switched to the connected account reverts to
its own link, or to no PayPal button if it never entered one.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "053d3e96b4fa"
down_revision: Union[str, None] = "7a3c9e1d5b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "store_settings"
COLUMN = "paypal_use_connected"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return False
    return COLUMN in {c["name"] for c in inspector.get_columns(TABLE)}


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table() and not _has_column():
        op.add_column(
            TABLE,
            sa.Column(
                COLUMN,
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    if _has_column():
        op.drop_column(TABLE, COLUMN)
