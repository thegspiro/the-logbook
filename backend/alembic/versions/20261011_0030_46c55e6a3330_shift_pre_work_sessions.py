"""shift pre work sessions

A member who prepares for an early shift the afternoon before — the
equipment check for a 04:00 start, say — had nowhere to record that hour:
check-in opens a couple of hours ahead, and stretching one attendance span
back to the prep would also credit the night in between. Each session is a
separate timed record tied to the shift, credited only once an officer
approves it. Purely additive; no existing row is read or changed.

Revision ID: 46c55e6a3330
Revises: 376ec2fef6d3
Create Date: 2026-10-11 00:30:03.514235

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "46c55e6a3330"
down_revision: Union[str, None] = "376ec2fef6d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # A fresh install builds this from the model via create_all before
    # stamping head; only an upgrading one needs it created here.
    if _has_table("shift_pre_work_sessions"):
        return
    op.create_table(
        "shift_pre_work_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "shift_id",
            sa.String(36),
            sa.ForeignKey("shifts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("apparatus_id", sa.String(36), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "pending",
                "approved",
                "rejected",
                name="preworkstatus",
            ),
            nullable=False,
            server_default="active",
        ),
        sa.Column("approved_minutes", sa.Integer(), nullable=True),
        sa.Column(
            "reviewed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index("idx_pre_work_shift", "shift_pre_work_sessions", ["shift_id"])
    op.create_index(
        "idx_pre_work_user_status", "shift_pre_work_sessions", ["user_id", "status"]
    )
    op.create_index(
        "idx_pre_work_org_status",
        "shift_pre_work_sessions",
        ["organization_id", "status"],
    )


def downgrade() -> None:
    # Dropping the table discards any recorded pre-shift sessions, approved
    # ones included; their minutes stop counting toward member hours.
    op.execute("DROP TABLE IF EXISTS shift_pre_work_sessions")
