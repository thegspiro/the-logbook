"""Add admin hours categories and entries tables

Revision ID: 20260227_0200
Revises: 20260227_0100
Create Date: 2026-02-27

Adds support for members to log administrative hours via QR code
clock-in/clock-out or manual entry, with configurable categories
and optional approval workflows.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "20260227_0200"
down_revision = "20260227_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Admin Hours Categories
    op.create_table(
        "admin_hours_categories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("color", sa.String(7), nullable=True),
        sa.Column("require_approval", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("auto_approve_under_hours", sa.Float, nullable=True),
        sa.Column("max_hours_per_session", sa.Float, nullable=True, server_default="12"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
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
    )
    op.create_index(
        "ix_admin_hours_categories_org_id",
        "admin_hours_categories",
        ["organization_id"],
    )
    op.create_index(
        "ix_admin_hours_categories_active",
        "admin_hours_categories",
        ["organization_id", "is_active"],
    )

    # Admin Hours Entries
    op.create_table(
        "admin_hours_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            sa.String(36),
            sa.ForeignKey("admin_hours_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("clock_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("clock_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer, nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "entry_method",
            sa.Enum("qr_scan", "manual", name="adminhoursentrymethod"),
            nullable=False,
            server_default="manual",
        ),
        sa.Column(
            "status",
            sa.Enum("active", "pending", "approved", "rejected", name="adminhoursentrystatus"),
            nullable=False,
            server_default="active",
        ),
        sa.Column("approved_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text, nullable=True),
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
    )
    op.create_index(
        "ix_admin_hours_entries_org_id",
        "admin_hours_entries",
        ["organization_id"],
    )
    op.create_index(
        "ix_admin_hours_entries_user_id",
        "admin_hours_entries",
        ["user_id"],
    )
    op.create_index(
        "ix_admin_hours_entries_category_id",
        "admin_hours_entries",
        ["category_id"],
    )
    op.create_index(
        "ix_admin_hours_entries_status",
        "admin_hours_entries",
        ["organization_id", "status"],
    )
    op.create_index(
        "ix_admin_hours_entries_user_active",
        "admin_hours_entries",
        ["user_id", "status"],
    )


def downgrade() -> None:
    op.drop_table("admin_hours_entries")
    op.drop_table("admin_hours_categories")
    op.execute("DROP TYPE IF EXISTS adminhoursentrystatus")
    op.execute("DROP TYPE IF EXISTS adminhoursentrymethod")
