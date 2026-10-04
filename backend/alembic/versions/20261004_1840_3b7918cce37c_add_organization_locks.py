"""add organization locks

One row per (organization, scope), locked to serialize a read-then-write
decision per department: room booking (EV-26) and program enrollment. Rows
are created on first use by the lock statement itself, so there is nothing
to backfill.

Revision ID: 3b7918cce37c
Revises: edf608b5a8ea
Create Date: 2026-10-04 18:40:09.804662

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3b7918cce37c"
down_revision: Union[str, None] = "edf608b5a8ea"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # A fresh install builds this from the model via create_all before
    # stamping head; only an upgrading one needs it created here.
    if _has_table("organization_locks"):
        return
    op.create_table(
        "organization_locks",
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("scope", sa.String(50), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    # The rows carry no data: they exist only to be locked.
    op.execute("DROP TABLE IF EXISTS organization_locks")
