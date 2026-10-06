"""drop dead refresh rotation grace columns

The refresh-token rotation grace window was removed on 2026-08-12: a stale
refresh token now revokes every session as replay. Its two columns stayed
behind, nulled on every rotation and read by nothing. Dropping them changes no
behaviour. The downgrade re-adds both as empty nullable columns, which is all
they ever held once the grace window went.

Revision ID: 3b66b78c770b
Revises: 3b7918cce37c
Create Date: 2026-10-04 22:40:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3b66b78c770b"
down_revision: Union[str, None] = "3b7918cce37c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX = "ix_sessions_previous_refresh_token"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if "sessions" not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns("sessions")}


def _indexes() -> set:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("sessions")}


def upgrade() -> None:
    columns = _columns()
    if "previous_refresh_token" in columns:
        if _INDEX in _indexes():
            op.drop_index(_INDEX, table_name="sessions")
        op.drop_column("sessions", "previous_refresh_token")
    if "previous_refresh_expires_at" in columns:
        op.drop_column("sessions", "previous_refresh_expires_at")


def downgrade() -> None:
    columns = _columns()
    if not columns:
        return
    if "previous_refresh_token" not in columns:
        op.add_column(
            "sessions",
            sa.Column("previous_refresh_token", sa.String(length=512), nullable=True),
        )
        op.create_index(_INDEX, "sessions", ["previous_refresh_token"])
    if "previous_refresh_expires_at" not in columns:
        op.add_column(
            "sessions",
            sa.Column(
                "previous_refresh_expires_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )
