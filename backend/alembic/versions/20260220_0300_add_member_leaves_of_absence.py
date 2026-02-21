"""Add member_leaves_of_absence table

Revision ID: 20260220_0300
Revises: 20260220_0200
Create Date: 2026-02-20

Adds a membership-level leave of absence table so departments can mark
months that should not count against a member for rolling-period
requirements.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260220_0300"
down_revision = "20260220_0200"
branch_labels = None
depends_on = None


def _table_exists(conn, table_name: str) -> bool:
    insp = inspect(conn)
    return table_name in insp.get_table_names()


def upgrade() -> None:
    conn = op.get_bind()
    if _table_exists(conn, "member_leaves_of_absence"):
        return

    op.create_table(
        "member_leaves_of_absence",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36),
                   sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                   nullable=False),
        sa.Column("user_id", sa.String(36),
                   sa.ForeignKey("users.id", ondelete="CASCADE"),
                   nullable=False),
        sa.Column("leave_type", sa.String(30), nullable=False,
                   server_default="leave_of_absence"),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("granted_by", sa.String(36),
                   sa.ForeignKey("users.id"), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean, nullable=False,
                   server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                   server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                   server_default=sa.func.now()),
    )

    op.create_index("idx_member_leave_org_user",
                     "member_leaves_of_absence",
                     ["organization_id", "user_id"])
    op.create_index("idx_member_leave_dates",
                     "member_leaves_of_absence",
                     ["start_date", "end_date"])


def downgrade() -> None:
    op.drop_index("idx_member_leave_dates",
                   table_name="member_leaves_of_absence")
    op.drop_index("idx_member_leave_org_user",
                   table_name="member_leaves_of_absence")
    op.drop_table("member_leaves_of_absence")
