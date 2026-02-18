"""Add training_waivers table for leave of absence tracking

Revision ID: 20260218_0600
Revises: 20260218_0500
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260218_0600"
down_revision = "20260218_0500"
branch_labels = None
depends_on = None


def _table_exists(conn, table_name: str) -> bool:
    insp = inspect(conn)
    return table_name in insp.get_table_names()


def upgrade() -> None:
    conn = op.get_bind()
    if _table_exists(conn, "training_waivers"):
        return

    op.create_table(
        "training_waivers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("waiver_type", sa.String(30), nullable=False, server_default="leave_of_absence"),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("requirement_ids", sa.JSON, nullable=True),
        sa.Column("granted_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_index("idx_training_waivers_org_user", "training_waivers", ["organization_id", "user_id"])
    op.create_index("idx_training_waivers_dates", "training_waivers", ["start_date", "end_date"])


def downgrade() -> None:
    op.drop_index("idx_training_waivers_dates", table_name="training_waivers")
    op.drop_index("idx_training_waivers_org_user", table_name="training_waivers")
    op.drop_table("training_waivers")
