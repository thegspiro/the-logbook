"""Add event_attendance_petitions: a member's request to be marked present.

Revision ID: 0ff2dfd2e9a2
Revises: 601fdb28ab8c
Create Date: 2026-09-30 03:32:37.488948

A new table only; no existing row is read or changed. Guarded on the table's
existence because a fresh install that ran ``create_all()`` from the models
already has it.

**Downgrade** drops the table, and with it every petition and its review. The
attendance an approval recorded lives on ``event_rsvps`` and survives.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0ff2dfd2e9a2"
down_revision: Union[str, None] = "601fdb28ab8c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "event_attendance_petitions"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("event_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "approved",
                "rejected",
                name="attendancepetitionstatus",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("requested_check_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_check_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.String(36), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_event_attendance_petitions_event_user",
        TABLE,
        ["event_id", "user_id"],
        unique=True,
    )
    op.create_index(
        "ix_event_attendance_petitions_organization_id", TABLE, ["organization_id"]
    )
    op.create_index("ix_event_attendance_petitions_user_id", TABLE, ["user_id"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")
