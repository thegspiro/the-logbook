"""Add department_messages and department_message_reads tables

Revision ID: 20260218_0500
Revises: 20260218_0400
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260218_0500"
down_revision = "20260218_0400"
branch_labels = None
depends_on = None


def _table_exists(conn, table_name: str) -> bool:
    insp = inspect(conn)
    return table_name in insp.get_table_names()


def upgrade() -> None:
    conn = op.get_bind()

    if not _table_exists(conn, "department_messages"):
        op.create_table(
            "department_messages",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(500), nullable=False),
            sa.Column("body", sa.Text, nullable=False),
            sa.Column("priority", sa.Enum("normal", "important", "urgent", name="messagepriority"), server_default="normal", nullable=False),
            sa.Column("target_type", sa.Enum("all", "roles", "statuses", "members", name="messagetargettype"), server_default="all", nullable=False),
            sa.Column("target_roles", sa.JSON, nullable=True),
            sa.Column("target_statuses", sa.JSON, nullable=True),
            sa.Column("target_member_ids", sa.JSON, nullable=True),
            sa.Column("is_pinned", sa.Boolean, server_default="0"),
            sa.Column("is_active", sa.Boolean, server_default="1"),
            sa.Column("requires_acknowledgment", sa.Boolean, server_default="0"),
            sa.Column("posted_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("idx_dept_msg_org", "department_messages", ["organization_id"])
        op.create_index("idx_dept_msg_org_active", "department_messages", ["organization_id", "is_active"])
        op.create_index("idx_dept_msg_org_pinned", "department_messages", ["organization_id", "is_pinned"])

    if not _table_exists(conn, "department_message_reads"):
        op.create_table(
            "department_message_reads",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("message_id", sa.String(36), sa.ForeignKey("department_messages.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("read_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("message_id", "user_id", name="uq_dept_msg_read_user"),
        )
        op.create_index("idx_dept_msg_read_msg", "department_message_reads", ["message_id"])
        op.create_index("idx_dept_msg_read_user", "department_message_reads", ["user_id"])


def downgrade() -> None:
    op.drop_table("department_message_reads")
    op.drop_table("department_messages")
    op.execute("DROP TYPE IF EXISTS messagepriority")
    op.execute("DROP TYPE IF EXISTS messagetargettype")
