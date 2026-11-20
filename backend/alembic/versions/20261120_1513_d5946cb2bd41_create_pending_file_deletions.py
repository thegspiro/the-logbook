"""Create pending_file_deletions for durable post-delete file removal

The queue of stored files a committed delete still has to remove (owner
decision 2026-11-20, "Hard-delete crash gap"). A permanent member delete
writes one row per file its cascaded rows named, in the same transaction as
the delete; the endpoint removes the files right after the commit, and an
hourly sweep (``pending_file_deletions``) retries whatever a crash or an
unreachable store left behind.

A new table only, so no existing row is touched and nothing needs settling
(pitfall #35). It starts empty, which is the truth on every installation this
upgrades: deletes before this revision queued nothing. Skipped when the table
already exists, so a database ``create_all`` built first upgrades cleanly.

Downgrade drops the table with any rows still pending. The files those rows
named are then orphans nothing records: no later run can find them.

Revision ID: d5946cb2bd41
Revises: bc58d756a179
Create Date: 2026-11-20 15:13:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5946cb2bd41"
down_revision: Union[str, None] = "bc58d756a179"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "pending_file_deletions"


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
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
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("area", sa.String(40), nullable=False),
        sa.Column("reason", sa.String(40), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(255), nullable=True),
    )
    op.create_index("idx_pending_file_deletions_org", _TABLE, ["organization_id"])


def downgrade() -> None:
    if _has_table(_TABLE):
        op.drop_table(_TABLE)
