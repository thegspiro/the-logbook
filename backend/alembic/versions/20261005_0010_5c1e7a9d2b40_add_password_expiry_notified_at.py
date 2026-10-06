"""add users.password_expiry_notified_at

AUTH-15: the server now refuses an expired password, but only a grace period
after the member was first told it expired, so that turning enforcement on
does not lock out every member whose password was already past the age limit.
This column records that moment. It starts NULL for everyone, which is what
starts every existing member's grace period at their next notice rather than
at deploy. The downgrade drops it; nothing else reads it.

Revision ID: 5c1e7a9d2b40
Revises: 3b66b78c770b
Create Date: 2026-10-05 00:10:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c1e7a9d2b40"
down_revision: Union[str, None] = "3b66b78c770b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMN = "password_expiry_notified_at"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if "users" not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns("users")}


def upgrade() -> None:
    columns = _columns()
    if columns and _COLUMN not in columns:
        op.add_column(
            "users",
            sa.Column(_COLUMN, sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column("users", _COLUMN)
