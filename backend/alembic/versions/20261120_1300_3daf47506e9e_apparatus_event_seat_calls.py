"""Record each "email members about open seats" send for an apparatus run

Revision ID: 3daf47506e9e
Revises: 3f8a1c6e2b94
Create Date: 2026-11-20 13:00:00.000000

Adds one table, ``apparatus_event_seat_calls``. Nothing existing is altered
and no row is written, so the upgrade is the same on an empty database and a
populated one, and the downgrade drops only what this revision created.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "3daf47506e9e"
down_revision: Union[str, None] = "3f8a1c6e2b94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "apparatus_event_seat_calls"


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # A database that ran ``create_all`` after the model landed already has
    # the table; creating it again would fail the whole upgrade.
    if _has_table(_TABLE):
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("series_id", sa.String(36), nullable=False),
        sa.Column(
            "sent_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("recipients", sa.Integer(), nullable=False),
        sa.Column(
            "skipped_opted_out", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("nights_listed", sa.Integer(), nullable=False),
        sa.Column("audience", sa.JSON(), nullable=True),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index(
        "ix_apparatus_event_seat_calls_series",
        _TABLE,
        ["organization_id", "series_id", "sent_at"],
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {_TABLE}")
